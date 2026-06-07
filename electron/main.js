import { app, BrowserWindow, ipcMain, Menu, shell } from 'electron';
import { createRequire } from 'module';
import { fileURLToPath } from 'url';
import path from 'path';
import net from 'net';
import { fork } from 'child_process';

const require = createRequire(import.meta.url);
const __dirname = path.dirname(fileURLToPath(import.meta.url));

// electron-store must be require()'d (CJS module)
const Store = require('electron-store');

const store = new Store({
  defaults: {
    robotAddressOverride: null,     // null → auto-discover
    windowBounds: { width: 1440, height: 900 },
    windowMaximized: false,
  },
});

// ── Constants ──────────────────────────────────────────────────────────────
const NT4_PORT = 5810;
const CANDIDATE_ADDRESSES = [
  '10.1.72.2',
  'roboRIO-172-FRC.local',
  'localhost',
  '127.0.0.1',
];
const AUTO_DISCOVER_INTERVAL_MS = 5000;
const CONNECT_TIMEOUT_MS = 800;

// ── State ──────────────────────────────────────────────────────────────────
let mainWindow = null;
let activeRobotAddress = 'localhost';   // resolved address sent to renderer
let syncPathsProcess = null;
let discoveryTimer = null;

// ── TCP reachability probe ─────────────────────────────────────────────────
function probeAddress(host, port, timeoutMs) {
  return new Promise((resolve) => {
    const socket = new net.Socket();
    let done = false;

    const finish = (ok) => {
      if (done) return;
      done = true;
      socket.destroy();
      resolve(ok);
    };

    socket.setTimeout(timeoutMs);
    socket.once('connect', () => finish(true));
    socket.once('timeout', () => finish(false));
    socket.once('error', () => finish(false));
    socket.connect(port, host);
  });
}

async function discoverRobotAddress() {
  const override = store.get('robotAddressOverride');
  if (override) {
    setActiveAddress(override);
    return;
  }

  for (const addr of CANDIDATE_ADDRESSES) {
    const reachable = await probeAddress(addr, NT4_PORT, CONNECT_TIMEOUT_MS);
    if (reachable) {
      setActiveAddress(addr);
      return;
    }
  }

  // None reachable — keep previous / default to 'localhost' for simulation
  setActiveAddress('localhost');
}

function setActiveAddress(addr) {
  if (addr === activeRobotAddress) return;
  activeRobotAddress = addr;
  mainWindow?.webContents.send('robot-address-changed', addr);
}

function startDiscovery() {
  discoverRobotAddress();
  discoveryTimer = setInterval(discoverRobotAddress, AUTO_DISCOVER_INTERVAL_MS);
}

function stopDiscovery() {
  if (discoveryTimer) {
    clearInterval(discoveryTimer);
    discoveryTimer = null;
  }
}

// ── sync-paths child process ───────────────────────────────────────────────
function startSyncPaths() {
  if (syncPathsProcess) return;

  // Resolve the scripts path — works both in dev and inside .app bundle
  const scriptsDir = app.isPackaged
    ? path.join(process.resourcesPath, 'scripts')
    : path.join(__dirname, '..', 'scripts');

  const scriptPath = path.join(scriptsDir, 'sync-paths.js');

  // Public dir for path output
  const publicDir = app.isPackaged
    ? path.join(process.resourcesPath, 'public')
    : path.join(__dirname, '..', 'public');

  syncPathsProcess = fork(scriptPath, ['--watch', '--address', activeRobotAddress, '--public', publicDir], {
    silent: true,
    env: { ...process.env, ELECTRON_RUN_AS_NODE: '1' },
  });

  syncPathsProcess.stdout?.on('data', (data) => {
    mainWindow?.webContents.send('sync-paths-log', data.toString());
  });

  syncPathsProcess.stderr?.on('data', (data) => {
    mainWindow?.webContents.send('sync-paths-log', `[ERR] ${data.toString()}`);
  });

  syncPathsProcess.on('exit', () => {
    syncPathsProcess = null;
  });
}

function stopSyncPaths() {
  if (!syncPathsProcess) return;
  syncPathsProcess.kill();
  syncPathsProcess = null;
}

// ── IPC handlers ───────────────────────────────────────────────────────────
ipcMain.handle('get-robot-address', () => activeRobotAddress);

ipcMain.handle('set-robot-address', (_event, address) => {
  const normalized = typeof address === 'string' && address.trim() ? address.trim() : null;
  store.set('robotAddressOverride', normalized);
  if (normalized) {
    setActiveAddress(normalized);
  } else {
    // Resume auto-discovery
    discoverRobotAddress();
  }
});

ipcMain.handle('sync-paths-start', () => startSyncPaths());
ipcMain.handle('sync-paths-stop', () => stopSyncPaths());
ipcMain.handle('get-version', () => app.getVersion());

// ── BrowserWindow ──────────────────────────────────────────────────────────
function createWindow() {
  const saved = store.get('windowBounds');

  mainWindow = new BrowserWindow({
    width: saved.width,
    height: saved.height,
    minWidth: 1024,
    minHeight: 600,
    title: 'Chronos',
    backgroundColor: '#141418',
    show: false,   // show after ready-to-show to avoid flash
    webPreferences: {
      preload: path.join(__dirname, 'preload.js'),
      contextIsolation: true,
      nodeIntegration: false,
      sandbox: false,   // needed for preload contextBridge
      webSecurity: true,
    },
  });

  if (store.get('windowMaximized')) mainWindow.maximize();

  // ── Load URL or file ───────────────────────────────────────────────────
  const devUrl = process.env.VITE_DEV_SERVER_URL;
  if (devUrl) {
    mainWindow.loadURL(devUrl);
    mainWindow.webContents.openDevTools({ mode: 'detach' });
  } else {
    mainWindow.loadFile(path.join(__dirname, '..', 'dist', 'index.html'));
  }

  mainWindow.once('ready-to-show', () => {
    mainWindow.show();
    startDiscovery();
    startSyncPaths();
    // Ensure renderer has keyboard focus immediately on launch
    mainWindow.webContents.focus();
  });

  // Re-focus the renderer whenever the OS gives the window focus so that
  // key events always land in the page and not in a detached DevTools, etc.
  mainWindow.on('focus', () => {
    mainWindow.webContents.focus();
  });

  // Signal the renderer when the OS window truly loses focus (user switched apps).
  // This is distinct from intra-page focus changes, which the renderer handles
  // via document.hasFocus() in its own blur handler.
  mainWindow.on('blur', () => {
    mainWindow.webContents.send('window-os-blur');
  });

  // Intercept before-input-event so Chromium/Electron doesn't silently eat
  // keys before they reach the renderer's JavaScript (e.g. F-keys, Escape,
  // Space, Enter, arrow keys, Tab).  We pass them through untouched — the
  // renderer's own keydown/keyup listeners in App.jsx will handle them.
  mainWindow.webContents.on('before-input-event', (event, input) => {
    // Only intercept pure key events (not IME composition)
    if (input.type !== 'keyDown' && input.type !== 'keyUp') return;

    // Let modifier-only events pass (Shift, Ctrl, Alt, Meta alone)
    const modifierOnly = ['Shift', 'Control', 'Alt', 'Meta', 'Dead'].includes(input.key);
    if (modifierOnly) return;

    // Keys Electron/Chromium would otherwise consume before JS sees them:
    // F-keys, Escape, Tab, Space, Enter, arrow keys, Backspace, Delete
    const intercepted = [
      'F1','F2','F3','F4','F5','F6','F7','F8','F9','F10','F11','F12',
      'Escape', 'Tab', 'Backspace', 'Delete',
      'ArrowUp', 'ArrowDown', 'ArrowLeft', 'ArrowRight',
      'Home', 'End', 'PageUp', 'PageDown',
    ];

    if (intercepted.includes(input.key)) {
      // Prevent Electron defaults (e.g. F5 = reload, F12 = DevTools in dev)
      // but only in production; leave dev shortcuts intact for DevTools use.
      if (!process.env.VITE_DEV_SERVER_URL) {
        event.preventDefault();
      }
      // Forward to renderer as a synthetic IPC key event so App.jsx sees it
      mainWindow.webContents.send('global-key-event', {
        type: input.type === 'keyDown' ? 'keydown' : 'keyup',
        key: input.key,
        code: input.code,
      });
    }
  });

  // Persist window size / maximized state
  mainWindow.on('resize', () => {
    if (!mainWindow.isMaximized()) {
      store.set('windowBounds', mainWindow.getBounds());
    }
  });
  mainWindow.on('maximize', () => store.set('windowMaximized', true));
  mainWindow.on('unmaximize', () => store.set('windowMaximized', false));

  // Open external links in the system browser
  mainWindow.webContents.setWindowOpenHandler(({ url }) => {
    shell.openExternal(url);
    return { action: 'deny' };
  });

  mainWindow.on('closed', () => {
    mainWindow = null;
  });
}

// ── App menu ───────────────────────────────────────────────────────────────
function buildMenu() {
  const isMac = process.platform === 'darwin';

  const template = [
    ...(isMac ? [{
      label: app.name,
      submenu: [
        { role: 'about' },
        { type: 'separator' },
        { role: 'services' },
        { type: 'separator' },
        { role: 'hide' },
        { role: 'hideOthers' },
        { role: 'unhide' },
        { type: 'separator' },
        { role: 'quit' },
      ],
    }] : []),
    {
      label: 'File',
      submenu: [
        isMac ? { role: 'close' } : { role: 'quit' },
      ],
    },
    {
      label: 'Edit',
      submenu: [
        { role: 'undo' },
        { role: 'redo' },
        { type: 'separator' },
        { role: 'cut' },
        { role: 'copy' },
        { role: 'paste' },
        { role: 'selectAll' },
      ],
    },
    {
      label: 'View',
      submenu: [
        { role: 'reload' },
        { role: 'forceReload' },
        { role: 'toggleDevTools' },
        { type: 'separator' },
        { role: 'resetZoom' },
        { role: 'zoomIn' },
        { role: 'zoomOut' },
        { type: 'separator' },
        { role: 'togglefullscreen' },
      ],
    },
    {
      label: 'Robot',
      submenu: [
        {
          label: 'Auto-Discover Address',
          click: () => {
            store.set('robotAddressOverride', null);
            discoverRobotAddress();
          },
        },
        { type: 'separator' },
        {
          label: 'Connect: 10.1.72.2 (Field)',
          click: () => ipcMain.emit('set-robot-address', null, null, '10.1.72.2'),
        },
        {
          label: 'Connect: roboRIO-172-FRC.local',
          click: () => ipcMain.emit('set-robot-address', null, null, 'roboRIO-172-FRC.local'),
        },
        {
          label: 'Connect: localhost (Simulation)',
          click: () => ipcMain.emit('set-robot-address', null, null, 'localhost'),
        },
        { type: 'separator' },
        {
          label: 'Restart Path Sync',
          click: () => { stopSyncPaths(); startSyncPaths(); },
        },
      ],
    },
    {
      label: 'Window',
      submenu: [
        { role: 'minimize' },
        { role: 'zoom' },
        ...(isMac ? [
          { type: 'separator' },
          { role: 'front' },
        ] : []),
      ],
    },
  ];

  Menu.setApplicationMenu(Menu.buildFromTemplate(template));
}

// ── Lifecycle ──────────────────────────────────────────────────────────────
app.whenReady().then(() => {
  buildMenu();
  createWindow();

  app.on('activate', () => {
    if (BrowserWindow.getAllWindows().length === 0) createWindow();
  });
});

app.on('window-all-closed', () => {
  stopDiscovery();
  stopSyncPaths();
  if (process.platform !== 'darwin') app.quit();
});

app.on('before-quit', () => {
  stopDiscovery();
  stopSyncPaths();
});
