/**
 * WPILog-compatible binary encoder for the dashboard match recorder.
 *
 * Implements the WPILog v1 format (little-endian):
 *   Header: "WPILOG\r\n" + version (uint16) + extra header length (uint32) + extra
 *   Control records: entry creation / metadata
 *   Data records:    entry id + timestamp + payload
 *
 * Reference: https://github.com/wpilibsuite/allwpilib/blob/main/wpiutil/doc/datalog.adoc
 */

const WPILOG_MAGIC       = 'WPILOG\r\n';
const WPILOG_VERSION     = 0x0100; // 1.0
const CONTROL_START      = 0;
const CONTROL_FINISH     = 1;
const CONTROL_SET_META   = 2;

// ─── Binary helpers ──────────────────────────────────────────────────────────

function encode(strings) {
  return new TextEncoder().encode(strings);
}

class BufferBuilder {
  constructor() {
    this._chunks = [];
    this._length = 0;
  }

  pushBytes(buf) {
    const u8 = buf instanceof Uint8Array ? buf : new Uint8Array(buf);
    this._chunks.push(u8);
    this._length += u8.byteLength;
  }

  pushU8(v)  { const b = new Uint8Array(1);  b[0] = v & 0xff; this.pushBytes(b); }
  pushU16LE(v) { const b = new Uint8Array(2);  new DataView(b.buffer).setUint16(0, v, true); this.pushBytes(b); }
  pushU32LE(v) { const b = new Uint8Array(4);  new DataView(b.buffer).setUint32(0, v, true); this.pushBytes(b); }
  pushI32LE(v) { const b = new Uint8Array(4);  new DataView(b.buffer).setInt32(0, v, true);  this.pushBytes(b); }

  /** uint64 as two uint32 — JS can't do true 64-bit but timestamps fit in 53-bit safe int */
  pushU64LE(v) {
    const lo = v >>> 0;
    const hi = Math.floor(v / 0x100000000) >>> 0;
    this.pushU32LE(lo);
    this.pushU32LE(hi);
  }

  pushLenPrefixedString(s) {
    const encoded = encode(s);
    this.pushU32LE(encoded.byteLength);
    this.pushBytes(encoded);
  }

  build() {
    const out = new Uint8Array(this._length);
    let offset = 0;
    for (const chunk of this._chunks) {
      out.set(chunk, offset);
      offset += chunk.byteLength;
    }
    return out;
  }
}

// ─── Record builder ──────────────────────────────────────────────────────────

/**
 * Encodes a single WPILog record.
 *   entry_id    : uint32
 *   payload_size: variable-width uint
 *   timestamp   : uint64 (μs)
 *   payload     : bytes
 */
function buildRecord(entryId, timestampUs, payload) {
  const b = new BufferBuilder();
  b.pushU32LE(entryId);

  // payload_size: variable-width uint (uses 1, 2, or 4 bytes)
  const payloadSize = payload.byteLength;
  if (payloadSize < 0x100) {
    b.pushU8(payloadSize);
  } else if (payloadSize < 0x10000) {
    b.pushU8(0x08);      // flag byte: 2-byte size follows
    b.pushU16LE(payloadSize);
  } else {
    b.pushU8(0x0c);      // flag byte: 4-byte size follows
    b.pushU32LE(payloadSize);
  }

  b.pushU64LE(timestampUs);
  b.pushBytes(payload);
  return b.build();
}

// ─── Control record payloads ─────────────────────────────────────────────────

function buildStartPayload(entryId, name, type, metadata) {
  const b = new BufferBuilder();
  b.pushU8(CONTROL_START);
  b.pushU32LE(entryId);
  b.pushLenPrefixedString(name);
  b.pushLenPrefixedString(type);
  b.pushLenPrefixedString(metadata || '');
  return b.build();
}

function buildFinishPayload(entryId) {
  const b = new BufferBuilder();
  b.pushU8(CONTROL_FINISH);
  b.pushU32LE(entryId);
  return b.build();
}

// ─── Data record payloads ────────────────────────────────────────────────────

function encodeDouble(v) {
  const b = new Uint8Array(8);
  new DataView(b.buffer).setFloat64(0, v, true);
  return b;
}

function encodeFloat(v) {
  const b = new Uint8Array(4);
  new DataView(b.buffer).setFloat32(0, v, true);
  return b;
}

function encodeBoolean(v) {
  const b = new Uint8Array(1);
  b[0] = v ? 1 : 0;
  return b;
}

function encodeString(s) {
  const enc = encode(s);
  const b = new Uint8Array(4 + enc.byteLength);
  new DataView(b.buffer).setUint32(0, enc.byteLength, true);
  b.set(enc, 4);
  return b;
}

function encodeDoubleArray(arr) {
  const b = new Uint8Array(4 + arr.length * 8);
  const dv = new DataView(b.buffer);
  dv.setUint32(0, arr.length, true);
  for (let i = 0; i < arr.length; i++) {
    dv.setFloat64(4 + i * 8, arr[i], true);
  }
  return b;
}

// ─── Public API ──────────────────────────────────────────────────────────────

/**
 * Encode a full match log into a WPILog binary Uint8Array.
 *
 * @param {object} log - { startTimestamp, entries: [{name, type, timestamps, values}] }
 * @returns {Uint8Array}
 */
export function encodeWpilog(log) {
  const bb = new BufferBuilder();

  // ── File header ──
  bb.pushBytes(encode(WPILOG_MAGIC));
  bb.pushU16LE(WPILOG_VERSION);
  const extraHeader = `Chronos match recording; start=${new Date(log.startTimestamp).toISOString()}`;
  const extraHeaderBytes = encode(extraHeader);
  bb.pushU32LE(extraHeaderBytes.byteLength);
  bb.pushBytes(extraHeaderBytes);

  // ── Control records — entry starts ──
  const originUs = Math.round(log.startTimestamp * 1000); // ms → μs
  for (const entry of log.entries) {
    const payload = buildStartPayload(entry.id, entry.name, entry.type, entry.metadata || '');
    bb.pushBytes(buildRecord(0, originUs, payload));
  }

  // ── Data records ──
  for (const entry of log.entries) {
    const n = Math.min(entry.timestamps.length, entry.values.length);
    for (let i = 0; i < n; i++) {
      const tUs = Math.round(entry.timestamps[i] * 1000); // ms → μs

      let payload;
      switch (entry.type) {
        case 'double':   payload = encodeDouble(entry.values[i]);  break;
        case 'float':    payload = encodeFloat(entry.values[i]);   break;
        case 'boolean':  payload = encodeBoolean(entry.values[i]); break;
        case 'string':   payload = encodeString(String(entry.values[i])); break;
        case 'double[]': payload = encodeDoubleArray(entry.values[i]); break;
        default:         payload = encodeString(JSON.stringify(entry.values[i])); break;
      }

      bb.pushBytes(buildRecord(entry.id, tUs, payload));
    }
  }

  // ── Control records — entry finishes ──
  const endUs = Math.round((log.startTimestamp + log.durationMs) * 1000);
  for (const entry of log.entries) {
    const payload = buildFinishPayload(entry.id);
    bb.pushBytes(buildRecord(0, endUs, payload));
  }

  return bb.build();
}

// ─── Decoder ─────────────────────────────────────────────────────────────────

const _td = new TextDecoder();

/**
 * Read a length-prefixed UTF-8 string at absolute position `pos`.
 * Returns { str, advance } where advance is the number of bytes consumed.
 */
function _readLenStr(dv, u8, pos, end) {
  if (pos + 4 > end) return { str: null, advance: 0 };
  const len = dv.getUint32(pos, true);
  if (len > 1_000_000 || pos + 4 + len > end) return { str: null, advance: 0 };
  return { str: _td.decode(u8.subarray(pos + 4, pos + 4 + len)), advance: 4 + len };
}

/**
 * Decode a single WPILog data record payload into a JS value.
 * Returns null for unknown/unsupported types.
 */
function _decodeValue(type, dv, u8, offset, size) {
  switch (type) {
    case 'double':   return size >= 8 ? dv.getFloat64(offset, true) : null;
    case 'float':    return size >= 4 ? dv.getFloat32(offset, true) : null;
    case 'boolean':  return size >= 1 ? (u8[offset] !== 0) : null;
    case 'int64': {
      if (size < 8) return null;
      const lo = dv.getUint32(offset, true);
      const hi = dv.getInt32(offset + 4, true);
      return hi * 4294967296 + lo;
    }
    case 'string':
      return _td.decode(u8.subarray(offset, offset + size));
    case 'double[]': {
      const n = Math.floor(size / 8);
      const arr = new Array(n);
      for (let i = 0; i < n; i++) arr[i] = dv.getFloat64(offset + i * 8, true);
      return arr;
    }
    case 'float[]': {
      const n = Math.floor(size / 4);
      const arr = new Array(n);
      for (let i = 0; i < n; i++) arr[i] = dv.getFloat32(offset + i * 4, true);
      return arr;
    }
    case 'boolean[]': {
      const arr = new Array(size);
      for (let i = 0; i < size; i++) arr[i] = u8[offset + i] !== 0;
      return arr;
    }
    case 'int64[]': {
      const n = Math.floor(size / 8);
      const arr = new Array(n);
      for (let i = 0; i < n; i++) {
        const lo = dv.getUint32(offset + i * 8, true);
        const hi = dv.getInt32(offset + i * 8 + 4, true);
        arr[i] = hi * 4294967296 + lo;
      }
      return arr;
    }
    case 'string[]': {
      const arr = [];
      let p = offset;
      while (p + 4 <= offset + size) {
        const slen = dv.getUint32(p, true);
        p += 4;
        if (p + slen > offset + size) break;
        arr.push(_td.decode(u8.subarray(p, p + slen)));
        p += slen;
      }
      return arr;
    }
    default:
      return null; // struct, protobuf, etc. — skip
  }
}

/**
 * Decode a WPILog v1 binary file into a replay-compatible log object.
 *
 * The returned object has the same shape as logs produced by useMatchRecorder,
 * so it can be passed directly to MatchReplayViewer.
 *
 * @param {ArrayBuffer} buffer - raw file bytes
 * @returns {{ startTimestamp, durationMs, entries, source: 'upload' }}
 */
export function decodeWpilog(buffer) {
  const u8 = new Uint8Array(buffer);
  const dv = new DataView(buffer);

  if (u8.length < 14) throw new Error('File too short to be a WPILog');

  const magic = _td.decode(u8.subarray(0, 8));
  if (magic !== WPILOG_MAGIC) throw new Error('Not a valid WPILog file (bad magic bytes)');

  const version = dv.getUint16(8, true);
  if ((version & 0xff00) !== 0x0100) {
    throw new Error(`Unsupported WPILog version: 0x${version.toString(16)}`);
  }

  const extraLen = dv.getUint32(10, true);
  const extraStr = extraLen > 0 ? _td.decode(u8.subarray(14, 14 + extraLen)) : '';
  let pos = 14 + extraLen;

  // Recover wall-clock start time from the extra header written by our encoder
  let startTimestamp = Date.now();
  const startMatch = extraStr.match(/start=([^;]+)/);
  if (startMatch) {
    const t = Date.parse(startMatch[1].trim());
    if (!isNaN(t)) startTimestamp = t;
  }

  // entryId → { name, type }
  const entryMeta = new Map();
  // topic name → accumulated data
  const entryData = new Map();

  let firstUs = null;
  let lastUs = 0;

  while (pos + 13 <= u8.length) {
    const entryId = dv.getUint32(pos, true);
    pos += 4;

    // Variable-length payload size (1, 3, or 5 bytes)
    const s0 = u8[pos];
    let payloadSize;
    if (s0 < 254) {
      payloadSize = s0;
      pos += 1;
    } else if (s0 === 254) {
      if (pos + 3 > u8.length) break;
      payloadSize = dv.getUint16(pos + 1, true);
      pos += 3;
    } else {
      if (pos + 5 > u8.length) break;
      payloadSize = dv.getUint32(pos + 1, true);
      pos += 5;
    }

    if (pos + 8 > u8.length) break;
    // Timestamp: uint64le in microseconds (read as two uint32 to avoid BigInt)
    const tsLo = dv.getUint32(pos, true);
    const tsHi = dv.getUint32(pos + 4, true);
    const timestampUs = tsHi * 4294967296 + tsLo;
    pos += 8;

    if (pos + payloadSize > u8.length) break;
    const payStart = pos;
    pos += payloadSize;

    // Track time range from data records only
    if (entryId !== 0) {
      if (firstUs === null) firstUs = timestampUs;
      if (timestampUs > lastUs) lastUs = timestampUs;
    }

    if (entryId === 0) {
      // ── Control record ───────────────────────────────────────────────────
      if (payloadSize < 1) continue;
      const ctrl = u8[payStart];

      if (ctrl === CONTROL_START && payloadSize >= 5) {
        const registeredId = dv.getUint32(payStart + 1, true);
        let p = payStart + 5;
        const end = payStart + payloadSize;

        const { str: name, advance: na } = _readLenStr(dv, u8, p, end);
        if (name === null) continue;
        p += na;

        const { str: type } = _readLenStr(dv, u8, p, end);
        if (type === null) continue;

        entryMeta.set(registeredId, { name, type });
      }
      // CONTROL_FINISH and CONTROL_SET_META are ignored
    } else {
      // ── Data record ──────────────────────────────────────────────────────
      const meta = entryMeta.get(entryId);
      if (!meta) continue;

      const origin = firstUs ?? timestampUs;
      const relMs = (timestampUs - origin) / 1000;

      try {
        const value = _decodeValue(meta.type, dv, u8, payStart, payloadSize);
        if (value === null) continue;

        if (!entryData.has(meta.name)) {
          entryData.set(meta.name, {
            name: meta.name, type: meta.type, timestamps: [], values: [],
          });
        }
        const e = entryData.get(meta.name);
        e.timestamps.push(relMs);
        e.values.push(value);
      } catch { /* skip malformed records */ }
    }
  }

  const origin = firstUs ?? 0;
  const durationMs = Math.max(0, (lastUs - origin) / 1000);

  return {
    startTimestamp,
    durationMs,
    entries: Array.from(entryData.values()).filter(e => e.timestamps.length > 0),
    source: 'upload',
  };
}

/**
 * Parse an uploaded file (.wpilog binary or .json dashboard export) into a
 * replay-compatible log object.
 *
 * @param {File} file
 * @returns {Promise<object>}
 */
export async function parseUploadedLog(file) {
  const ext = (file.name.split('.').pop() ?? '').toLowerCase();
  if (ext === 'json') {
    const text = await file.text();
    const log = JSON.parse(text);
    if (!Array.isArray(log.entries)) throw new Error('JSON file has no entries array');
    return { ...log, source: 'upload-json' };
  }
  if (ext === 'wpilog') {
    const buf = await file.arrayBuffer();
    return decodeWpilog(buf);
  }
  throw new Error(`Unsupported file type ".${ext || '?'}". Please use .wpilog or .json`);
}

/**
 * Trim a log to the time window [startMs, endMs]. Timestamps in the returned
 * log are shifted so the clip starts at 0.
 *
 * @param {object} log
 * @param {number} startMs
 * @param {number} endMs
 * @returns {object}
 */
export function trimLog(log, startMs, endMs) {
  const clipStart = Math.max(0, Math.min(startMs, endMs));
  const clipEnd = Math.max(0, Math.max(startMs, endMs));
  const rangeMs = Math.max(0, clipEnd - clipStart);
  const clipStartTimestamp = (log.startTimestamp ?? Date.now()) + clipStart;

  const entries = (log.entries ?? [])
    .map((entry) => {
      const timestamps = [];
      const values = [];
      const count = Math.min(entry.timestamps?.length ?? 0, entry.values?.length ?? 0);
      for (let i = 0; i < count; i++) {
        const sampleTime = entry.timestamps[i];
        if (typeof sampleTime !== 'number') continue;
        if (sampleTime < clipStart || sampleTime > clipEnd) continue;
        timestamps.push(sampleTime - clipStart);
        values.push(entry.values[i]);
      }
      return { ...entry, timestamps, values };
    })
    .filter((entry) => entry.timestamps.length > 0);

  return {
    ...log,
    startTimestamp: clipStartTimestamp,
    durationMs: rangeMs,
    entries,
    source: `${log.source ?? 'recording'}-trimmed`,
  };
}

/**
 * Download a clipped portion of a log as .wpilog.
 */
export function downloadTrimmedWpilog(log, startMs, endMs) {
  const clipped = trimLog(log, startMs, endMs);
  downloadWpilog(clipped);
}

/**
 * Trigger a browser download of a WPILog binary file.
 */
export function downloadWpilog(log) {
  const bytes = encodeWpilog(log);
  const blob  = new Blob([bytes], { type: 'application/octet-stream' });
  const url   = URL.createObjectURL(blob);
  const a     = document.createElement('a');
  const ts    = new Date(log.startTimestamp).toISOString().replace(/[:.]/g, '-').slice(0, 19);
  a.href      = url;
  a.download  = `NFR_Match_${ts}.wpilog`;
  document.body.appendChild(a);
  a.click();
  document.body.removeChild(a);
  URL.revokeObjectURL(url);
}

/**
 * Trigger a browser download of the log as human-readable JSON (for debugging).
 */
export function downloadLogJson(log) {
  const blob = new Blob([JSON.stringify(log, null, 2)], { type: 'application/json' });
  const url  = URL.createObjectURL(blob);
  const a    = document.createElement('a');
  const ts   = new Date(log.startTimestamp).toISOString().replace(/[:.]/g, '-').slice(0, 19);
  a.href     = url;
  a.download = `NFR_Match_${ts}.json`;
  document.body.appendChild(a);
  a.click();
  document.body.removeChild(a);
  URL.revokeObjectURL(url);
}
