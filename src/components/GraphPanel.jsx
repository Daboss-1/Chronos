/**
 * GraphPanel
 *
 * Canvas-based time-series graph.
 * – Drag any NT value card onto the panel to add a series.
 * – Scrub time from RewindContext shows as a vertical orange cursor.
 * – Window width: 10 / 30 / 60 / 120 s (user-selectable).
 * – Topics list persisted per graphId in localStorage.
 * – Manual "Add topic" text input as fallback.
 *
 * Props:
 *   graphId  – unique string for persistence key (e.g. "teleop-graph")
 */

import { useCallback, useEffect, useRef, useState } from 'react';
import { useRewind } from '../contexts/RewindContext';
import { useLogReplay } from '../contexts/LogReplayContext';

const COLORS = [
  '#4a90d9', '#e6b422', '#4caf78', '#d94a4a',
  '#9b59b6', '#1abc9c', '#e67e22', '#e74c3c',
];

// ── Persistence ───────────────────────────────────────────────────────────────

function loadTopics(graphId) {
  try {
    const raw = localStorage.getItem(`nfr-graph-${graphId}`);
    return raw ? JSON.parse(raw) : [];
  } catch { return []; }
}
function saveTopics(graphId, topics) {
  try { localStorage.setItem(`nfr-graph-${graphId}`, JSON.stringify(topics)); }
  catch { /* ignore */ }
}

// ── Canvas helpers ────────────────────────────────────────────────────────────

function formatYLabel(v) {
  if (Math.abs(v) >= 10000) return v.toExponential(1);
  if (Math.abs(v) >= 100)   return v.toFixed(0);
  if (Math.abs(v) >= 1)     return v.toFixed(2);
  if (Math.abs(v) >= 0.01)  return v.toFixed(3);
  return v.toExponential(1);
}

function niceStep(range, targetCount) {
  const raw  = range / targetCount;
  const mag  = Math.pow(10, Math.floor(Math.log10(raw)));
  const norm = raw / mag;
  const nice = norm < 1.5 ? 1 : norm < 3.5 ? 2 : norm < 7.5 ? 5 : 10;
  return nice * mag;
}

// ── Component ─────────────────────────────────────────────────────────────────

export default function GraphPanel({ graphId }) {
  const { bufferRef, scrubTime, startTime } = useRewind();
  // Log-replay context — null when in live mode
  const logReplay = useLogReplay();
  const isLogMode = logReplay != null;

  const containerRef = useRef(null);
  const canvasRef    = useRef(null);
  const redrawRef    = useRef(null);

  const [size, setSize]           = useState({ w: 0, h: 0 });
  const [topics, setTopics]       = useState(() => loadTopics(graphId));
  const [windowSec, setWindowSec] = useState(30);
  const [isDragOver, setIsDragOver] = useState(false);
  const [manualInput, setManualInput] = useState('');
  const [showAddInput, setShowAddInput] = useState(false);
  // Drag-enter counter: prevents false dragLeave fires when cursor moves over children
  const dragCounterRef = useRef(0);

  // Re-initialize when graphId changes (e.g. switching tabs)
  useEffect(() => {
    setTopics(loadTopics(graphId));
  }, [graphId]);

  // Measure container
  useEffect(() => {
    const el = containerRef.current;
    if (!el) return;
    const ro = new ResizeObserver(entries => {
      const r = entries[0]?.contentRect;
      if (r && r.width > 0 && r.height > 0)
        setSize({ w: Math.floor(r.width), h: Math.floor(r.height) });
    });
    ro.observe(el);
    const r = el.getBoundingClientRect();
    if (r.width > 0) setSize({ w: Math.floor(r.width), h: Math.floor(r.height) });
    return () => ro.disconnect();
  }, []);

  // ── Canvas draw ─────────────────────────────────────────────────────────────

  const draw = useCallback(() => {
    const canvas = canvasRef.current;
    if (!canvas || size.w === 0 || size.h === 0) return;

    const W = size.w, H = size.h;
    const ctx = canvas.getContext('2d');

    // Read CSS vars for theme-awareness
    const style      = getComputedStyle(document.documentElement);
    const bgColor    = style.getPropertyValue('--color-bg-card').trim()      || '#1e1e26';
    const gridColor  = style.getPropertyValue('--color-border').trim()       || '#2e2e3a';
    const labelColor = style.getPropertyValue('--color-text-muted').trim()   || '#606070';
    const axisColor  = style.getPropertyValue('--color-border-light').trim() || '#3a3a48';

    const PAD = { l: 60, r: 12, t: 10, b: 32 };
    const pw = W - PAD.l - PAD.r;
    const ph = H - PAD.t - PAD.b;
    if (pw <= 0 || ph <= 0) return;

    // Time window
    const nowMs        = Date.now();
    // In log mode: right edge tracks the playhead (absolute ms = startTimestamp + playhead)
    const logAbsMs     = isLogMode
      ? (logReplay.log.startTimestamp + logReplay.displayPlayhead)
      : null;
    const rightEdgeMs  = isLogMode ? logAbsMs : (scrubTime ?? nowMs);
    const leftEdgeMs   = rightEdgeMs - windowSec * 1000;

    // Collect visible points per series
    const seriesData = topics.map((topic, i) => {
      let pts = [];
      if (isLogMode) {
        // Log mode: entry timestamps are relative ms from log start
        const entry = logReplay.log?.entries?.find(e => e.name === topic.path);
        if (entry) {
          const base = logReplay.log.startTimestamp;
          for (let j = 0; j < entry.timestamps.length; j++) {
            const absT = base + entry.timestamps[j];
            if (absT < leftEdgeMs - 2000) continue;
            if (absT > rightEdgeMs + 500) break;
            const v = entry.values[j];
            if (typeof v === 'number') pts.push({ t: absT, v });
          }
        }
      } else {
        const series = bufferRef.current.get(topic.path);
        if (series) {
          const ts = series.timestamps;
          const vs = series.values;
          for (let j = 0; j < ts.length; j++) {
            if (ts[j] < leftEdgeMs - 2000) continue;
            if (ts[j] > rightEdgeMs + 500)  break;
            pts.push({ t: ts[j], v: vs[j] });
          }
        }
      }
      return { topic, color: topic.color, pts };
    });

    // Y range
    let yMin = Infinity, yMax = -Infinity;
    for (const sd of seriesData) {
      for (const { t, v } of sd.pts) {
        if (t >= leftEdgeMs && t <= rightEdgeMs) {
          if (v < yMin) yMin = v;
          if (v > yMax) yMax = v;
        }
      }
    }
    if (!isFinite(yMin)) { yMin = 0; yMax = 1; }
    if (yMin === yMax)   { yMin -= 0.5; yMax += 0.5; }
    const yRange = yMax - yMin;
    const yPad   = yRange * 0.12;
    yMin -= yPad; yMax += yPad;

    // Coordinate helpers
    const toX = t  => PAD.l + (t  - leftEdgeMs)  / (rightEdgeMs - leftEdgeMs) * pw;
    const toY = v  => PAD.t + ph - (v - yMin) / (yMax - yMin) * ph;

    // ── Clear background ──
    ctx.fillStyle = bgColor;
    ctx.fillRect(0, 0, W, H);

    // ── Y grid + labels ──
    const yStep = niceStep(yMax - yMin, 4);
    const yStart = Math.ceil(yMin / yStep) * yStep;
    ctx.font      = '10px system-ui, sans-serif';
    ctx.textAlign = 'right';
    ctx.textBaseline = 'middle';

    for (let v = yStart; v <= yMax + yStep * 0.01; v += yStep) {
      const y = toY(v);
      if (y < PAD.t - 1 || y > PAD.t + ph + 1) continue;

      ctx.strokeStyle = gridColor;
      ctx.lineWidth   = 1;
      ctx.beginPath();
      ctx.moveTo(PAD.l, y);
      ctx.lineTo(PAD.l + pw, y);
      ctx.stroke();

      ctx.fillStyle = labelColor;
      ctx.fillText(formatYLabel(v), PAD.l - 5, y);
    }

    // ── X grid + labels ──
    const TIME_STEPS = [1, 2, 5, 10, 15, 30, 60, 120];
    const targetCols = Math.max(3, Math.floor(pw / 80));
    let xStepSec = TIME_STEPS[TIME_STEPS.length - 1];
    for (const s of TIME_STEPS) {
      if (windowSec / s <= targetCols) { xStepSec = s; break; }
    }

    const firstGridMs = Math.ceil(leftEdgeMs / 1000 / xStepSec) * xStepSec * 1000;
    ctx.textAlign     = 'center';
    ctx.textBaseline  = 'top';

    for (let t = firstGridMs; t <= rightEdgeMs + 1; t += xStepSec * 1000) {
      const x = toX(t);
      if (x < PAD.l || x > PAD.l + pw + 1) continue;

      ctx.strokeStyle = gridColor;
      ctx.lineWidth   = 1;
      ctx.beginPath();
      ctx.moveTo(x, PAD.t);
      ctx.lineTo(x, PAD.t + ph);
      ctx.stroke();

      const rel = ((t - rightEdgeMs) / 1000).toFixed(0);
      ctx.fillStyle = labelColor;
      ctx.fillText(`${rel}s`, x, PAD.t + ph + 4);
    }

    // ── Plot border ──
    ctx.strokeStyle = axisColor;
    ctx.lineWidth   = 1;
    ctx.strokeRect(PAD.l, PAD.t, pw, ph);

    // ── Series lines (clipped) ──
    ctx.save();
    ctx.beginPath();
    ctx.rect(PAD.l, PAD.t, pw, ph);
    ctx.clip();

    for (const sd of seriesData) {
      if (sd.pts.length < 2) continue;
      ctx.strokeStyle = sd.color;
      ctx.lineWidth   = 1.8;
      ctx.lineJoin    = 'round';
      ctx.beginPath();
      let first = true;
      for (const { t, v } of sd.pts) {
        const x = toX(t), y = toY(v);
        if (first) { ctx.moveTo(x, y); first = false; }
        else        ctx.lineTo(x, y);
      }
      ctx.stroke();

      // Dot at latest visible point
      const last = sd.pts[sd.pts.length - 1];
      if (last) {
        ctx.fillStyle = sd.color;
        ctx.beginPath();
        ctx.arc(toX(last.t), toY(last.v), 3, 0, Math.PI * 2);
        ctx.fill();
      }
    }

    ctx.restore();

    // ── Scrub cursor (live rewind) ──
    if (!isLogMode && scrubTime != null) {
      const cx = toX(scrubTime);
      if (cx >= PAD.l && cx <= PAD.l + pw) {
        ctx.save();
        ctx.strokeStyle = '#e6b422';
        ctx.lineWidth   = 1.5;
        ctx.setLineDash([5, 3]);
        ctx.beginPath();
        ctx.moveTo(cx, PAD.t);
        ctx.lineTo(cx, PAD.t + ph);
        ctx.stroke();
        ctx.setLineDash([]);
        ctx.restore();
      }
    }

    // ── Log playhead cursor ──
    if (isLogMode) {
      const cx = toX(logAbsMs);
      if (cx >= PAD.l && cx <= PAD.l + pw) {
        ctx.save();
        ctx.strokeStyle = '#fbbf24';
        ctx.lineWidth   = 1.5;
        ctx.setLineDash([5, 3]);
        ctx.beginPath();
        ctx.moveTo(cx, PAD.t);
        ctx.lineTo(cx, PAD.t + ph);
        ctx.stroke();
        ctx.setLineDash([]);
        ctx.restore();
      }
    }

    // ── "Now" marker when live ──
    if (!isLogMode && scrubTime == null) {
      const nx = PAD.l + pw;
      ctx.strokeStyle = 'rgba(255,255,255,0.25)';
      ctx.lineWidth   = 1;
      ctx.setLineDash([2, 3]);
      ctx.beginPath();
      ctx.moveTo(nx, PAD.t);
      ctx.lineTo(nx, PAD.t + ph);
      ctx.stroke();
      ctx.setLineDash([]);
    }

    // ── "No data" message ──
    if (topics.length === 0) {
      ctx.fillStyle    = labelColor;
      ctx.font         = '13px system-ui, sans-serif';
      ctx.textAlign    = 'center';
      ctx.textBaseline = 'middle';
      ctx.fillText('Drag a value card here to plot it', PAD.l + pw / 2, PAD.t + ph / 2);
    }
  }, [size, topics, windowSec, scrubTime, bufferRef, isLogMode, logReplay]);

  // Keep redrawRef current
  redrawRef.current = draw;

  // Redraw at 10 Hz
  useEffect(() => {
    const id = setInterval(() => redrawRef.current?.(), 100);
    return () => clearInterval(id);
  }, []);

  // Also redraw immediately on relevant changes
  useEffect(() => { draw(); }, [draw]);

  // ── Topic management ────────────────────────────────────────────────────────

  const addTopic = ({ path, label }) => {
    setTopics(prev => {
      if (prev.some(t => t.path === path)) return prev;
      const color = COLORS[prev.length % COLORS.length];
      const next  = [...prev, { path, label, color }];
      saveTopics(graphId, next);
      return next;
    });
  };

  const removeTopic = (path) => {
    setTopics(prev => {
      const next = prev.filter(t => t.path !== path);
      saveTopics(graphId, next);
      return next;
    });
  };

  const clearAll = () => {
    setTopics([]);
    saveTopics(graphId, []);
  };

// ── Drag-and-drop ─────────────────────────────────────────────────────────
  // Use a counter so entering/leaving child elements (canvas, overlay) doesn't
  // falsely clear the isDragOver flag.

  const handleDragEnter = (e) => {
    e.preventDefault();
    dragCounterRef.current++;
    setIsDragOver(true);
  };

  const handleDragOver = (e) => {
    e.preventDefault();
    e.dataTransfer.dropEffect = 'copy';
  };

  const handleDragLeave = (e) => {
    e.preventDefault();
    dragCounterRef.current--;
    if (dragCounterRef.current <= 0) {
      dragCounterRef.current = 0;
      setIsDragOver(false);
    }
  };

  const handleDrop = (e) => {
    e.preventDefault();
    dragCounterRef.current = 0;
    setIsDragOver(false);
    try {
      const raw = e.dataTransfer.getData('application/x-nt-topic');
      if (raw) {
        addTopic(JSON.parse(raw));
        return;
      }
      const text = e.dataTransfer.getData('text/plain').trim();
      if (text) addTopic({ path: text, label: text.split('/').pop() });
    } catch { /* ignore malformed drag data */ }
  };

  // ── Manual add ──────────────────────────────────────────────────────────────

  const commitManualInput = () => {
    const p = manualInput.trim();
    if (!p) return;
    addTopic({ path: p, label: p.split('/').pop() });
    setManualInput('');
    setShowAddInput(false);
  };

  // ── Render ──────────────────────────────────────────────────────────────────

  return (
    <div className="graph-panel">
      {/* Canvas area */}
      <div
        ref={containerRef}
        className={`graph-canvas-wrap ${isDragOver ? 'graph-drag-over' : ''}`}
      >
        <canvas
          ref={canvasRef}
          width={size.w || 1}
          height={size.h || 1}
          style={{ width: '100%', height: '100%', display: 'block' }}
        />
        {/* Transparent full-cover overlay — sits above canvas and owns all drag events.
            This is necessary because the canvas element itself may consume pointer
            events before they bubble, and it renders on top of everything. */}
        <div
          className="graph-dnd-overlay"
          onDragEnter={handleDragEnter}
          onDragOver={handleDragOver}
          onDragLeave={handleDragLeave}
          onDrop={handleDrop}
        >
          {isDragOver && (
            <div className="graph-drop-hint">
              <span>Drop to plot</span>
            </div>
          )}
        </div>
      </div>

      {/* Controls strip */}
      <div className="graph-controls">
        {/* Window selector */}
        <div className="graph-window-btns">
          {[10, 30, 60, 120].map(s => (
            <button
              key={s}
              className={`btn btn-sm ${windowSec === s ? 'btn-primary' : 'btn-ghost'}`}
              onClick={() => setWindowSec(s)}
            >
              {s}s
            </button>
          ))}
        </div>

        {/* Legend */}
        <div className="graph-legend">
          {topics.map(t => (
            <span key={t.path} className="graph-legend-item">
              <span className="graph-legend-swatch" style={{ background: t.color }} />
              <span className="graph-legend-label" title={t.path}>{t.label}</span>
              <button className="graph-legend-remove" onClick={() => removeTopic(t.path)}>✕</button>
            </span>
          ))}
        </div>

        {/* Add / clear */}
        <div className="graph-actions">
          {showAddInput ? (
            <input
              autoFocus
              className="graph-add-input"
              placeholder="/Robot/Drive/PoseX"
              value={manualInput}
              onChange={e => setManualInput(e.target.value)}
              onKeyDown={e => {
                if (e.key === 'Enter')  { e.preventDefault(); commitManualInput(); }
                if (e.key === 'Escape') { setShowAddInput(false); setManualInput(''); }
              }}
              onBlur={commitManualInput}
            />
          ) : (
            <button className="btn btn-sm btn-ghost" onClick={() => setShowAddInput(true)} title="Add topic manually">
              + Path
            </button>
          )}
          {topics.length > 0 && (
            <button className="btn btn-sm btn-ghost" onClick={clearAll} title="Remove all series">
              Clear
            </button>
          )}
        </div>
      </div>
    </div>
  );
}
