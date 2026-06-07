import { useRef, useState } from 'react';
import { useEntry } from '@frc-web-components/react/networktables';
import { useEntryOrHistorical } from '../hooks/useEntryOrHistorical';
import MatchReplayViewer from '../components/MatchReplayViewer';
import { downloadWpilog, downloadLogJson, parseUploadedLog } from '../utils/wpilog';
import { IconDownload, IconPlay, IconFolder, IconWarning } from '../utils/icons';

export default function PostGame({ matchStats, resetDashboard, currentLog, savedLogs }) {
  const [replayLog, setReplayLog] = useState(null);
  const [uploadError, setUploadError] = useState(null);
  const uploadRef = useRef(null);

  const handleUploadChange = async (e) => {
    const file = e.target.files?.[0];
    if (!file) return;
    e.target.value = '';
    setUploadError(null);
    try {
      const log = await parseUploadedLog(file);
      setReplayLog(log);
    } catch (err) {
      setUploadError(err.message ?? 'Failed to parse log file');
    }
  };
  const [ballsScored] = useEntryOrHistorical('/Dashboard/Scoring', 0);
  const [stats] = useEntry('/Dashboard/Stats', {
    totalPoints: matchStats.totalPoints,
    autoPoints: matchStats.autoPoints,
    endGamePoints: matchStats.endGamePoints
  });

  const scored = typeof ballsScored === 'number' ? ballsScored : 0;
  const totalPoints = stats?.totalPoints || matchStats.totalPoints;
  const autoPoints = stats?.autoPoints || matchStats.autoPoints;
  const endGamePoints = stats?.endGamePoints || matchStats.endGamePoints;

  return (
    <div className="stage-container">
      <h2 className="stage-title">Match Complete</h2>

      <div className="match-result">
        <div className="result-banner">
          <div className="result-text">MATCH ENDED</div>
        </div>
      </div>

      <div className="stats-grid">
        <div className="stat-card highlight-card">
          <h3>Total Points</h3>
          <div className="stat-value-large">{totalPoints}</div>
        </div>

        <div className="stat-card">
          <h3>Autonomous</h3>
          <div className="stat-breakdown">
            <div className="stat-row">
              <span>Points:</span>
              <span>{autoPoints}</span>
            </div>
          </div>
        </div>

        <div className="stat-card">
          <h3>Teleoperated</h3>
          <div className="stat-breakdown">
            <div className="stat-row">
              <span>Balls Scored:</span>
              <span>{scored}</span>
            </div>
            <div className="stat-row">
              <span>Points:</span>
              <span>{scored}</span>
            </div>
          </div>
        </div>

        <div className="stat-card">
          <h3>End Game</h3>
          <div className="stat-breakdown">
            <div className="stat-row">
              <span>Points:</span>
              <span>{endGamePoints}</span>
            </div>
          </div>
        </div>
      </div>

      {/* Match recording download + replay section */}
      {currentLog && (
        <div className="postgame-recording">
          <h3>Match Recording</h3>
          <div className="recording-actions">
            <button
              className="btn btn-sm btn-primary"
              onClick={() => downloadWpilog(currentLog)}
              title="Download as WPILog binary (compatible with AdvantageScope)"
            >
              <IconDownload size={13}/> Download .wpilog
            </button>
            <button
              className="btn btn-sm btn-ghost"
              onClick={() => downloadLogJson(currentLog)}
              title="Download as human-readable JSON"
            >
              <IconDownload size={13}/> Download .json
            </button>
            <button
              className="btn btn-sm btn-ghost"
              onClick={() => setReplayLog(currentLog)}
            >
              <IconPlay size={13}/> Replay
            </button>
          </div>
        </div>
      )}

      {/* Saved logs list */}
      {savedLogs && savedLogs.length > 0 && (
        <div className="postgame-saved-logs">
          <h3>Previous Recordings</h3>
          <div className="saved-logs-list">
            {savedLogs.map((log, i) => (
              <div key={log.startTimestamp} className="saved-log-row">
                <span className="saved-log-ts">
                  {new Date(log.startTimestamp).toLocaleString()}
                </span>
                <span className="saved-log-dur">
                  {Math.floor(log.durationMs / 1000)}s
                </span>
                <button className="btn btn-sm btn-ghost" onClick={() => downloadWpilog(log)}><IconDownload size={13}/> .wpilog</button>
                <button className="btn btn-sm btn-ghost" onClick={() => setReplayLog(log)}><IconPlay size={13}/></button>
              </div>
            ))}
          </div>
        </div>
      )}

      {/* Upload external log for replay */}
      <div className="postgame-recording" style={{ marginTop: 12 }}>
        <h3>Replay External Log</h3>
        <p style={{ fontSize: 13, color: 'var(--color-text-muted)', margin: '4px 0 10px' }}>
          Upload a <code>.wpilog</code> (robot recording) or <code>.json</code> (dashboard export) to replay.
        </p>
        <div className="recording-actions">
          <input
            ref={uploadRef}
            type="file"
            accept=".wpilog,.json"
            style={{ display: 'none' }}
            onChange={handleUploadChange}
          />
          <button
            className="btn btn-sm btn-ghost"
            onClick={() => uploadRef.current?.click()}
          >
            <IconFolder size={13}/> Upload & Replay
          </button>
          {uploadError && (
            <span style={{ color: 'var(--color-danger)', fontSize: 12 }}>
              <IconWarning size={13}/> {uploadError}
            </span>
          )}
        </div>
      </div>

      <button className="btn btn-primary btn-large" onClick={resetDashboard}>
        Start New Match
      </button>

      {/* Replay overlay (current match or uploaded log) */}
      {replayLog && (
        <MatchReplayViewer log={replayLog} onClose={() => setReplayLog(null)} />
      )}
    </div>
  );
}
