/**
 * sync-paths.js
 *
 * Connects to the NT4 server and watches for PathPlannerPath entries at:
 *   /NFRDashboard/autonomousCommands/Match/<autoName>/PathPlannerPath
 *
 * Each PathPlannerPath value is an absolute filesystem path to the .auto file
 * (e.g. from the robot simulator running locally). The paths directory is
 * derived from the .auto file location (one directory up, then into paths/).
 *
 * On each discovery the script:
 *   1. Reads the .auto file to get the ordered list of path names
 *   2. Copies every .path file from the sibling paths/ directory to public/paths/
 *   3. Copies the .auto file to public/autos/
 *   4. Regenerates public/paths/automap.json
 *
 * Usage:
 *   node scripts/sync-paths.js              (one-shot, 3 s NT4 timeout)
 *   node scripts/sync-paths.js --watch      (stay connected, react to changes)
 *   NT4_HOST=10.1.72.2 node scripts/sync-paths.js
 *   node scripts/sync-paths.js --host=10.1.72.2
 */

import fs from 'fs';
import path from 'path';
import { fileURLToPath } from 'url';

const __dirname = path.dirname(fileURLToPath(import.meta.url));

// ── Configuration ──────────────────────────────────────────────

const DASHBOARD_PATHS_DIR = path.join(__dirname, '..', 'public', 'paths');
const DASHBOARD_AUTOS_DIR = path.join(__dirname, '..', 'public', 'autos');

const NT4_HOST = (() => {
  const arg = process.argv.find((a) => a.startsWith('--host='));
  return arg ? arg.split('=')[1] : (process.env.NT4_HOST || 'localhost');
})();
const NT4_PORT = 5810;

const AUTO_NT4_PREFIX = '/NFRDashboard/autonomousCommands/Match/';
const AUTO_PATH_REGEX = /^\/NFRDashboard\/autonomousCommands\/Match\/([^/]+)\/PathPlannerPath$/;

/** How long (ms) to wait for NT4 data in one-shot mode before exiting. */
const SYNC_TIMEOUT_MS = parseInt(process.env.SYNC_TIMEOUT || '3000', 10);

// ── Minimal MessagePack decoder (covers NT4 value types) ───────

function readMsgpack(buf, pos) {
  const b = buf[pos++];

  if (b <= 0x7f) return [b, pos];
  if (b >= 0xe0) return [b - 256, pos];

  if (b >= 0xa0 && b <= 0xbf) {
    const len = b & 0x1f;
    return [buf.subarray(pos, pos + len).toString('utf8'), pos + len];
  }
  if (b >= 0x90 && b <= 0x9f) {
    const len = b & 0x0f;
    const arr = [];
    for (let i = 0; i < len; i++) {
      const [v, p] = readMsgpack(buf, pos);
      arr.push(v);
      pos = p;
    }
    return [arr, pos];
  }
  if (b >= 0x80 && b <= 0x8f) {
    const len = b & 0x0f;
    const obj = {};
    for (let i = 0; i < len; i++) {
      const [k, p1] = readMsgpack(buf, pos);
      const [v, p2] = readMsgpack(buf, p1);
      obj[k] = v;
      pos = p2;
    }
    return [obj, pos];
  }

  switch (b) {
    case 0xc0: return [null, pos];
    case 0xc2: return [false, pos];
    case 0xc3: return [true, pos];
    case 0xca: return [0, pos + 4];
    case 0xcb: return [0, pos + 8];
    case 0xcc: return [buf[pos], pos + 1];
    case 0xcd: return [(buf[pos] << 8) | buf[pos + 1], pos + 2];
    case 0xce:
      return [
        (buf[pos] * 0x1000000 + (buf[pos + 1] << 16) + (buf[pos + 2] << 8) + buf[pos + 3]) >>> 0,
        pos + 4,
      ];
    case 0xcf: return [0, pos + 8];
    case 0xd0: {
      const v = buf[pos];
      return [v >= 128 ? v - 256 : v, pos + 1];
    }
    case 0xd1: {
      let v = (buf[pos] << 8) | buf[pos + 1];
      return [v >= 32768 ? v - 65536 : v, pos + 2];
    }
    case 0xd2:
      return [
        (buf[pos] << 24) | (buf[pos + 1] << 16) | (buf[pos + 2] << 8) | buf[pos + 3],
        pos + 4,
      ];
    case 0xd3: return [0, pos + 8];
    case 0xd9: {
      const len = buf[pos];
      return [buf.subarray(pos + 1, pos + 1 + len).toString('utf8'), pos + 1 + len];
    }
    case 0xda: {
      const len = (buf[pos] << 8) | buf[pos + 1];
      return [buf.subarray(pos + 2, pos + 2 + len).toString('utf8'), pos + 2 + len];
    }
    case 0xdb: {
      const len =
        buf[pos] * 0x1000000 + (buf[pos + 1] << 16) + (buf[pos + 2] << 8) + buf[pos + 3];
      return [buf.subarray(pos + 4, pos + 4 + len).toString('utf8'), pos + 4 + len];
    }
    case 0xdc: {
      const len = (buf[pos] << 8) | buf[pos + 1];
      pos += 2;
      const arr = [];
      for (let i = 0; i < len; i++) {
        const [v, p] = readMsgpack(buf, pos);
        arr.push(v);
        pos = p;
      }
      return [arr, pos];
    }
    case 0xdd: {
      const len =
        buf[pos] * 0x1000000 + (buf[pos + 1] << 16) + (buf[pos + 2] << 8) + buf[pos + 3];
      pos += 4;
      const arr = [];
      for (let i = 0; i < len; i++) {
        const [v, p] = readMsgpack(buf, pos);
        arr.push(v);
        pos = p;
      }
      return [arr, pos];
    }
    case 0xc4: return [null, pos + 1 + buf[pos]];
    case 0xc5: return [null, pos + 2 + ((buf[pos] << 8) | buf[pos + 1])];
    case 0xc6: {
      const len =
        buf[pos] * 0x1000000 + (buf[pos + 1] << 16) + (buf[pos + 2] << 8) + buf[pos + 3];
      return [null, pos + 4 + len];
    }
    default:
      throw new Error(`Unknown msgpack byte 0x${b.toString(16)} at offset ${pos - 1}`);
  }
}

function decodeMsgpackMultiple(buffer) {
  const buf = Buffer.from(buffer);
  const results = [];
  let pos = 0;
  while (pos < buf.length) {
    try {
      const [val, newPos] = readMsgpack(buf, pos);
      results.push(val);
      pos = newPos;
    } catch {
      break;
    }
  }
  return results;
}

// ── PathPlanner helpers ────────────────────────────────────────

function extractPathNames(command) {
  const names = [];
  if (!command) return names;

  if (command.type === 'path' && command.data?.pathName) {
    names.push(command.data.pathName);
  }

  const children = command.data?.commands;
  if (Array.isArray(children)) {
    for (const child of children) names.push(...extractPathNames(child));
  }

  return names;
}

function normalizePathReference(pathRef) {
  if (pathRef == null) return '';
  const raw = String(pathRef).trim();
  if (!raw) return '';
  const normalized = raw.replace(/\\/g, '/');
  const fileName = path.posix.basename(normalized);
  return fileName.endsWith('.path') ? fileName.slice(0, -5) : fileName;
}

// ── Core sync ──────────────────────────────────────────────────

function syncFromAutoPath(autoName, autoFilePath, automap) {
  const normalizedAutoPath = path.resolve(autoFilePath.replace(/\\/g, '/'));

  if (!fs.existsSync(normalizedAutoPath)) {
    console.warn(`⚠  .auto file not found: ${normalizedAutoPath}`);
    return false;
  }

  const autosDir = path.dirname(normalizedAutoPath);
  const pathsDir = path.join(autosDir, '..', 'paths');

  let autoContent;
  try {
    autoContent = JSON.parse(fs.readFileSync(normalizedAutoPath, 'utf-8'));
  } catch (err) {
    console.warn(`⚠  Failed to parse ${path.basename(normalizedAutoPath)}: ${err.message}`);
    return false;
  }

  const pathNames = extractPathNames(autoContent.command)
    .map(normalizePathReference)
    .filter(Boolean);

  fs.mkdirSync(DASHBOARD_PATHS_DIR, { recursive: true });
  fs.mkdirSync(DASHBOARD_AUTOS_DIR, { recursive: true });

  let copiedPaths = 0;
  if (fs.existsSync(pathsDir)) {
    const pathFiles = fs.readdirSync(pathsDir).filter((f) => f.endsWith('.path'));
    for (const file of pathFiles) {
      fs.copyFileSync(path.join(pathsDir, file), path.join(DASHBOARD_PATHS_DIR, file));
      copiedPaths++;
    }
  } else {
    console.warn(`⚠  Paths directory not found: ${pathsDir}`);
  }

  const autoBasename = path.basename(normalizedAutoPath);
  fs.copyFileSync(normalizedAutoPath, path.join(DASHBOARD_AUTOS_DIR, autoBasename));

  automap[autoName] = pathNames;
  const automapPath = path.join(DASHBOARD_PATHS_DIR, 'automap.json');
  fs.writeFileSync(automapPath, JSON.stringify(automap, null, 2) + '\n');

  console.log(
    `✔  Synced "${autoName}": ${copiedPaths} .path file(s) | routes: [${pathNames.join(', ')}]`,
  );
  return true;
}

// ── NT4 client ─────────────────────────────────────────────────

class NT4SyncClient {
  constructor(host, onValue, onConnect, onDisconnect) {
    this.host = host;
    this.onValue = onValue;
    this.onConnect = onConnect ?? (() => {});
    this.onDisconnect = onDisconnect ?? (() => {});
    this.topicMap = new Map();
    this.ws = null;
    this.active = false;
  }

  connect() {
    this.active = true;
    this._connect();
  }

  close() {
    this.active = false;
    if (this.ws) {
      this.ws.close();
      this.ws = null;
    }
  }

  _connect() {
    const clientId = Math.random().toString(36).slice(2, 10);
    const url = `ws://${this.host}:${NT4_PORT}/nt/sync-paths-${clientId}`;

    let ws;
    try {
      ws = new WebSocket(url, 'networktables.first.wpi.edu');
    } catch (err) {
      console.warn(`⚠  WebSocket error: ${err.message}`);
      if (this.active) setTimeout(() => this._connect(), 3000);
      return;
    }

    ws.binaryType = 'arraybuffer';
    this.ws = ws;

    ws.addEventListener('open', () => {
      this.topicMap.clear();
      ws.send(
        JSON.stringify([
          {
            method: 'subscribe',
            params: {
              topics: [AUTO_NT4_PREFIX],
              subuid: 1,
              options: {
                periodic: 0.02,
                all: true,
                topicsonly: false,
                prefix: true,
              },
            },
          },
        ]),
      );
      this.onConnect();
    });

    ws.addEventListener('message', (event) => {
      if (typeof event.data === 'string') {
        let msgs;
        try { msgs = JSON.parse(event.data); } catch { return; }
        if (!Array.isArray(msgs)) return;

        for (const msg of msgs) {
          if (!msg || typeof msg !== 'object') continue;
          const { method, params } = msg;
          if (method === 'announce' && typeof params?.id === 'number') {
            this.topicMap.set(params.id, params.name);
          } else if (method === 'unannounce') {
            for (const [id, name] of this.topicMap) {
              if (name === params?.name) { this.topicMap.delete(id); break; }
            }
          }
        }
      } else {
        let frames;
        try { frames = decodeMsgpackMultiple(event.data); } catch { return; }

        for (const frame of frames) {
          if (!Array.isArray(frame) || frame.length < 4) continue;
          const [topicId, , , value] = frame;
          if (typeof topicId !== 'number' || topicId < 0) continue;

          const topicName = this.topicMap.get(topicId);
          if (topicName && typeof value === 'string') {
            this.onValue(topicName, value);
          }
        }
      }
    });

    ws.addEventListener('close', () => {
      this.ws = null;
      this.onDisconnect();
      if (this.active) setTimeout(() => this._connect(), 3000);
    });

    ws.addEventListener('error', () => {
      ws.close();
    });
  }
}

// ── Watch mode ─────────────────────────────────────────────────

function startWatchMode() {
  const automap = {};

  const client = new NT4SyncClient(
    NT4_HOST,
    (topicName, value) => {
      const match = AUTO_PATH_REGEX.exec(topicName);
      if (!match || !value.trim()) return;
      syncFromAutoPath(match[1], value.trim(), automap);
    },
    () => console.log(`Connected to NT4 at ${NT4_HOST}:${NT4_PORT}`),
    () => {
      console.log('NT4 disconnected, reconnecting in 3 s\u2026');
      for (const key of Object.keys(automap)) delete automap[key];
    },
  );

  client.connect();
  console.log(`Watching NT4 at ${NT4_HOST}:${NT4_PORT} \u2026`);
  console.log('Set NT4_HOST or --host=<addr> to target a different NT4 server.\n');
}

// ── One-shot mode ──────────────────────────────────────────────

function startOneShot() {
  const automap = {};
  let synced = 0;
  let everConnected = false;

  const client = new NT4SyncClient(
    NT4_HOST,
    (topicName, value) => {
      const match = AUTO_PATH_REGEX.exec(topicName);
      if (!match || !value.trim()) return;
      if (syncFromAutoPath(match[1], value.trim(), automap)) synced++;
    },
    () => {
      everConnected = true;
      console.log(`Connected to NT4 at ${NT4_HOST}:${NT4_PORT}`);
    },
    () => {},
  );

  client.connect();

  setTimeout(() => {
    client.close();

    if (!everConnected) {
      console.warn(
        `\u26a0  No NT4 connection at ${NT4_HOST}:${NT4_PORT} within ${SYNC_TIMEOUT_MS} ms.`,
      );
      console.warn(
        '   Start the robot simulation first, or pass --host=<addr> / set NT4_HOST.',
      );
      console.warn('   Use --watch to keep retrying in the background.');
    } else if (synced === 0) {
      console.warn('\u26a0  Connected, but no PathPlannerPath topics were received.');
    } else {
      console.log(`\n\u2714  Synced ${synced} auto routine(s). Dashboard paths are up to date.`);
    }

    process.exit(0);
  }, SYNC_TIMEOUT_MS);
}

// ── Entry point ────────────────────────────────────────────────

if (process.argv.includes('--watch')) {
  startWatchMode();
} else {
  startOneShot();
}
