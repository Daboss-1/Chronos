import { useState, useEffect, useRef } from 'react';
import { useEntry } from '@frc-web-components/react/networktables';

export default function Autonomous({ selectedAuto, goToStage, onEnter, onTimeUpdate }) {
  const [timeRemaining, setTimeRemaining] = useState(20);
  const hasTransitioned = useRef(false);

  // Start recording as soon as this stage mounts
  useEffect(() => { onEnter?.(); }, []); // eslint-disable-line react-hooks/exhaustive-deps

  const [fmsInfo] = useEntry('/FMSInfo', { IsRedAlliance: false, FMSControlData: 0 });
  const fmsControlData = fmsInfo?.FMSControlData || 0;
  const isEnabled = (fmsControlData & 0x01) !== 0;
  const isAuto = (fmsControlData & 0x02) !== 0;

  // FMS-driven transition: when FMS leaves autonomous (teleop starts), transition
  useEffect(() => {
    if (isEnabled && !isAuto && !hasTransitioned.current) {
      hasTransitioned.current = true;
      goToStage('teleop');
    }
  }, [isEnabled, isAuto, goToStage]);

  // Local timer fallback (for testing without FMS) + propagate time to header/placeholder
  useEffect(() => {
    const fmt = (s) => `0:${s.toString().padStart(2, '0')}`;
    onTimeUpdate?.(fmt(timeRemaining));

    const timer = setInterval(() => {
      setTimeRemaining(prev => {
        if (prev <= 1) {
          clearInterval(timer);
          onTimeUpdate?.('0:00');
          if (!hasTransitioned.current) {
            hasTransitioned.current = true;
            setTimeout(() => goToStage('teleop'), 1000);
          }
          return 0;
        }
        const next = prev - 1;
        onTimeUpdate?.(fmt(next));
        return next;
      });
    }, 1000);

    return () => clearInterval(timer);
  }, [goToStage]);

  return null;
}

