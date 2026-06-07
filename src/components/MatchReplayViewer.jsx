/**
 * MatchReplayViewer
 *
 * Scrubber-based playback of a recorded or uploaded match log.
 * – Renders robot pose on the FieldMap with a timeline scrubber.
 * – Auto-detects pose topics from common WPILib/AdvantageKit names.
 * – Falls back to a topic picker for unknown uploaded log formats.
 * – Supports both individual double topics and 3-element double[] arrays.
 *
 * Props:
 *   log     – match log object (from useMatchRecorder OR decodeWpilog)
 *   onClose – dismiss callback
 */

import { useEffect, useRef, useState } from 'react';
import FieldMap from './FieldMap';
import { downloadTrimmedWpilog } from '../utils/wpilog';
import { IconPlay, IconPause, IconDownload } from '../utils/icons';

const PlayIcon     = () => <IconPlay     size={12}/>;
const PauseIcon    = () => <IconPause    size={12}/>;
const DownloadIcon = () => <IconDownload size={13}/>;

// ── Pose topic candidate lists ─────────────────────────────────────────────

const POSE_X_KEYS = [
  '/Robot/Drive/PoseX',
  '/NFRDashboard/replay/PoseX',
  '/SmartDashboard/PoseX',
  '/Odometry/X',
  'PoseX',
];
const POSE_Y_KEYS = [
  '/Robot/Drive/PoseY',
  '/NFRDashboard/replay/PoseY',
  '/SmartDashboard/PoseY',
  '/Odometry/Y',
  'PoseY',
];
const POSE_HDG_KEYS = [
  '/Robot/Drive/PoseHeading',
  '/NFRDashboard/replay/PoseHeading',
  '/SmartDashboard/PoseHeading',
  '/Odometry/Heading',
  'PoseHeading',
];
// 3-element double[] in [x, y, rotation] order (AdvantageKit / SmartDashboard Field2d)
const POSE_ARRAY_KEYS = [
  '/AdvantageKit/RealOutputs/Drive/Pose',
  '/SmartDashboard/Field/Robot',
  '/Field/Robot',
  '/NFRDashboard/replay/Pose',
];

// ── Helpers ────────────────────────────────────────────────────────────────

function findEntry(entries, keys) {
  for (const key of keys) {
    const e = entries.find(e => e.name === key);
    if (e) return e;
  }
  return null;
}

/**
 * Sample a scalar entry at time `t` (ms relative to match start) with linear
 * interpolation for numbers and step-hold for other types.
 */
function sampleAt(entry, t) {
  if (!entry || !entry.timestamps.length) return null;
  const ts = entry.timestamps;
  const vs = entry.values;
  if (t <= ts[0]) return vs[0];
  if (t >= ts[ts.length - 1]) return vs[vs.length - 1];
  let lo = 0, hi = ts.length - 1;
  while (lo < hi - 1) {
    const mid = (lo + hi) >> 1;
    if (ts[mid] <= t) lo = mid; else hi = mid;
  }
  const t0 = ts[lo], t1 = ts[hi], v0 = vs[lo], v1 = vs[hi];
  if (typeof v0 === 'number' && typeof v1 === 'number') {
    return v0 + (v1 - v0) * ((t - t0) / (t1 - t0));
  }
  if (Array.isArray(v0) && Array.isArray(v1) && v0.length === v1.length) {
    const frac = (t - t0) / (t1 - t0);
    return v0.map((a, i) => a + ((v1[i] ?? a) - a) * frac);
  }
  return v0;
}

/**
 * Detect the heading unit used in a series.
 * If the max absolute value is ≤ 7 (< 2π*1.1), treat as radians.
 */
function detectHdgUnit(values, limit = 200) {
  const sample = values.slice(0, limit);
  const peak = Math.max(...sample.map(v => Math.abs(Array.isArray(v) ? (v[2] ?? 0) : v)));
  return peak <= 7 ? 'rad' : 'deg';
}

/**
 * Auto-detect the best pose source from the entries array.
 * Returns a poseConfig object.
 */
function detectPoseSource(entries) {
  // 1. Individual topics
  const xe = findEntry(entries, POSE_X_KEYS);
  const ye = findEntry(entries, POSE_Y_KEYS);
  const he = findEntry(entries, POSE_HDG_KEYS);
  if (xe && ye && he) {
    return {
      mode: 'individual',
      xKey: xe.name, yKey: ye.name, hdgKey: he.name,
      hdgUnit: detectHdgUnit(he.values),
    };
  }
  // 2. Pose array
  const ae = findEntry(entries, POSE_ARRAY_KEYS);
  if (ae && ae.type === 'double[]' && Array.isArray(ae.values[0]) && ae.values[0].length >= 3) {
    return { mode: 'array', poseKey: ae.name, hdgUnit: detectHdgUnit(ae.values) };
  }
  // 3. Nothing found — show picker
  return { mode: 'none' };
}

// ── Component ──────────────────────────────────────────────────────────────

export default function MatchReplayViewer({ log, onClose }) {
  const [playhead, setPlayhead] = useState(0);
  const [playing, setPlaying]   = useState(false);
  const [speedVal, setSpeedVal] = useState(1);
  const [clipStartMs, setClipStartMs] = useState(0);
  const [clipEndMs, setClipEndMs] = useState(log?.durationMs ?? 0);
  const [showPicker, setShowPicker] = useState(false);
  const [poseConfig, setPoseConfig] = useState(() => detectPoseSource(log?.entries ?? []));
  // picker draft state
  const [draft, setDraft] = useState({ xKey: '', yKey: '', hdgKey: '', hdgUnit: 'deg' });

  const rafRef    = useRef(null);
  const lastTime  = useRef(null);
  const speedRef  = useRef(1);

  const duration = log?.durationMs ?? 0;
  const entries  = log?.entries ?? [];
  const isUpload = log?.source === 'upload' || log?.source === 'upload-json';

  // If log changes (e.g. new file uploaded), re-detect
  useEffect(() => {
    setPoseConfig(detectPoseSource(entries));
    setPlayhead(0);
    setPlaying(false);
    setClipStartMs(0);
    setClipEndMs(log?.durationMs ?? 0);
  }, [log]);

  // Show picker automatically for uploads with no detected pose
  useEffect(() => {
    if (isUpload && poseConfig.mode === 'none') setShowPicker(true);
  }, [isUpload, poseConfig.mode]);

  // ── Derived pose ──────────────────────────────────────────────────────────

  let posX = 0, posY = 0, posH = 0, hasPose = false;

  if (poseConfig.mode === 'individual') {
    const xe = entries.find(e => e.name === poseConfig.xKey);
    const ye = entries.find(e => e.name === poseConfig.yKey);
    const he = entries.find(e => e.name === poseConfig.hdgKey);
    posX = sampleAt(xe, playhead) ?? 0;
    posY = sampleAt(ye, playhead) ?? 0;
    const rawH = sampleAt(he, playhead) ?? 0;
    posH = poseConfig.hdgUnit === 'rad' ? rawH * (180 / Math.PI) : rawH;
    hasPose = true;
  } else if (poseConfig.mode === 'array') {
    const ae = entries.find(e => e.name === poseConfig.poseKey);
    const arr = sampleAt(ae, playhead);
    if (Array.isArray(arr) && arr.length >= 3) {
      posX = arr[0];
      posY = arr[1];
      const rawH = arr[2];
      posH = poseConfig.hdgUnit === 'rad' ? rawH * (180 / Math.PI) : rawH;
      hasPose = true;
    }
  }

  // ── Playback loop ─────────────────────────────────────────────────────────

  useEffect(() => {
    speedRef.current = speedVal;
  }, [speedVal]);

  useEffect(() => {
    if (playing) {
      const loop = (now) => {
        if (lastTime.current !== null) {
          const dt = (now - lastTime.current) * speedRef.current;
          setPlayhead(prev => {
            const next = prev + dt;
            if (next >= duration) { setPlaying(false); return duration; }
            return next;
          });
        }
        lastTime.current = now;
        rafRef.current = requestAnimationFrame(loop);
      };
      lastTime.current = null;
      rafRef.current = requestAnimationFrame(loop);
    } else {
      cancelAnimationFrame(rafRef.current);
    }
    return () => cancelAnimationFrame(rafRef.current);
  }, [playing, duration]);

  const togglePlay = () => {
    if (playhead >= duration) setPlayhead(0);
    setPlaying(p => !p);
  };
  const handleScrub = (e) => { setPlayhead(Number(e.target.value)); setPlaying(false); };
  const formatTime  = (ms) => {
    const s = Math.floor(ms / 1000);
    return `${Math.floor(s / 60)}:${String(s % 60).padStart(2, '0')}`;
  };

  const clipRangeStart = Math.min(clipStartMs, clipEndMs);
  const clipRangeEnd = Math.max(clipStartMs, clipEndMs);
  const canDownloadClip = clipRangeEnd > clipRangeStart;
  const handleDownloadClip = () => {
    if (!canDownloadClip) return;
    downloadTrimmedWpilog(log, clipRangeStart, clipRangeEnd);
  };

  // ── Topic picker helpers ──────────────────────────────────────────────────

  const doubleEntries = entries.filter(e => e.type === 'double').map(e => e.name).sort();
  const arrayEntries  = entries.filter(e => e.type === 'double[]' && Array.isArray(e.values[0]) && e.values[0].length >= 3).map(e => e.name).sort();

  const applyPicker = () => {
    if (draft.poseKey) {
      setPoseConfig({ mode: 'array', poseKey: draft.poseKey, hdgUnit: draft.hdgUnit || 'rad' });
    } else if (draft.xKey && draft.yKey && draft.hdgKey) {
      setPoseConfig({ mode: 'individual', xKey: draft.xKey, yKey: draft.yKey, hdgKey: draft.hdgKey, hdgUnit: draft.hdgUnit || 'deg' });
    }
    setShowPicker(false);
  };

  if (!log) return null;

  return (
    <div
      className="replay-overlay"
      role="dialog"
      aria-modal="true"
      aria-label="Match Replay"
      onWheel={e => e.stopPropagation()}
    >
      <div className="replay-inner">

        {/* ── Toolbar ───────────────────────────────────────────────────── */}
        <div className="replay-toolbar">
          <div className="replay-title-row">
            <span className="replay-title">
              {isUpload ? 'Uploaded Log' : 'Match Replay'}
              {' — '}
              {new Date(log.startTimestamp).toLocaleString()}
            </span>
            <span className="replay-meta">
              {formatTime(duration)} &nbsp;·&nbsp; {entries.length} topics
              {isUpload && ' · uploaded'}
            </span>
          </div>
          <div className="replay-toolbar-actions">
            {entries.length > 0 && (
              <button
                className="btn btn-sm btn-ghost"
                onClick={() => { setShowPicker(p => !p); setDraft({ xKey: '', yKey: '', hdgKey: '', hdgUnit: 'deg' }); }}
                title="Configure pose source topics"
              >
                ⚙ Configure
              </button>
            )}
            <button className="btn btn-sm btn-ghost replay-close" onClick={onClose}>✕</button>
          </div>
        </div>

        {/* ── Topic picker ──────────────────────────────────────────────── */}
        {showPicker && (
          <div className="replay-picker">
            <div className="replay-picker-title">Configure Pose Topics</div>

            {arrayEntries.length > 0 && (
              <div className="replay-picker-section">
                <label className="replay-picker-label">Pose array (x, y, rotation)</label>
                <select
                  className="replay-picker-select"
                  value={draft.poseKey ?? ''}
                  onChange={e => setDraft(d => ({ ...d, poseKey: e.target.value, xKey: '', yKey: '', hdgKey: '' }))}
                >
                  <option value="">— None —</option>
                  {arrayEntries.map(n => <option key={n} value={n}>{n}</option>)}
                </select>
                {draft.poseKey && (
                  <div className="replay-picker-row">
                    <label>Rotation unit:</label>
                    {['rad', 'deg'].map(u => (
                      <label key={u} className="replay-picker-radio">
                        <input type="radio" name="poseArrUnit" value={u}
                          checked={(draft.hdgUnit ?? 'rad') === u}
                          onChange={() => setDraft(d => ({ ...d, hdgUnit: u }))} />
                        {u}
                      </label>
                    ))}
                  </div>
                )}
              </div>
            )}

            {!draft.poseKey && doubleEntries.length > 0 && (
              <div className="replay-picker-section">
                <label className="replay-picker-label">Individual topics</label>
                {[
                  { label: 'X (meters)', key: 'xKey' },
                  { label: 'Y (meters)', key: 'yKey' },
                  { label: 'Heading',    key: 'hdgKey' },
                ].map(({ label, key }) => (
                  <div key={key} className="replay-picker-row">
                    <span className="replay-picker-field-label">{label}</span>
                    <select
                      className="replay-picker-select"
                      value={draft[key] ?? ''}
                      onChange={e => setDraft(d => ({ ...d, [key]: e.target.value, poseKey: '' }))}
                    >
                      <option value="">— None —</option>
                      {doubleEntries.map(n => <option key={n} value={n}>{n}</option>)}
                    </select>
                  </div>
                ))}
                {draft.hdgKey && (
                  <div className="replay-picker-row">
                    <label>Heading unit:</label>
                    {['deg', 'rad'].map(u => (
                      <label key={u} className="replay-picker-radio">
                        <input type="radio" name="indivUnit" value={u}
                          checked={(draft.hdgUnit ?? 'deg') === u}
                          onChange={() => setDraft(d => ({ ...d, hdgUnit: u }))} />
                        {u}
                      </label>
                    ))}
                  </div>
                )}
              </div>
            )}

            {doubleEntries.length === 0 && arrayEntries.length === 0 && (
              <div className="replay-picker-empty">
                No numeric topics found in this log.
              </div>
            )}

            <div className="replay-picker-actions">
              <button
                className="btn btn-sm btn-primary"
                disabled={!draft.poseKey && !(draft.xKey && draft.yKey && draft.hdgKey)}
                onClick={applyPicker}
              >
                Apply
              </button>
              <button className="btn btn-sm btn-ghost" onClick={() => setShowPicker(false)}>
                Cancel
              </button>
            </div>
          </div>
        )}

        {/* ── Field view ────────────────────────────────────────────────── */}
        <div className="replay-field">
          {hasPose ? (
            <FieldMap
              robotPose={{ x: posX, y: posY, heading: posH }}
              showRobot={true}
              alliance="blue"
              paths={[]}
              width={640}
            />
          ) : (
            <div className="replay-no-pose">
              <FieldMap paths={[]} robots={null} width={640} />
              <div className="replay-no-pose-overlay">
                {poseConfig.mode === 'none'
                  ? 'No robot pose topics found. Use ⚙ Configure to pick topics.'
                  : 'Configuring pose source…'}
              </div>
            </div>
          )}
        </div>

        {/* ── Controls ──────────────────────────────────────────────────── */}
        <div className="replay-controls">
          <button className="btn btn-sm btn-primary replay-play-btn" onClick={togglePlay}>
            {playing ? <><PauseIcon/> Pause</> : <><PlayIcon/> Play</>}
          </button>

          <div className="replay-scrubber-wrap">
            <span className="replay-time">{formatTime(playhead)}</span>
            <input
              type="range" className="replay-scrubber"
              min={0} max={Math.max(1, duration)} step={50}
              value={playhead} onChange={handleScrub}
            />
            <span className="replay-time">{formatTime(duration)}</span>
          </div>

          <div className="replay-speed">
            {[0.25, 0.5, 1, 2, 4].map(s => (
              <button
                key={s}
                className={`btn btn-sm ${speedVal === s ? 'btn-primary' : 'btn-ghost'}`}
                onClick={() => setSpeedVal(s)}
              >
                {s}×
              </button>
            ))}
          </div>

          <div className="replay-clip-controls">
            <div className="replay-clip-row">
              <button
                className="btn btn-sm btn-ghost"
                onClick={() => setClipStartMs(playhead)}
                title="Set clip start to the current playhead"
              >
                Mark Start
              </button>
              <span className="replay-clip-time">{formatTime(clipRangeStart)}</span>
            </div>
            <div className="replay-clip-row">
              <button
                className="btn btn-sm btn-ghost"
                onClick={() => setClipEndMs(playhead)}
                title="Set clip end to the current playhead"
              >
                Mark End
              </button>
              <span className="replay-clip-time">{formatTime(clipRangeEnd)}</span>
            </div>
            <div className="replay-clip-row">
              <button
                className="btn btn-sm btn-primary"
                onClick={handleDownloadClip}
                disabled={!canDownloadClip}
                title="Download the selected time range as a trimmed .wpilog"
              >
                <DownloadIcon/> Download Clip .wpilog
              </button>
              <button
                className="btn btn-sm btn-ghost"
                onClick={() => { setClipStartMs(0); setClipEndMs(duration); }}
              >
                Reset Clip
              </button>
            </div>
          </div>
        </div>

        {/* ── Topic list (uploaded logs only) ───────────────────────────── */}
        {isUpload && entries.length > 0 && (
          <details className="replay-topics">
            <summary className="replay-topics-summary">
              Log Topics ({entries.length})
            </summary>
            <div className="replay-topics-list">
              {entries.map(e => (
                <div key={e.name} className="replay-topic-row">
                  <span className="replay-topic-type">{e.type}</span>
                  <span className="replay-topic-name">{e.name}</span>
                  <span className="replay-topic-samples">{e.timestamps.length} samples</span>
                </div>
              ))}
            </div>
          </details>
        )}

      </div>
    </div>
  );
}
