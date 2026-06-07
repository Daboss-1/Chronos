/**
 * RewindContext
 *
 * Provides:
 *   bufferRef  – stable Map ref from useNTRingBuffer
 *   startTime  – Date.now() when the provider mounted
 *   scrubTime  – null (live) | absolute ms timestamp the user scrubbed to
 *   isPlaying  – true when playing from a scrubbed position
 *   setScrubTime, setIsPlaying
 *   getValueAt(path, timeMs?) – nearest recorded value for a topic
 */

import { createContext, useCallback, useContext, useRef, useState, useEffect } from 'react';
import { useNt4 } from '@frc-web-components/react/networktables';
import useNTRingBuffer from '../hooks/useNTRingBuffer';

const RewindContext = createContext(null);
const PLAYBACK_SPEED_MS = 50; // match the sample rate

export function RewindProvider({ children }) {
  const { nt4Provider } = useNt4();
  const bufferRef    = useNTRingBuffer(nt4Provider);
  const startTimeRef = useRef(Date.now());
  const [scrubTime, setScrubTime] = useState(null); // null = live
  const [isPlaying, setIsPlaying] = useState(false);
  const rafRef = useRef(null);
  const lastTimeRef = useRef(null);

  const getValueAt = useCallback((path, timeMs) => {
    const series = bufferRef.current.get(path);
    if (!series || series.timestamps.length === 0) return null;
    const ts = series.timestamps;
    const vs = series.values;

    if (timeMs == null) return vs[vs.length - 1];
    if (timeMs <= ts[0]) return vs[0];
    if (timeMs >= ts[ts.length - 1]) return vs[vs.length - 1];

    // Binary search for closest sample
    let lo = 0, hi = ts.length - 1;
    while (lo < hi - 1) {
      const mid = (lo + hi) >> 1;
      if (ts[mid] <= timeMs) lo = mid; else hi = mid;
    }
    return Math.abs(ts[lo] - timeMs) <= Math.abs(ts[hi] - timeMs) ? vs[lo] : vs[hi];
  }, [bufferRef]);

  // Playback loop when scrubbed and playing
  useEffect(() => {
    if (!isPlaying || scrubTime == null) {
      cancelAnimationFrame(rafRef.current);
      lastTimeRef.current = null;
      return;
    }

    const loop = (timestamp) => {
      if (lastTimeRef.current !== null) {
        const elapsedMs = timestamp - lastTimeRef.current;
        setScrubTime(prev => {
          if (prev == null) return null; // already live
          const next = prev + elapsedMs;
          if (next >= Date.now()) {
            // Caught up to the present — snap to live
            setIsPlaying(false);
            return null;
          }
          return next;
        });
      }
      lastTimeRef.current = timestamp;
      rafRef.current = requestAnimationFrame(loop);
    };

    lastTimeRef.current = null;
    rafRef.current = requestAnimationFrame(loop);
    return () => cancelAnimationFrame(rafRef.current);
  }, [isPlaying]); // scrubTime intentionally excluded — functional updates don't need it

  return (
    <RewindContext.Provider value={{
      bufferRef,
      startTime: startTimeRef.current,
      scrubTime,
      setScrubTime,
      isPlaying,
      setIsPlaying,
      getValueAt,
    }}>
      {children}
    </RewindContext.Provider>
  );
}

export function useRewind() {
  const ctx = useContext(RewindContext);
  if (!ctx) throw new Error('useRewind must be used inside RewindProvider');
  return ctx;
}
