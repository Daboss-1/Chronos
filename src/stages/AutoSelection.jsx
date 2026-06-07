import { useCallback, useEffect, useRef, useState } from 'react';
import { useEntry } from '@frc-web-components/react';
import { useNt4 } from '@frc-web-components/react/networktables';
import FieldMap from '../components/FieldMap';
import { loadAutoPathsFromAutoPath, computeBezierPoints, estimatePathDurationMs } from '../utils/pathLoader';

const AUTO_COMMAND_PREFIX = '/ChronosDashboard/autonomousCommands/Match/';
const AUTO_TOPIC_ANY_REGEX = /^\/ChronosDashboard\/autonomousCommands\/Match\/([^/]+)\/(.+)$/

function getTopicKeys(data) {
  if (!data) return [];
  if (data instanceof Map) return Array.from(data.keys());
  if (typeof data === 'object') return Object.keys(data);
  return [];
}

function getTopicValue(data, topic) {
  if (!data) return undefined;
  if (data instanceof Map) return data.get(topic);
  return data[topic];
}

function buildAutoRoutines(topics, values) {
  const routineData = new Map();
  const keys = new Set([...getTopicKeys(topics), ...getTopicKeys(values || {})]);

  keys.forEach((topic) => {
    const match = AUTO_TOPIC_ANY_REGEX.exec(topic);
    if (!match) return;

    const [, name, subKey] = match;
    if (!routineData.has(name)) {
      routineData.set(name, { autoPath: '', className: '', description: '' });
    }

    const raw = getTopicValue(values, topic);
    const strValue = raw == null ? '' : String(raw).trim();
    const data = routineData.get(name);

    if (subKey === 'PathPlannerPath') data.autoPath = strValue;
    else if (subKey === 'ClassName') data.className = strValue;
    else if (subKey === 'Description') data.description = strValue;
  });

  const routines = [];
  for (const [name, data] of routineData) {
    const isPreviewable =
      data.className === 'PathPlannerAuto' ||
      (data.className === '' && data.autoPath !== '');

    routines.push({
      id: name,
      name,
      autoPath: data.autoPath,
      className: data.className,
      description: data.description || 'No Description Provided',
      isPreviewable,
    });
  }

  return routines.sort((a, b) => a.name.localeCompare(b.name));
}

export default function AutoSelection({
  selectedAuto,
  setSelectedAuto,
  goToStage,
  autoRoutines = [],
  setAutoRoutines,
}) {
  const [preSelected, setPreSelected] = useEntry('/Shuffleboard/Robot/Auto Selector/selected', 'Default');
  const [, setSelectedAutonomous] = useEntry('/ChronosDashboard/selectedAutonomous/Match', '');
  const [pathSegments, setPathSegments] = useState([]);
  const [robotPose, setRobotPose] = useState(null);
  const animFrameRef = useRef(null);
  const animStartRef = useRef(null);
  const { nt4Provider } = useNt4();

  const syncAutoRoutines = useCallback(() => {
    if (!nt4Provider) return;
    setAutoRoutines(buildAutoRoutines(nt4Provider.topics, nt4Provider.topicValues || {}));
  }, [nt4Provider, setAutoRoutines]);

  useEffect(() => {
    if (!nt4Provider) return;

    let subscriptionId;
    const client = nt4Provider.client;

    if (client?.subscribeAll) {
      subscriptionId = client.subscribeAll([AUTO_COMMAND_PREFIX], true);
    }

    syncAutoRoutines();

    const interval = setInterval(syncAutoRoutines, 250);

    return () => {
      clearInterval(interval);
      if (typeof subscriptionId === 'number' && client?.unsubscribe) {
        client.unsubscribe(subscriptionId);
      }
    };
  }, [nt4Provider, syncAutoRoutines]);

  const sendSelectedAutoToRobot = (auto) => {
    if (!auto) return;

    try {
      setPreSelected(auto.name);
      setSelectedAutonomous(auto.name);
    } catch (error) {
      console.error('Failed to send selected auto routine to robot:', error);
    }
  };

  const handleSelectAuto = (auto) => {
    setSelectedAuto(auto);
  };

  useEffect(() => {
    if (autoRoutines.length === 0) {
      setSelectedAuto(null);
      return;
    }

    const matchedPreselected = autoRoutines.find((auto) => auto.name === preSelected);
    if (matchedPreselected) {
      setSelectedAuto((current) => (current?.id === matchedPreselected.id ? current : matchedPreselected));
      return;
    }

    setSelectedAuto((current) => {
      if (current && autoRoutines.some((auto) => auto.id === current.id)) {
        return current;
      }

      return autoRoutines[0];
    });
  }, [autoRoutines, preSelected, setSelectedAuto]);

  // Load path data when selected auto changes
  useEffect(() => {
    if (!selectedAuto?.isPreviewable) {
      setPathSegments([]);
      return;
    }

    const pathTarget = selectedAuto?.autoPath || selectedAuto?.name;
    if (!pathTarget) {
      setPathSegments([]);
      return;
    }

    let cancelled = false;
    loadAutoPathsFromAutoPath(pathTarget)
      .then((paths) => paths.map((p) => {
        const points = computeBezierPoints(p);
        const durationMs = estimatePathDurationMs(p, points);
        return { points, durationMs };
      }))
      .then((segments) => {
        if (!cancelled) setPathSegments(segments);
      })
      .catch(() => {
        if (!cancelled) setPathSegments([]);
      });

    return () => { cancelled = true; };
  }, [selectedAuto?.name, selectedAuto?.autoPath, selectedAuto?.isPreviewable]);

  // Animate robot along the path
  useEffect(() => {
    if (animFrameRef.current) {
      cancelAnimationFrame(animFrameRef.current);
      animFrameRef.current = null;
    }

    if (pathSegments.length === 0 || pathSegments.every((s) => s.points.length < 2)) {
      setRobotPose(null);
      return;
    }

    const totalDurationMs = pathSegments.reduce((sum, s) => sum + s.durationMs, 0);
    const PAUSE_MS = 1000;
    const cycleMs = totalDurationMs + PAUSE_MS;

    // Pre-build timeline: [{start, end, points}, ...]
    const timeline = [];
    let t = 0;
    for (const seg of pathSegments) {
      timeline.push({ start: t, end: t + seg.durationMs, points: seg.points });
      t += seg.durationMs;
    }

    animStartRef.current = null;

    const animate = (timestamp) => {
      if (!animStartRef.current) animStartRef.current = timestamp;
      const elapsed = timestamp - animStartRef.current;
      const cycleTime = elapsed % cycleMs;

      let entry;
      if (cycleTime >= totalDurationMs) {
        // Pause phase — hold at the final point
        entry = timeline[timeline.length - 1];
        const last = entry.points[entry.points.length - 1];
        setRobotPose({ x: last.x, y: last.y, heading: last.rotation ?? 0 });
        animFrameRef.current = requestAnimationFrame(animate);
        return;
      }

      // Find the segment that contains cycleTime
      entry = timeline[timeline.length - 1];
      for (const e of timeline) {
        if (cycleTime <= e.end) { entry = e; break; }
      }

      const segDuration = entry.end - entry.start;
      const segProgress = segDuration > 0 ? (cycleTime - entry.start) / segDuration : 1;
      const pts = entry.points;
      const rawIdx = segProgress * (pts.length - 1);
      const idx = Math.min(Math.floor(rawIdx), pts.length - 2);
      const frac = rawIdx - idx;

      const p0 = pts[idx];
      const p1 = pts[idx + 1];

      const x = p0.x + (p1.x - p0.x) * frac;
      const y = p0.y + (p1.y - p0.y) * frac;

      // Use rotation targets; fall back to travel-direction tangent if unavailable
      let heading;
      if (p0.rotation !== null && p1.rotation !== null) {
        const diff = ((p1.rotation - p0.rotation + 540) % 360) - 180;
        heading = p0.rotation + diff * frac;
      } else {
        heading = Math.atan2(p1.y - p0.y, p1.x - p0.x) * (180 / Math.PI);
      }

      setRobotPose({ x, y, heading });
      animFrameRef.current = requestAnimationFrame(animate);
    };

    animFrameRef.current = requestAnimationFrame(animate);

    return () => {
      if (animFrameRef.current) {
        cancelAnimationFrame(animFrameRef.current);
        animFrameRef.current = null;
      }
      setRobotPose(null);
    };
  }, [pathSegments]);

  return (
    <div className="stage-container">
      <h2 className="stage-title">Select Autonomous Routine</h2>

      <div className="auto-selection-layout">
        <div className="auto-grid-column">
          {autoRoutines.length === 0 ? (
            <div className="selected-auto-display">No PathPlanner autos available - waiting for robot connection</div>
          ) : (
            <div className="auto-grid">
              {autoRoutines.map((auto) => (
                <div
                  key={auto.id}
                  className={`auto-card ${selectedAuto?.id === auto.id ? 'selected' : ''}`}
                  onClick={() => {
                    handleSelectAuto(auto);
                    sendSelectedAutoToRobot(auto);
                  }}
                >
                  <div className="auto-name">{auto.name}</div>
                  <div className="auto-description">{auto.description}</div>
                </div>
              ))}
            </div>
          )}
        </div>

        <div className="auto-preview-column">
          <div className="auto-preview-wrapper">
            <div className="auto-preview-map-shell">
              <FieldMap
                paths={pathSegments.map((s) => s.points)}
                robotPose={robotPose}
                showRobot={!!robotPose}
                className="auto-preview-map"
              />
              {selectedAuto && !selectedAuto.isPreviewable && (
                <div className="auto-no-preview-overlay">
                  No map preview available for this auto
                </div>
              )}
            </div>
            <div className="selected-auto-display">
              <span>Selected: </span>
              <strong>{selectedAuto?.name || 'None'}</strong>
            </div>
            <button
              className="btn btn-primary btn-large auto-next-btn"
              disabled={!selectedAuto}
              onClick={() => {
                goToStage('confirmation');
                sendSelectedAutoToRobot(selectedAuto);
              }}
            >
              Next: Confirm Information &rarr;
            </button>
          </div>
        </div>
      </div>
    </div>
  );
}
