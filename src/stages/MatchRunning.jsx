import { useEntry } from '@frc-web-components/react/networktables';

const MATCH_TYPE_LABELS = { 1: 'Practice', 2: 'Qualification', 3: 'Elimination' };

export default function MatchRunning({ stage, matchTime }) {
  const [fmsInfo] = useEntry('/FMSInfo', {});
  const eventName = fmsInfo?.EventName || '—';
  const matchNumber = fmsInfo?.MatchNumber ?? '—';
  const matchType = MATCH_TYPE_LABELS[fmsInfo?.MatchType] || '';
  const isRedAlliance = fmsInfo?.IsRedAlliance ?? null;

  const allianceText = isRedAlliance === null ? '—' : isRedAlliance ? 'Red' : 'Blue';
  const allianceClass = isRedAlliance === true ? 'alliance-red' : 'alliance-blue';

  const phase = stage === 'autonomous' ? 'Autonomous' : 'Teleop';
  const initialTime = stage === 'autonomous' ? '0:20' : '2:20';
  const displayTime = matchTime ?? initialTime;

  return (
    <div className="match-running-placeholder">
      <div className="match-running-phase">{phase}</div>

      <div className="match-running-timer">{displayTime}</div>

      <div className="match-running-details">
        {isRedAlliance !== null && (
          <span className={`alliance-pill ${allianceClass}`}>{allianceText} Alliance</span>
        )}
        {eventName !== '—' && (
          <span className="match-running-event">{eventName}</span>
        )}
        {matchNumber !== '—' && (
          <span className="match-running-match">
            {matchType ? `${matchType} Match ` : 'Match '}{matchNumber}
          </span>
        )}
      </div>

      <p className="match-running-hint">
        Driver dashboard is active — switch tabs to view
      </p>
    </div>
  );
}
