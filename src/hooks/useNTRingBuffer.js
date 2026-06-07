/**
 * useNTRingBuffer
 *
 * Samples every numeric / boolean NT topic at 20 Hz and keeps the last
 * MAX_AGE_MS milliseconds of data per topic in a stable Map ref.
 *
 * Structure:
 *   bufferRef.current : Map<ntPath, { timestamps: number[], values: number[] }>
 *
 * The ref itself is stable across renders.  The hook triggers a context
 * re-render every 0.5 s so consumers (RewindBar, GraphPanel) repaint.
 */

import { useEffect, useReducer, useRef } from 'react';

const MAX_AGE_MS    = 180_000;  // 3 minutes of history
const SAMPLE_MS     = 50;        // 20 Hz
const RENDER_EVERY  = 10;        // bump state every 10 samples (0.5 s)

export default function useNTRingBuffer(nt4Provider) {
  const bufferRef  = useRef(new Map());
  const sampleCount = useRef(0);
  const [, bump]   = useReducer(n => n + 1, 0);

  useEffect(() => {
    if (!nt4Provider) return;

    const id = setInterval(() => {
      const values = nt4Provider.topicValues || {};
      const now    = Date.now();
      const cutoff = now - MAX_AGE_MS;

      const entries = values instanceof Map
        ? values.entries()
        : Object.entries(values);

      for (const [key, raw] of entries) {
        if (raw == null) continue;
        let v;
        if (typeof raw === 'number')       v = raw;
        else if (typeof raw === 'boolean') v = raw ? 1 : 0;
        else continue;
        if (!Number.isFinite(v)) continue;

        let series = bufferRef.current.get(key);
        if (!series) {
          series = { timestamps: [], values: [] };
          bufferRef.current.set(key, series);
        }

        series.timestamps.push(now);
        series.values.push(v);

        // Prune entries older than cutoff
        while (series.timestamps.length > 0 && series.timestamps[0] < cutoff) {
          series.timestamps.shift();
          series.values.shift();
        }
      }

      sampleCount.current++;
      if (sampleCount.current % RENDER_EVERY === 0) bump();
    }, SAMPLE_MS);

    return () => clearInterval(id);
  }, [nt4Provider]);

  return bufferRef;
}
