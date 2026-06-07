import { useState, useEffect, useRef } from 'react';
import { useEntry } from '@frc-web-components/react/networktables';
import { useEntryOrHistorical } from '../hooks/useEntryOrHistorical';
import FieldMap from '../components/FieldMap';
import { loadAutoPathsFromAutoPath, computeBezierPoints } from '../utils/pathLoader';
import NTTabView from './NTTabView';
import CameraSwitcher from '../components/CameraSwitcher';
import WidgetGrid from '../components/WidgetGrid';
import GraphPanel from '../components/GraphPanel';
import { useI18n } from '../contexts/I18nContext';

export default function Autonomous({ selectedAuto, goToStage, onEnter }) {
  const [timeRemaining, setTimeRemaining] = useState(20);
  const [pathPoints, setPathPoints] = useState([]);
  const hasTransitioned = useRef(false);
  const { t } = useI18n();

  // Start recording as soon as this stage mounts
  useEffect(() => { onEnter?.(); }, []); // eslint-disable-line react-hooks/exhaustive-deps

  const [poseX] = useEntryOrHistorical('/Robot/Drive/PoseX', 0);
  const [poseY] = useEntryOrHistorical('/Robot/Drive/PoseY', 0);
  const [poseHeading] = useEntryOrHistorical('/Robot/Drive/PoseHeading', 0);
  const [autoData] = useEntry('/Dashboard/Auto', { progress: 0, routine: '' });
  const [fmsInfo] = useEntry('/FMSInfo', { IsRedAlliance: false, FMSControlData: 0 });

  // Key subsystem status
  const [shooterSpeed] = useEntryOrHistorical('/Robot/Turret/Shooter/Speed', 0);
  const [shooterTarget] = useEntryOrHistorical('/Robot/Turret/Shooter/TargetSpeed', 0);
  const [suzieAtTarget] = useEntryOrHistorical('/Robot/Turret/Suzie/IsAtTarget', false);
  const [inShootingRange] = useEntryOrHistorical('/Robot/Turret/InShootingRange', false);

  const x = typeof poseX === 'number' ? poseX : 0;
  const y = typeof poseY === 'number' ? poseY : 0;
  const heading = typeof poseHeading === 'number' ? poseHeading : 0;
  const autoProgress = autoData?.progress || 0;
  const autoRoutine = autoData?.routine || selectedAuto?.name || '';
  const isRedAlliance = fmsInfo?.IsRedAlliance || false;
  const fmsControlData = fmsInfo?.FMSControlData || 0;

  const isEnabled = (fmsControlData & 0x01) !== 0;
  const isAuto = (fmsControlData & 0x02) !== 0;

  const shooterRPM = (shooterSpeed || 0) * 60;
  const shooterTargetRPM = (shooterTarget || 0) * 60;
  const shooterAtSpeed = Math.abs(shooterRPM - shooterTargetRPM) < 50 && shooterTargetRPM > 0;

  // Load path data on mount
  useEffect(() => {
    const pathTarget = selectedAuto?.autoPath || selectedAuto?.name;
    if (!pathTarget) return;

    let cancelled = false;
    const loadPoints = loadAutoPathsFromAutoPath(pathTarget)
      .then((paths) => paths.map((p) => computeBezierPoints(p.waypoints)));

    loadPoints.then((points) => {
      if (cancelled) return;
      setPathPoints(points);
    }).catch(() => {
      if (!cancelled) setPathPoints([]);
    });

    return () => { cancelled = true; };
  }, [selectedAuto?.name, selectedAuto?.autoPath]);

  // FMS-driven transition: when FMS leaves autonomous (teleop starts), transition
  useEffect(() => {
    if (isEnabled && !isAuto && !hasTransitioned.current) {
      hasTransitioned.current = true;
      goToStage('teleop');
    }
  }, [isEnabled, isAuto, goToStage]);

  // Local timer fallback (for testing without FMS) + header time display
  useEffect(() => {
    const matchTimeEl = document.getElementById('matchTime');
    if (matchTimeEl) {
      matchTimeEl.textContent = `0:${timeRemaining.toString().padStart(2, '0')}`;
    }

    const timer = setInterval(() => {
      setTimeRemaining(prev => {
        if (prev <= 1) {
          clearInterval(timer);
          if (matchTimeEl) matchTimeEl.textContent = '0:00';
          if (!hasTransitioned.current) {
            hasTransitioned.current = true;
            setTimeout(() => goToStage('teleop'), 1000);
          }
          return 0;
        }
        const next = prev - 1;
        if (matchTimeEl) {
          matchTimeEl.textContent = `0:${next.toString().padStart(2, '0')}`;
        }
        return next;
      });
    }, 1000);

    return () => clearInterval(timer);
  }, [goToStage]);

  const widgets = {
    fieldMap: (
      <div className="widget-panel">
        <FieldMap
          paths={pathPoints}
          robotPose={{ x, y, heading }}
          showRobot={true}
          alliance={isRedAlliance ? 'red' : 'blue'}
          width="100%"
        />
      </div>
    ),
    autoInfo: (
      <div className="widget-panel info-bar-panel status-panel">
        <h3>{t('autonomous.routine')}</h3>
        <div className="routine-name">{autoRoutine || selectedAuto?.name || 'Unknown'}</div>
        <div className="progress-bar">
          <div className="progress-fill" style={{ width: `${autoProgress}%` }} />
        </div>
      </div>
    ),
    cameras: (
      <div className="widget-panel">
        <CameraSwitcher filterTab="Match" />
      </div>
    ),
    status: (
      <div className="widget-panel info-bar-panel status-panel">
        <h3>{t('autonomous.status')}</h3>
        <div className="status-indicators">
          <div className={`status-chip ${shooterAtSpeed ? 'good' : 'bad'}`}>
            {t('status.shooter')}: {shooterAtSpeed ? t('status.atSpeed') : t('status.spinningUp')}
          </div>
          <div className={`status-chip ${suzieAtTarget ? 'good' : 'bad'}`}>
            {t('status.suzie')}: {suzieAtTarget ? t('status.onTarget') : t('status.rotating')}
          </div>
          <div className={`status-chip ${inShootingRange ? 'good' : 'bad'}`}>
            {inShootingRange ? t('status.inRange') : t('status.outOfRange')}
          </div>
        </div>
      </div>
    ),
    ntControls: (
      <div className="widget-panel info-bar-panel" style={{ overflowY: 'auto', height: '100%' }}>
        <h3>{t('autonomous.matchControls')}</h3>
        <NTTabView tabName="Match" layout="panel" />
      </div>
    ),
    graph: (
      <div className="widget-panel" style={{ padding: 0, overflow: 'hidden' }}>
        <GraphPanel graphId="autonomous-graph" />
      </div>
    ),
  };

  return (
    <div className="stage-container-full widget-stage">
      <WidgetGrid stage="autonomous" widgets={widgets} />
    </div>
  );
}

