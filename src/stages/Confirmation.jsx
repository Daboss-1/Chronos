import { useEffect, useRef } from 'react';
import { useEntry } from '@frc-web-components/react/networktables';

export default function Confirmation({ selectedAuto, goToStage }) {
  const [eventName] = useEntry('/FMSInfo/EventName', '[No event name]');
  const [matchType] = useEntry('/FMSInfo/MatchType', '[No match type]');
  const [matchNumber] = useEntry('/FMSInfo/MatchNumber', '[No match number]');
  const [isRedAlliance] = useEntry('/FMSInfo/IsRedAlliance', null);
  const [stationNumber] = useEntry('/FMSInfo/StationNumber', 1);
  const [fmsControlData] = useEntry('/FMSInfo/FMSControlData', 0);
  const [gameMessage] = useEntry('/FMSInfo/GameSpecificMessage', '');
  const [matchTime] = useEntry('/FMSInfo/MatchTime', -1.0);

  const [batteryVoltage] = useEntry('/SystemStats/BatteryVoltage', null);
  const [teamNumber] = useEntry('/SystemStats/TeamNumber', 172);

  const alliance = isRedAlliance === null ? '[No alliance]' : isRedAlliance ? 'Red' : 'Blue';

  // Track previous match time to detect transition from -1 to >= 0
  const prevMatchTime = useRef(matchTime);

  // FMS auto-start detection: match time transitions from -1.0 to a non-negative value
  const isAutoEnabled = (fmsControlData & 0x03) === 0x03;
  const matchStarted = prevMatchTime.current < 0 && matchTime >= 0;

  useEffect(() => {
    if (matchStarted || isAutoEnabled) {
      document.documentElement.requestFullscreen?.call(document.documentElement);
      goToStage('autonomous');
    }
  }, [matchStarted, isAutoEnabled, goToStage]);

  // Keep prevMatchTime updated (after the effect so we can detect the transition)
  useEffect(() => {
    prevMatchTime.current = matchTime;
  }, [matchTime]);

  const hubFirstLabel = gameMessage === 'R' ? 'Red Active First' :
                        gameMessage === 'B' ? 'Blue Active First' : 'Awaiting FMS';

  return (
    <div className="stage-container">
      <h2 className="stage-title">Confirm Match Information</h2>
      <div className="confirmation-grid">
        <div className="info-card">
          <h3>Team Information</h3>
          <div className="info-row">
            <span className="info-label">Team Number:</span>
            <span className="info-value">{teamNumber}</span>
          </div>
          <div className="info-row">
            <span className="info-label">Event Name:</span>
            <span className="info-value">{eventName}</span>
          </div>
        </div>

        <div className="info-card">
          <h3>Match Assignment</h3>
          <div className="info-row">
            <span className="info-label">Match Type:</span>
            <span className="info-value">{matchType}</span>
          </div>
          <div className="info-row">
            <span className="info-label">Match Number:</span>
            <span className="info-value">{matchNumber}</span>
          </div>
        </div>

        <div className="info-card alliance-card">
          <h3>Alliance & Position</h3>
          <div className="info-row">
            <span className="info-label">Alliance:</span>
            <span className={`info-value ${isRedAlliance ? 'alliance-red' : isRedAlliance === false ? 'alliance-blue' : ''}`}>{alliance}</span>
          </div>
          <div className="info-row">
            <span className="info-label">Station:</span>
            <span className="info-value">{stationNumber}</span>
          </div>
          <div className="info-row">
            <span className="info-label">Shift Order:</span>
            <span className="info-value">{hubFirstLabel}</span>
          </div>
        </div>

        <div className="info-card auto-card-confirm">
          <h3>Selected Autonomous</h3>
          <div className="auto-display-large">
            <div className="auto-name-large">{selectedAuto?.name || 'None'}</div>
          </div>
          <div className="info-row">
            <span className="info-label">Battery:</span>
            <span className="info-value">{typeof batteryVoltage === 'number' ? `${batteryVoltage.toFixed(1)}V` : batteryVoltage}</span>
          </div>
        </div>
      </div>

      <div className="fms-status">
        <div className="fms-indicator">
          <span className={`fms-dot ${matchTime >= 0 || isAutoEnabled ? 'connected' : ''}`}></span>
          <span>
            {matchTime >= 0 || isAutoEnabled
              ? 'FMS Match Starting...'
              : `Waiting for FMS match start (Match Time: ${matchTime})`}
          </span>
        </div>
      </div>

      <div className="button-group">
        <button className="btn btn-secondary" onClick={() => goToStage('autoSelection')}>
          &larr; Back to Auto Selection
        </button>
      </div>
    </div>
  );
}
