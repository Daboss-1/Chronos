/**
 * useEntryOrHistorical
 *
 * Wrapper around useEntry that returns historical values when rewinding.
 * When scrubTime is set (rewinding), queries the rewind buffer for the
 * value at that timestamp. Otherwise returns the live value.
 *
 * Usage: const [value] = useEntryOrHistorical('/Robot/Drive/PoseX', 0);
 */

import { useEntry } from '@frc-web-components/react/networktables';
import { useRewind } from '../contexts/RewindContext';
import { useMemo } from 'react';

export function useEntryOrHistorical(topic, defaultValue) {
  const [liveValue] = useEntry(topic, defaultValue);
  const { scrubTime, getValueAt } = useRewind();

  // Separate memo for historical lookup to keep it stable during rewind
  const isRewinding = scrubTime != null;
  
  const historical = useMemo(() => {
    if (!isRewinding) return null;
    const val = getValueAt(topic, scrubTime);
    return val !== null ? val : defaultValue;
  }, [isRewinding, topic, scrubTime, getValueAt, defaultValue]);

  // Return historical when rewinding, live otherwise
  const value = isRewinding ? historical : liveValue;

  return [value];
}
