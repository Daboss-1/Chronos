/**
 * useMatchRecorder
 *
 * Records all /ChronosDashboard/ and /Robot/ NT values at ~20 Hz during a match.
 * Produces a structured log object compatible with encodeWpilog().
 *
 * Usage:
 *   const { startRecording, stopRecording, currentLog, savedLogs } = useMatchRecorder();
 *
 * Integration:
 *   - Call startRecording() when entering autonomous
 *   - Call stopRecording() when entering postGame; returns the completed log
 *   - currentLog is null when not recording
 *   - savedLogs: array of the last MAX_SAVED logs, persisted to localStorage
 */

import { useCallback, useEffect, useRef, useState } from 'react';
import { useNt4 } from '@frc-web-components/react/networktables';

const RECORD_INTERVAL_MS = 50;   // 20 Hz
const MAX_SAVED           = 10;  // keep at most N logs in localStorage
const STORAGE_KEY         = 'nfr-match-logs';
const RECORD_PREFIXES     = ['/ChronosDashboard/', '/Robot/', '/FMSInfo', '/Dashboard/'];

// NT type → wpilog type string
function inferType(value) {
  if (typeof value === 'number')  return 'double';
  if (typeof value === 'boolean') return 'boolean';
  if (typeof value === 'string')  return 'string';
  if (Array.isArray(value) && value.every(v => typeof v === 'number')) return 'double[]';
  return 'string'; // fallback: JSON-encode complex values as strings
}

function coerce(value, type) {
  if (type === 'string' && typeof value !== 'string') return JSON.stringify(value);
  return value;
}

function loadSavedLogs() {
  try {
    const raw = localStorage.getItem(STORAGE_KEY);
    if (raw) return JSON.parse(raw);
  } catch { /* ignore */ }
  return [];
}

function persistLogs(logs) {
  try {
    // Persist only metadata + a trimmed sample to keep storage small
    const slim = logs.map(l => ({
      ...l,
      entries: l.entries.map(e => ({
        ...e,
        // Keep every 4th sample for the stored copy (5 Hz)
        timestamps: e.timestamps.filter((_, i) => i % 4 === 0),
        values:     e.values.filter(    (_, i) => i % 4 === 0),
      })),
    }));
    localStorage.setItem(STORAGE_KEY, JSON.stringify(slim));
  } catch { /* quota exceeded or private browsing */ }
}

export default function useMatchRecorder() {
  const { nt4Provider } = useNt4();
  const [savedLogs, setSavedLogs] = useState(loadSavedLogs);
  const [isRecording, setIsRecording] = useState(false);
  const [currentLog, setCurrentLog] = useState(null);

  // Live recording state held in refs to avoid re-render overhead
  const startTsRef    = useRef(null);   // performance.now() at start
  const wallClockRef  = useRef(null);   // Date.now() at start (for ISO filename)
  const entriesMapRef = useRef(new Map()); // name → { id, type, timestamps[], values[] }
  const idCounterRef  = useRef(1);
  const timerRef      = useRef(null);

  const snapshot = useCallback(() => {
    if (!nt4Provider) return;
    const values = nt4Provider.topicValues || {};
    const now = performance.now() - startTsRef.current; // ms elapsed

    const pairs = values instanceof Map ? [...values.entries()] : Object.entries(values);

    for (const [key, rawValue] of pairs) {
      // Filter to interesting topics
      const relevant = RECORD_PREFIXES.some(p => key.startsWith(p));
      if (!relevant) continue;
      // Skip null / undefined
      if (rawValue == null) continue;

      const type  = inferType(rawValue);
      const value = coerce(rawValue, type);

      if (!entriesMapRef.current.has(key)) {
        entriesMapRef.current.set(key, {
          id:         idCounterRef.current++,
          name:       key,
          type,
          metadata:   '',
          timestamps: [],
          values:     [],
        });
      }
      const entry = entriesMapRef.current.get(key);
      entry.timestamps.push(now);
      entry.values.push(value);
    }
  }, [nt4Provider]);

  const startRecording = useCallback(() => {
    if (isRecording) return;

    startTsRef.current   = performance.now();
    wallClockRef.current = Date.now();
    entriesMapRef.current.clear();
    idCounterRef.current = 1;

    setIsRecording(true);
    setCurrentLog(null);

    timerRef.current = setInterval(snapshot, RECORD_INTERVAL_MS);
  }, [isRecording, snapshot]);

  const stopRecording = useCallback(() => {
    if (!isRecording) return null;

    clearInterval(timerRef.current);
    timerRef.current = null;

    // Final snapshot
    snapshot();

    const durationMs = performance.now() - startTsRef.current;
    const log = {
      startTimestamp: wallClockRef.current,
      durationMs,
      entries: [...entriesMapRef.current.values()],
    };

    setIsRecording(false);
    setCurrentLog(log);

    // Persist
    setSavedLogs(prev => {
      const next = [log, ...prev].slice(0, MAX_SAVED);
      persistLogs(next);
      return next;
    });

    return log;
  }, [isRecording, snapshot]);

  // Clean up on unmount
  useEffect(() => () => clearInterval(timerRef.current), []);

  return { startRecording, stopRecording, isRecording, currentLog, savedLogs };
}
