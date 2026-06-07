import { contextBridge, ipcRenderer } from 'electron';

/**
 * Chronos preload — exposes a safe, narrow API to the renderer via contextBridge.
 * No Node.js or Electron internals are directly exposed.
 */
contextBridge.exposeInMainWorld('electronAPI', {
  // ── Robot address ──────────────────────────────────────────────────────
  /** Returns the currently active robot NT4 address */
  getRobotAddress: () => ipcRenderer.invoke('get-robot-address'),

  /**
   * Manually override the robot address (persisted in electron-store).
   * Pass null / '' to re-enable auto-discovery.
   */
  setRobotAddress: (address) => ipcRenderer.invoke('set-robot-address', address),

  /**
   * Register a callback invoked whenever the active robot address changes
   * (e.g. after auto-discovery resolves, or after a manual override).
   * Returns an unsubscribe function.
   */
  onRobotAddressChange: (callback) => {
    const handler = (_event, address) => callback(address);
    ipcRenderer.on('robot-address-changed', handler);
    return () => ipcRenderer.removeListener('robot-address-changed', handler);
  },

  // ── sync-paths child process ───────────────────────────────────────────
  /** Start the NT path-sync child process. No-op if already running. */
  syncPathsStart: () => ipcRenderer.invoke('sync-paths-start'),

  /** Stop the NT path-sync child process. */
  syncPathsStop: () => ipcRenderer.invoke('sync-paths-stop'),

  /** Listen for sync-paths log lines */
  onSyncPathsLog: (callback) => {
    const handler = (_event, line) => callback(line);
    ipcRenderer.on('sync-paths-log', handler);
    return () => ipcRenderer.removeListener('sync-paths-log', handler);
  },

  /** Fires when the OS window loses focus (user switched to another app).
   *  More reliable than window 'blur' in the renderer, which fires on any
   *  intra-page focus change. Returns an unsubscribe function.
   */
  onWindowBlur: (callback) => {
    const handler = () => callback();
    ipcRenderer.on('window-os-blur', handler);
    return () => ipcRenderer.removeListener('window-os-blur', handler);
  },

  /** Listen for synthetic key events forwarded from the main process
   *  (for keys Electron/Chromium would otherwise consume, e.g. F-keys, Escape).
   *  The callback receives { type: 'keydown'|'keyup', key, code }.
   *  Returns an unsubscribe function.
   */
  onGlobalKeyEvent: (callback) => {
    const handler = (_event, data) => callback(data);
    ipcRenderer.on('global-key-event', handler);
    return () => ipcRenderer.removeListener('global-key-event', handler);
  },

  // ── App metadata ───────────────────────────────────────────────────────
  /** Returns the app version from package.json */
  getVersion: () => ipcRenderer.invoke('get-version'),
});
