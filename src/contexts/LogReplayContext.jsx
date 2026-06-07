/**
 * LogReplayContext
 *
 * Drives the full-dashboard log viewer. When a parsed log is loaded:
 *   - Provides a smooth RAF-based playback loop (ref, not state → no 60fps renders).
 *   - Exposes a `displayPlayhead` (state, capped to 20 Hz) so UI components only
 *     re-render at that rate.
 *   - Derives `topicsObj` and `logTabs` from the log's entry list.
 *   - `topicValuesAt(ms)` returns a flat { [topic]: value } snapshot via binary search.
 */

import {
  createContext, useCallback, useContext, useEffect, useMemo, useRef, useState,
} from 'react';

const LogReplayContext = createContext(null);

// ── Regex mirrors from useDiscoveredTabs ──────────────────────────────────────
const TAB_RE = /^\/NFRDashboard\/(?:commands|numbers|strings|booleans|tunableNumbers|tunableStrings|tunableBooleans|cameraStreams|fields|robots)\/([^/]+)\//;
const SYS_TAB_RE = /^\/NFRDashboard\/systems\/[^/]+\/(?:commands|numbers|strings|booleans|tunableNumbers|tunableStrings|tunableBooleans)\/([^/]+)\//;
const BUILTIN_TABS = new Set(['Match']);

/** Step-hold sample: returns the value at the last recorded sample ≤ t */
function sampleAt(entry, t) {
  const { timestamps: ts, values: vs } = entry;
  if (!ts.length) return undefined;
  if (t <= ts[0]) return vs[0];
  if (t >= ts[ts.length - 1]) return vs[vs.length - 1];
  let lo = 0, hi = ts.length - 1;
  while (lo < hi - 1) {
    const mid = (lo + hi) >> 1;
    if (ts[mid] <= t) lo = mid; else hi = mid;
  }
  return vs[lo];
}

// ─────────────────────────────────────────────────────────────────────────────

export function LogReplayProvider({ log, onClose, children }) {
  const duration = log?.durationMs ?? 0;

  // Playhead stored in a ref for the RAF loop (no per-frame re-render)
  const playheadRef  = useRef(0);
  const lastTimeRef  = useRef(null);
  const rafRef       = useRef(null);
  const speedRef     = useRef(1);

  // Coarse state for UI (20 Hz)
  const [displayPlayhead, setDisplayPlayhead] = useState(0);
  const [playing, setPlaying]   = useState(false);
  const [speed, setSpeed]       = useState(1);

  useEffect(() => { speedRef.current = speed; }, [speed]);

  // Reset on new log
  useEffect(() => {
    playheadRef.current = 0;
    setDisplayPlayhead(0);
    setPlaying(false);
  }, [log]);

  // RAF playback — advances the ref, does NOT setState
  useEffect(() => {
    if (!playing) {
      cancelAnimationFrame(rafRef.current);
      lastTimeRef.current = null;
      return;
    }
    const loop = (now) => {
      if (lastTimeRef.current !== null) {
        const dt = (now - lastTimeRef.current) * speedRef.current;
        playheadRef.current = Math.min(playheadRef.current + dt, duration);
        if (playheadRef.current >= duration) {
          setPlaying(false);
          setDisplayPlayhead(duration);
          return;
        }
      }
      lastTimeRef.current = now;
      rafRef.current = requestAnimationFrame(loop);
    };
    lastTimeRef.current = null;
    rafRef.current = requestAnimationFrame(loop);
    return () => cancelAnimationFrame(rafRef.current);
  }, [playing, duration]);

  // 20 Hz tick to push playheadRef → displayPlayhead
  useEffect(() => {
    const id = setInterval(() => setDisplayPlayhead(playheadRef.current), 50);
    return () => clearInterval(id);
  }, []);

  // Scrub: update ref AND state immediately
  const scrubTo = useCallback((ms) => {
    playheadRef.current = ms;
    setDisplayPlayhead(ms);
    setPlaying(false);
  }, []);

  // Build a fast entry map (name → entry)
  const entryMap = useMemo(() => {
    const m = new Map();
    for (const entry of (log?.entries ?? [])) m.set(entry.name, entry);
    return m;
  }, [log]);

  // Flat topics object (mirrors nt4Provider.topics shape for buildTabData)
  const topicsObj = useMemo(() => {
    const obj = {};
    for (const name of entryMap.keys()) obj[name] = true;
    return obj;
  }, [entryMap]);

  // Discover tab names from the log entry paths
  const logTabs = useMemo(() => {
    const set = new Set();
    for (const name of entryMap.keys()) {
      let m = TAB_RE.exec(name);
      if (m && !BUILTIN_TABS.has(m[1])) set.add(m[1]);
      m = SYS_TAB_RE.exec(name);
      if (m && !BUILTIN_TABS.has(m[1])) set.add(m[1]);
    }
    return Array.from(set).sort();
  }, [entryMap]);

  // Return a flat { [topic]: value } snapshot at `relMs` (relative to log start)
  const topicValuesAt = useCallback((relMs) => {
    const out = {};
    for (const [name, entry] of entryMap.entries()) {
      const v = sampleAt(entry, relMs);
      if (v !== undefined) out[name] = v;
    }
    return out;
  }, [entryMap]);

  const value = {
    log,
    duration,
    displayPlayhead,
    playing,
    setPlaying,
    speed,
    setSpeed,
    scrubTo,
    topicsObj,
    topicValuesAt,
    logTabs,
    onClose,
  };

  return <LogReplayContext.Provider value={value}>{children}</LogReplayContext.Provider>;
}

/** Returns null if not inside LogReplayProvider (i.e. in live mode). */
export function useLogReplay() {
  return useContext(LogReplayContext);
}
