import { useState, useEffect, useRef } from 'react';
import { useEntry } from '@frc-web-components/react/networktables';
import { useEntryOrHistorical } from '../hooks/useEntryOrHistorical';
import FieldMap from '../components/FieldMap';
import { computeMatchPhase } from '../utils/matchPhase';
import NTTabView from './NTTabView';
import CameraSwitcher from '../components/CameraSwitcher';
import WidgetGrid from '../components/WidgetGrid';
import GraphPanel from '../components/GraphPanel';
import { useSoundCues } from '../hooks/useSoundCues';
import { useI18n } from '../contexts/I18nContext';

export default function Teleop({ goToStage, setMatchStats, stopRecording }) {
  const [timeRemaining, setTimeRemaining] = useState(140);
  const hasTransitioned = useRef(false);
  const { t } = useI18n();

  // Sound cues at 30s, 10s, 0s
  useSoundCues(timeRemaining);

  // Scoring - balls scored (1 point each)
  const [ballsScored] = useEntry('/Dashboard/Scoring', 0);

  const [poseX] = useEntryOrHistorical('/Robot/Drive/PoseX', 0);
  const [poseY] = useEntryOrHistorical('/Robot/Drive/PoseY', 0);
  const [poseHeading] = useEntryOrHistorical('/Robot/Drive/PoseHeading', 0);
  const [fmsInfo] = useEntry('/FMSInfo', { IsRedAlliance: false, GameSpecificMessage: '', FMSControlData: 0 });

  // Key subsystem status
  const [shooterSpeed] = useEntryOrHistorical('/Robot/Turret/Shooter/Speed', 0);
  const [shooterTarget] = useEntryOrHistorical('/Robot/Turret/Shooter/TargetSpeed', 0);
  const [suzieAtTarget] = useEntryOrHistorical('/Robot/Turret/Suzie/IsAtTarget', false);
  const [inShootingRange] = useEntryOrHistorical('/Robot/Turret/InShootingRange', false);

  const scored = typeof ballsScored === 'number' ? ballsScored : 0;

  const robotX = typeof poseX === 'number' ? poseX : 0;
  const robotY = typeof poseY === 'number' ? poseY : 0;
  const robotHeading = typeof poseHeading === 'number' ? poseHeading : 0;
  const isRedAlliance = fmsInfo?.IsRedAlliance || false;
  const gameSpecificMessage = fmsInfo?.GameSpecificMessage || '';
  const fmsControlData = fmsInfo?.FMSControlData || 0;

  const isEnabled = (fmsControlData & 0x01) !== 0;

  // Compute match phase
  const { hubState, phaseName } = computeMatchPhase(gameSpecificMessage, isRedAlliance, timeRemaining);

  const shooterRPM = (shooterSpeed || 0) * 60;
  const shooterTargetRPM = (shooterTarget || 0) * 60;
  const shooterAtSpeed = Math.abs(shooterRPM - shooterTargetRPM) < 50 && shooterTargetRPM > 0;

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

  // Local timer fallback (for testing without FMS) + header time display
  useEffect(() => {
    // Set initial header time when entering teleop
    const matchTimeEl = document.getElementById('matchTime');
    if (matchTimeEl) {
      matchTimeEl.textContent = `${Math.floor(timeRemaining / 60)}:${(timeRemaining % 60).toString().padStart(2, '0')}`;
    }

    const timer = setInterval(() => {
      setTimeRemaining(prev => {
        if (prev <= 1) {
          clearInterval(timer);
          if (matchTimeEl) matchTimeEl.textContent = '0:00';
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
        if (matchTimeEl) {
          matchTimeEl.textContent = `${Math.floor(next / 60)}:${(next % 60).toString().padStart(2, '0')}`;
        }
        return next;
      });
    }, 1000);

    return () => clearInterval(timer);
  }, [goToStage, scored, setMatchStats]);

  const widgets = {
    fieldMap: (
      <div className="widget-panel">
        <FieldMap
          robotPose={{ x: robotX, y: robotY, heading: robotHeading }}
          showRobot={true}
          alliance={isRedAlliance ? 'red' : 'blue'}
          paths={[]}
          width="100%"
        />
      </div>
    ),
    cameras: (
      <div className="widget-panel">
        <CameraSwitcher filterTab="Match" />
      </div>
    ),
    phase: (
      <div className="widget-panel info-bar-panel match-phase-panel">
        <h3>{t('teleop.phase')}</h3>
        <div className="phase-name">{phaseName}</div>
        <div className={`hub-status ${hubState}`}>
          {t('teleop.hub')}: {hubState === 'active' ? t('teleop.hubActive') : t('teleop.hubInactive')}
        </div>
      </div>
    ),
    status: (
      <div className="widget-panel info-bar-panel status-panel">
        <h3>{t('teleop.status')}</h3>
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
    scoring: (
      <div className="widget-panel info-bar-panel scoring-panel">
        <h3>{t('teleop.scoring')}</h3>
        <div className="score-inline">
          <span className="score-label">{t('teleop.balls')}</span>
          <span className="score-value">{scored}</span>
        </div>
      </div>
    ),
    ntControls: (
      <div className="widget-panel info-bar-panel" style={{ overflowY: 'auto', height: '100%' }}>
        <h3>{t('teleop.matchControls')}</h3>
        <NTTabView tabName="Match" layout="panel" />
      </div>
    ),
    graph: (
      <div className="widget-panel" style={{ padding: 0, overflow: 'hidden' }}>
        <GraphPanel graphId="teleop-graph" />
      </div>
    ),
  };

  return (
    <div className="stage-container-full widget-stage">
      <WidgetGrid stage="teleop" widgets={widgets} />
    </div>
  );
}
