/**
 * useAdvantageScope
 *
 * Publishes structured data into NT so AdvantageScope can subscribe directly.
 *
 * Topics written (all under /AdvantageKit/ to match AdvantageScope's default):
 *
 *   /AdvantageKit/RealOutputs/Drive/Pose
 *       → double[3] [x_m, y_m, heading_rad]  (Field2d-compatible pose)
 *
 *   /AdvantageKit/RealOutputs/Drive/PoseHistory
 *       → double[] flattened [x0, y0, h0, x1, y1, h1, ...]  (pose trace)
 *
 *   /AdvantageKit/RealOutputs/Timestamp
 *       → double  match elapsed time in seconds
 *
 *   /AdvantageKit/RealOutputs/AutoRoutine
 *       → string  selected auto name
 *
 * Additionally publishes an "AdvantageScope-ready" flag:
 *   /NFRDashboard/advantagescope/ready → boolean true while connected
 *
 * The hook reads from existing NT topics (pose, FMS, auto) and republishes
 * them in the format AdvantageScope expects.
 *
 * Call useAdvantageScope() inside App (or any component with NT context).
 * It starts automatically and runs continuously.
 */

import { useEffect, useRef } from 'react';
import { useNt4 } from '@frc-web-components/react/networktables';

const PUBLISH_INTERVAL_MS = 50;   // 20 Hz
const MAX_HISTORY         = 500;  // number of pose frames to keep in trace

// NT source topics
const POSE_X_TOPIC   = '/Robot/Drive/PoseX';
const POSE_Y_TOPIC   = '/Robot/Drive/PoseY';
const POSE_HDG_TOPIC = '/Robot/Drive/PoseHeading';
const AUTO_TOPIC     = '/NFRDashboard/selectedAutonomous/Match';

// NT output topics (AdvantageScope convention)
const AK_POSE         = '/AdvantageKit/RealOutputs/Drive/Pose';
const AK_POSE_HISTORY = '/AdvantageKit/RealOutputs/Drive/PoseHistory';
const AK_TIMESTAMP    = '/AdvantageKit/RealOutputs/Timestamp';
const AK_AUTO         = '/AdvantageKit/RealOutputs/AutoRoutine';
const AK_READY        = '/NFRDashboard/advantagescope/ready';

export default function useAdvantageScope() {
  const { nt4Provider } = useNt4();
  const poseHistoryRef  = useRef([]);   // [[x, y, h], ...]
  const startTimeRef    = useRef(null);
  const timerRef        = useRef(null);

  useEffect(() => {
    if (!nt4Provider?.setValue) return;
    if (!startTimeRef.current) startTimeRef.current = Date.now();

    const publish = () => {
      if (!nt4Provider?.setValue) return;

      const values = nt4Provider.topicValues || {};
      const get = (k) => values instanceof Map ? values.get(k) : values[k];

      const x   = Number(get(POSE_X_TOPIC)   ?? 0);
      const y   = Number(get(POSE_Y_TOPIC)   ?? 0);
      // AdvantageScope expects heading in radians; NT publishes degrees
      const hdgDeg = Number(get(POSE_HDG_TOPIC) ?? 0);
      const hdgRad = (hdgDeg * Math.PI) / 180;

      const elapsedSec = (Date.now() - startTimeRef.current) / 1000;

      const autoName = String(get(AUTO_TOPIC) ?? '');

      // Update pose history
      const history = poseHistoryRef.current;
      history.push([x, y, hdgRad]);
      if (history.length > MAX_HISTORY) history.shift();

      // Flatten history: [x0, y0, h0, x1, y1, h1, ...]
      const flat = history.flat();

      try {
        nt4Provider.setValue(AK_POSE,         [x, y, hdgRad]);
        nt4Provider.setValue(AK_POSE_HISTORY, flat);
        nt4Provider.setValue(AK_TIMESTAMP,    elapsedSec);
        nt4Provider.setValue(AK_AUTO,         autoName);
        nt4Provider.setValue(AK_READY,        true);
      } catch {
        // NT not yet connected — ignore
      }
    };

    timerRef.current = setInterval(publish, PUBLISH_INTERVAL_MS);
    return () => {
      clearInterval(timerRef.current);
      // Mark as not ready on cleanup
      try { nt4Provider.setValue(AK_READY, false); } catch { /* ignore */ }
    };
  }, [nt4Provider]);
}
