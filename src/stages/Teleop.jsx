import { useState, useEffect, useRef } from 'react';
import { useEntry } from '@frc-web-components/react/networktables';
import { useSoundCues } from '../hooks/useSoundCues';

export default function Teleop({ goToStage, setMatchStats, stopRecording, onTimeUpdate }) {
  const [timeRemaining, setTimeRemaining] = useState(140);
  const hasTransitioned = useRef(false);

  // Sound cues at 30s, 10s, 0s
  useSoundCues(timeRemaining);

  const [ballsScored] = useEntry('/Dashboard/Scoring', 0);
  const [fmsInfo] = useEntry('/FMSInfo', { IsRedAlliance: false, GameSpecificMessage: '', FMSControlData: 0 });
  const fmsControlData = fmsInfo?.FMSControlData || 0;
  const isEnabled = (fmsControlData & 0x01) !== 0;

  const scored = typeof ballsScored === 'number' ? ballsScored : 0;

  // FMS-driven transition: when FMS disables the robot (match over), go to postGame
  const wasEnabled = useRef(false);
  useEffect(() => {
    if (isEnabled) {
      wasEnabled.current = true;
    }
    if (wasEnabled.current && !isEnabled && !hasTransitioned.current) {
      hasTransitioned.current = true;
      stopRecording?.();
      setMatchStats({
        totalPoints: scored,
        autoPoints: 0,
        teleopPoints: scored,
        endGamePoints: 0
      });
      goToStage('postGame');
    }
  }, [isEnabled, goToStage, scored, setMatchStats]);

  // Local timer fallback (for testing without FMS) + propagate time to header/placeholder
  useEffect(() => {
    const fmt = (s) => `${Math.floor(s / 60)}:${(s % 60).toString().padStart(2, '0')}`;
    onTimeUpdate?.(fmt(timeRemaining));

    const timer = setInterval(() => {
      setTimeRemaining(prev => {
        if (prev <= 1) {
          clearInterval(timer);
          onTimeUpdate?.('0:00');
          if (!hasTransitioned.current) {
            hasTransitioned.current = true;
            stopRecording?.();
            setMatchStats({
              totalPoints: scored,
              autoPoints: 0,
              teleopPoints: scored,
              endGamePoints: 0
            });
            setTimeout(() => goToStage('postGame'), 1000);
          }
          return 0;
        }
        const next = prev - 1;
        onTimeUpdate?.(fmt(next));
        return next;
      });
    }, 1000);

    return () => clearInterval(timer);
  }, [goToStage, scored, setMatchStats]);

  return null;
}
