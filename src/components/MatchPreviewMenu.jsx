import { useEffect, useRef, useState } from 'react';
import { getMatchContributionProjection } from '../../scripts/sync-predictions';

function formatProjectionValue(value) {
  const numeric = Number(value);
  return Number.isFinite(numeric) ? numeric.toFixed(1) : '--';
}

function formatProjectionPercent(value) {
  const numeric = Number(value);
  return Number.isFinite(numeric) ? `${Math.round(numeric * 100)}%` : null;
}

const IconChart = () => (
  <svg width="22" height="22" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round" aria-hidden="true">
    <line x1="4" y1="20" x2="20" y2="20" />
    <line x1="7" y1="16" x2="7" y2="11" />
    <line x1="12" y1="16" x2="12" y2="5" />
    <line x1="17" y1="16" x2="17" y2="8" />
  </svg>
);

export default function MatchPreviewMenu({ match, view, onViewChange, brief, briefLoading, formatTime }) {
  const [isOpen, setIsOpen] = useState(false);
  const panelRef = useRef(null);
  const contributionProjection = getMatchContributionProjection(match);

  useEffect(() => {
    const handlePointerDown = (event) => {
      if (panelRef.current && !panelRef.current.contains(event.target)) setIsOpen(false);
    };

    document.addEventListener('mousedown', handlePointerDown);
    return () => document.removeEventListener('mousedown', handlePointerDown);
  }, []);

  if (!match?.key) return null;

  return (
    <div className="match-preview-container" ref={panelRef}>
      <button
        type="button"
        className={`match-preview-fab ${isOpen ? 'match-preview-fab--open' : ''}`}
        onClick={() => setIsOpen((open) => !open)}
        aria-label="Next match projections"
        aria-expanded={isOpen}
        title="Next match projections"
      >
        <IconChart />
      </button>
      {isOpen && (
        <section className="match-preview" aria-live="polite" aria-label="Next match projections">
          <div className="match-preview-header">
            <h2>Match {match.match_number}</h2>
            <div className="match-preview-actions">
              <div className="match-preview-toggle" role="group" aria-label="Next match view">
                <button
                  type="button"
                  className={view === 'projections' ? 'active' : ''}
                  onClick={() => onViewChange('projections')}
                  aria-pressed={view === 'projections'}
                >
                  Stats
                </button>
                <button
                  type="button"
                  className={view === 'brief' ? 'active' : ''}
                  onClick={() => onViewChange('brief')}
                  aria-pressed={view === 'brief'}
                >
                  Brief
                </button>
              </div>
              <span className="match-preview-time">{formatTime(match.predicted_time ?? match.time)}</span>
            </div>
          </div>
          {view === 'projections' ? (
            <div className="match-contribution-chart">
              {['red', 'blue'].map((alliance) => {
                const contribution = contributionProjection?.[alliance];
                const score = formatProjectionValue(contribution?.projectedScore);
                const winProbability = formatProjectionPercent(contribution?.winProbability);

                return (
                  <section key={alliance} className={`match-alliance-chart ${alliance}`} aria-label={`${alliance} alliance projections`}>
                    <div className="match-alliance-chart-header">
                      <span>{alliance} alliance</span>
                      <span>{score === '--' ? '-- pts' : `${score} pts`}{winProbability && ` · ${winProbability}`}</span>
                    </div>
                    <div className="match-contribution-rows">
                      {contribution?.teams?.map((robot) => {
                        const width = contribution.highestContribution > 0 && robot.totalPoints != null
                          ? Math.max(3, (robot.totalPoints / contribution.highestContribution) * 100)
                          : 0;
                        return (
                          <div className="match-contribution-row" key={`${alliance}-${robot.team}`}>
                            <span className="match-contribution-team">{robot.team ?? '--'}</span>
                            <div className="match-contribution-bar" aria-label={`${formatProjectionValue(robot.totalPoints)} projected points`}>
                              <span style={{ width: `${width}%` }} />
                            </div>
                            <span className="match-contribution-total">{formatProjectionValue(robot.totalPoints)} pts</span>
                          </div>
                        );
                      })}
                      {!contribution?.teams?.length && <p className="match-contribution-empty">Team projections are not available yet.</p>}
                    </div>
                  </section>
                );
              })}
            </div>
          ) : briefLoading ? (
            <p className="match-preview-loading">Preparing strategy notes&hellip;</p>
          ) : brief ? (
            <div className="match-preview-brief">
              {brief.split('\n').map((line, index) => {
                const separatorIndex = line.indexOf(': ');
                const label = separatorIndex > 0 ? line.slice(0, separatorIndex) : null;
                const copy = separatorIndex > 0 ? line.slice(separatorIndex + 2) : line;
                return <p key={`${match.key}-${index}`}>{label && <strong>{label}: </strong>}{copy}</p>;
              })}
            </div>
          ) : (
            <p className="match-preview-loading">Match brief is unavailable.</p>
          )}
        </section>
      )}
    </div>
  );
}
