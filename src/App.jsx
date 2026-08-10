import { useEffect, useRef, useState } from 'react';
import { useNt4, useEntry } from '@frc-web-components/react/networktables';
import Header from './components/Header';
import AutoSelection from './stages/AutoSelection';
import Confirmation from './stages/Confirmation';
import Autonomous from './stages/Autonomous';
import Teleop from './stages/Teleop';
import PostGame from './stages/PostGame';
import Checklist from './stages/Checklist';
import NTTabView from './stages/NTTabView';
import NTTabWidgetGrid from './components/NTTabWidgetGrid';
import DownloadMenu from './components/DownloadMenu';
import AlertsOverlay from './components/AlertsOverlay';
import useMatchRecorder from './hooks/useMatchRecorder';
import useAdvantageScope from './hooks/useAdvantageScope';
import { useDiscoveredTabs } from './hooks/useDiscoveredTabs';
import MatchRunning from './stages/MatchRunning';
import RewindBar from './components/RewindBar';
import { LogReplayProvider } from './contexts/LogReplayContext';
import LogReplayDashboard from './components/LogReplayDashboard';
import { IconRefreshCw } from './utils/icons';
import { sync, matchSchedule, percentSyncComplete } from '../scripts/sync-predictions';

const KEYBINDS_ROOT = '/ChronosDashboard/commands/Keybinds';
const DASHBOARD_LIGHT_TOPIC = '/ChronosDashboard/dashboardLight/color';
const HEX_COLOR_RE = /^#?[0-9a-fA-F]{6}([0-9a-fA-F]{2})?$/;
const TEAM_NUMBER_STORAGE_KEY = 'chronos.teamNumber';

function normalizeSyncProgress(rawValue) {
  const numeric = Number(rawValue);
  if (!Number.isFinite(numeric)) return 0;
  const normalized = numeric <= 1 ? numeric * 100 : numeric;
  return Math.max(0, Math.min(100, normalized));
}

function formatTeamKeys(teamKeys) {
  if (!Array.isArray(teamKeys) || teamKeys.length === 0) return '--';
  const numbers = teamKeys
    .map((key) => String(key).replace(/^frc/i, '').trim())
    .filter(Boolean);
  return numbers.length > 0 ? numbers.join(', ') : '--';
}

function parseTeamNumbers(teamKeys) {
  if (!Array.isArray(teamKeys) || teamKeys.length === 0) return [];
  return teamKeys
    .map((key) => Number.parseInt(String(key).replace(/^frc/i, '').trim(), 10))
    .filter((value) => Number.isFinite(value) && value > 0);
}

function normalizeKeybindName(key) {
  if (typeof key !== 'string') return '';
  return key === ' ' ? 'space' : key.toLowerCase();
}

function hasTopic(data, topic) {
  if (!data) return false;
  if (data instanceof Map) return data.has(topic);
  return Object.prototype.hasOwnProperty.call(data, topic);
}

function isEditableElement(node) {
  if (!node || !(node instanceof HTMLElement)) return false;
  if (node.isContentEditable) return true;
  const tagName = node.tagName;
  if (tagName === 'TEXTAREA') return true;
  if (tagName !== 'INPUT') return false;
  const type = (node.getAttribute('type') || 'text').toLowerCase();
  return type !== 'button' && type !== 'checkbox' && type !== 'radio' && type !== 'range';
}

export default function App({ robotAddress }) {
  const { nt4Provider } = useNt4();
  const [stage, setStage] = useState('checklist');
  const [activeTab, setActiveTab] = useState('Match');
  const [selectedAuto, setSelectedAuto] = useState(null);
  const [autoRoutines, setAutoRoutines] = useState([]);
  const [matchStats, setMatchStats] = useState({
    totalPoints: 0,
    autoPoints: 0,
    teleopPoints: 0,
    endGamePoints: 0
  });
  const [heldKeybindKeys, setHeldKeybindKeys] = useState(() => new Set());
  const [dashboardLightColor, setDashboardLightColor] = useState(null);
  const [uploadReplayLog, setUploadReplayLog] = useState(null);
  const [matchTime, setMatchTime] = useState(null);
  const [settingsOpen, setSettingsOpen] = useState(false);
  const [sidebarOpen, setSidebarOpen] = useState(false);
  const [matchScheduleOpen, setMatchScheduleOpen] = useState(false);
  const [scheduleRows, setScheduleRows] = useState([]);
  const [scheduleSyncing, setScheduleSyncing] = useState(false);
  const [scheduleSyncProgress, setScheduleSyncProgress] = useState(0);
  const [scheduleError, setScheduleError] = useState('');
  const [teamNumber, setTeamNumber] = useState(() => {
    const raw = window.localStorage.getItem(TEAM_NUMBER_STORAGE_KEY);
    const parsed = Number.parseInt(raw || '', 10);
    return Number.isFinite(parsed) && parsed > 0 ? parsed : 172;
  });
  const [teamNumberDraft, setTeamNumberDraft] = useState(() => String(teamNumber));

  // Match recorder + AdvantageScope bridge
  const { startRecording, stopRecording, isRecording, currentLog, savedLogs } = useMatchRecorder();
  useAdvantageScope();
  const discoveredTabs = useDiscoveredTabs();

  // Driver tab: NT-configured tab to display during autonomous and teleop
  const [driverTabRaw] = useEntry('/ChronosDashboardMetadata/driverDashboard/tab', '');
  const driverTabName = typeof driverTabRaw === 'string' && driverTabRaw.trim() ? driverTabRaw.trim() : null;

  const goToStage = (newStage) => setStage(newStage);

  const resetDashboard = () => {
    setSelectedAuto(null);
    setMatchStats({ totalPoints: 0, autoPoints: 0, teleopPoints: 0, endGamePoints: 0 });
    setMatchTime(null);
    goToStage('checklist');
  };

  const heldKeybindsRef = useRef(new Set());

  const persistTeamNumber = (value) => {
    window.localStorage.setItem(TEAM_NUMBER_STORAGE_KEY, String(value));
  };

  const normalizeTeamNumber = (value, fallback = 172) => {
    const parsed = Number.parseInt(String(value), 10);
    if (!Number.isFinite(parsed) || parsed <= 0) return fallback;
    return parsed;
  };

  const openSettings = () => {
    setTeamNumberDraft(String(teamNumber));
    setSettingsOpen(true);
  };

  const toggleSidebar = () => setSidebarOpen((open) => !open);

  const openMatchSchedule = () => {
    if (document.activeElement instanceof HTMLElement) {
      document.activeElement.blur();
    }
    setScheduleRows(Array.isArray(matchSchedule) ? [...matchSchedule] : []);
    setScheduleSyncProgress(normalizeSyncProgress(percentSyncComplete));
    setMatchScheduleOpen(true);
    setSidebarOpen(false);
  };

  const closeMatchSchedule = () => {
    if (scheduleSyncing) return;
    setMatchScheduleOpen(false);
  };

  const syncMatchSchedule = async () => {
    if (scheduleSyncing) return;

    setScheduleError('');
    setScheduleSyncing(true);
    setScheduleSyncProgress(0);

    const syncPoller = window.setInterval(() => {
      setScheduleSyncProgress(normalizeSyncProgress(percentSyncComplete));
      setScheduleRows(Array.isArray(matchSchedule) ? [...matchSchedule] : []);
    }, 120);

    try {
      await sync(window.localStorage.getItem(TEAM_NUMBER_STORAGE_KEY));
      setScheduleRows(Array.isArray(matchSchedule) ? [...matchSchedule] : []);
      setScheduleSyncProgress(normalizeSyncProgress(percentSyncComplete));
    } catch (error) {
      setScheduleError(error?.message || 'Failed to sync match schedule.');
    } finally {
      window.clearInterval(syncPoller);
      setScheduleSyncing(false);
      setScheduleSyncProgress(normalizeSyncProgress(percentSyncComplete));
    }
  };

  const closeSettings = () => {
    const normalized = normalizeTeamNumber(teamNumberDraft, teamNumber);
    setTeamNumber(normalized);
    setTeamNumberDraft(String(normalized));
    persistTeamNumber(normalized);
    setSettingsOpen(false);
  };

  useEffect(() => {
    const flushTeamNumber = () => {
      persistTeamNumber(normalizeTeamNumber(teamNumberDraft, teamNumber));
    };

    const handleVisibilityChange = () => {
      if (document.hidden) flushTeamNumber();
    };

    window.addEventListener('beforeunload', flushTeamNumber);
    document.addEventListener('visibilitychange', handleVisibilityChange);
    return () => {
      window.removeEventListener('beforeunload', flushTeamNumber);
      document.removeEventListener('visibilitychange', handleVisibilityChange);
    };
  }, [teamNumber, teamNumberDraft]);

  useEffect(() => {
    if (!nt4Provider) return;
    const sync = () => {
      const values = nt4Provider.topicValues || {};
      const raw = values instanceof Map
        ? values.get(DASHBOARD_LIGHT_TOPIC)
        : values[DASHBOARD_LIGHT_TOPIC];
      if (typeof raw === 'string' && HEX_COLOR_RE.test(raw.trim())) {
        const normalized = raw.trim().replace(/^#/, '').slice(0, 6);
        const color = `#${normalized}`;
        setDashboardLightColor(color);
      } else {
        setDashboardLightColor(null);
      }
    };
    sync();
    const id = setInterval(sync, 50);
    return () => clearInterval(id);
  }, [nt4Provider]);

  useEffect(() => {
    const body = document.body;
    const root = document.documentElement;
    const previousBodyBackground = body.style.backgroundColor;
    const previousBodyImage = body.style.backgroundImage;
    const previousRootBackground = root.style.backgroundColor;

    if (dashboardLightColor) {
      body.style.backgroundColor = dashboardLightColor;
      body.style.backgroundImage = 'none';
      root.style.backgroundColor = dashboardLightColor;
    }

    return () => {
      body.style.backgroundColor = previousBodyBackground;
      body.style.backgroundImage = previousBodyImage;
      root.style.backgroundColor = previousRootBackground;
    };
  }, [dashboardLightColor]);

  useEffect(() => {
    if (!nt4Provider?.setValue) return;

    const getPressedTopic = (key) => `${KEYBINDS_ROOT}/${key}/pressed`;

    const hasPressedTopicForKey = (key) => {
      const topic = getPressedTopic(key);
      return hasTopic(nt4Provider.topics, topic) || hasTopic(nt4Provider.topicValues, topic);
    };

    const isTypingContext = (event) => {
      const target = event?.target;
      if (isEditableElement(target)) return true;
      return isEditableElement(document.activeElement);
    };

    // Ignore keys that are purely modifiers or have no useful string name
    const isIgnoredKey = (key) =>
      !key ||
      key === 'control' ||
      key === 'shift' ||
      key === 'alt' ||
      key === 'meta' ||
      key === 'dead';

    const releaseAllHeld = () => {
      if (heldKeybindsRef.current.size === 0) return;
      heldKeybindsRef.current.forEach((key) => {
        nt4Provider.setValue(getPressedTopic(key), false);
      });
      heldKeybindsRef.current.clear();
      setHeldKeybindKeys(new Set());
    };

    const handleKeyDown = (event) => {
      const key = normalizeKeybindName(event.key);
      if (isIgnoredKey(key)) return;

      if (isTypingContext(event)) return;

      const topic = getPressedTopic(key);
      if (!hasPressedTopicForKey(key)) return;

      // Prevent browser/Electron default only for keys the robot is listening on
      // (avoids blocking Cmd+C, Cmd+V, etc. for normal usage)
      event.preventDefault();

      if (heldKeybindsRef.current.has(key)) return;

      heldKeybindsRef.current.add(key);
      setHeldKeybindKeys(new Set(heldKeybindsRef.current));
      nt4Provider.setValue(topic, true);
    };

    const handleKeyUp = (event) => {
      const key = normalizeKeybindName(event.key);
      if (isIgnoredKey(key)) return;

      if (isTypingContext(event)) return;

      if (!hasPressedTopicForKey(key)) return;

      if (!heldKeybindsRef.current.has(key)) return;

      event.preventDefault();

      heldKeybindsRef.current.delete(key);
      setHeldKeybindKeys(new Set(heldKeybindsRef.current));
      nt4Provider.setValue(getPressedTopic(key), false);
    };

    const handleVisibilityChange = () => {
      if (document.hidden) releaseAllHeld();
    };

    // Only release held keys when the OS window actually loses focus,
    // NOT when focus moves between elements within the page (which also
    // fires window 'blur' and was the cause of WASD being released when
    // an arrow key shifted focus to a grid item or scrubber input).
    const handleWindowBlur = () => {
      if (!document.hasFocus()) releaseAllHeld();
    };

    window.addEventListener('keydown', handleKeyDown);
    window.addEventListener('keyup', handleKeyUp);
    window.addEventListener('blur', handleWindowBlur);
    document.addEventListener('visibilitychange', handleVisibilityChange);

    // Electron OS-level window blur (definitive signal the user switched apps)
    let unsubWindowBlur;
    if (window.electronAPI?.onWindowBlur) {
      unsubWindowBlur = window.electronAPI.onWindowBlur(releaseAllHeld);
    }

    // Synthetic key events forwarded from the Electron main process
    // (for F-keys, Escape, arrows, etc. that Chromium would otherwise eat).
    let unsubGlobalKey;
    if (window.electronAPI?.onGlobalKeyEvent) {
      unsubGlobalKey = window.electronAPI.onGlobalKeyEvent(({ type, key }) => {
        const syntheticEvent = { key, preventDefault: () => {} };
        if (type === 'keydown') handleKeyDown(syntheticEvent);
        else if (type === 'keyup') handleKeyUp(syntheticEvent);
      });
    }

    return () => {
      window.removeEventListener('keydown', handleKeyDown);
      window.removeEventListener('keyup', handleKeyUp);
      window.removeEventListener('blur', handleWindowBlur);
      document.removeEventListener('visibilitychange', handleVisibilityChange);
      unsubWindowBlur?.();
      unsubGlobalKey?.();
      releaseAllHeld();
    };
  }, [nt4Provider]);

  // Auto-switch to driver tab when match is running, back to Match for post-game.
  // Falls back to the first discovered NT tab if driverTabName is not configured.
  useEffect(() => {
    if (stage === 'autonomous' || stage === 'teleop') {
      const target = driverTabName || discoveredTabs[0] || null;
      if (target) setActiveTab(target);
    } else if (stage === 'postGame' || stage === 'checklist') {
      setActiveTab('Match');
    }
  }, [stage, driverTabName, discoveredTabs]);

  const lightStyle = dashboardLightColor
    ? {
        backgroundColor: dashboardLightColor,
        backgroundImage: 'none',
        transition: 'background-color 120ms linear',
      }
    : {
        transition: 'background-color 120ms linear',
      };

  const predictedWins = scheduleRows.filter((match) => typeof match?.prediction === 'number' && match.prediction >= 0.5).length;
  const predictedLosses = scheduleRows.filter((match) => typeof match?.prediction === 'number' && match.prediction < 0.5).length;

  function renderStage() {
    // Non-Match tabs use the full widget-grid viewer.
    // During autonomous/teleop, keep those components mounted for their timer and FMS logic.
    if (activeTab !== 'Match') {
      return (
        <>
          {stage === 'autonomous' && <Autonomous selectedAuto={selectedAuto} goToStage={goToStage} onEnter={startRecording} onTimeUpdate={setMatchTime} />}
          {stage === 'teleop' && <Teleop goToStage={goToStage} setMatchStats={setMatchStats} stopRecording={stopRecording} onTimeUpdate={setMatchTime} />}
          <NTTabWidgetGrid tabName={activeTab} heldKeybindKeys={heldKeybindKeys} />
        </>
      );
    }

    switch (stage) {
      case 'checklist':
        return <Checklist goToStage={goToStage} teamNumber={teamNumber} />;
      case 'autoSelection':
        return (
          <AutoSelection
            goToStage={goToStage}
            selectedAuto={selectedAuto}
            setSelectedAuto={setSelectedAuto}
            autoRoutines={autoRoutines}
            setAutoRoutines={setAutoRoutines}
          />
        );
      case 'confirmation':
        return <Confirmation goToStage={goToStage} selectedAuto={selectedAuto} />;
      case 'autonomous':
        return (
          <>
            <Autonomous selectedAuto={selectedAuto} goToStage={goToStage} onEnter={startRecording} onTimeUpdate={setMatchTime} />
            <MatchRunning stage="autonomous" matchTime={matchTime} />
          </>
        );
      case 'teleop':
        return (
          <>
            <Teleop goToStage={goToStage} setMatchStats={setMatchStats} stopRecording={stopRecording} onTimeUpdate={setMatchTime} />
            <MatchRunning stage="teleop" matchTime={matchTime} />
          </>
        );
      case 'postGame':
        return (
          <PostGame
            matchStats={matchStats}
            resetDashboard={resetDashboard}
            currentLog={currentLog}
            savedLogs={savedLogs}
          />
        );
      default:
        return null;
    }
  }

  return (
    <>
      <Header
        stage={stage}
        activeTab={activeTab}
        setActiveTab={setActiveTab}
        autoRoutines={autoRoutines}
        isRecording={isRecording}
        onUploadLog={setUploadReplayLog}
        onOpenSettings={openSettings}
        onToggleSidebar={toggleSidebar}
        robotAddress={robotAddress}
        discoveredTabs={discoveredTabs}
        matchTime={matchTime}
      />
      {sidebarOpen && (
        <button
          type="button"
          className="app-sidebar-backdrop"
          onClick={() => setSidebarOpen(false)}
          aria-label="Close sidebar"
        />
      )}
      <aside className={`app-sidebar ${sidebarOpen ? 'open' : ''}`} aria-hidden={!sidebarOpen}>
        <div className="app-sidebar-header">Menu</div>
        <button type="button" className="app-sidebar-item" onClick={openMatchSchedule}>
          Match Schedule
        </button>
      </aside>
      <main style={lightStyle}>{renderStage()}</main>
      {settingsOpen && (
        <div className="settings-modal-overlay" role="dialog" aria-modal="true" aria-label="Settings">
          <div className="settings-modal-card">
            <h3 className="settings-modal-title">Settings</h3>
            <label className="settings-modal-label" htmlFor="team-number-input">Team Number</label>
            <input
              id="team-number-input"
              className="settings-modal-input"
              type="number"
              min="1"
              step="1"
              value={teamNumberDraft}
              onChange={(event) => setTeamNumberDraft(event.target.value)}
              onKeyDown={(event) => {
                if (event.key === 'Enter') closeSettings();
              }}
            />
            <button type="button" className="btn btn-primary" onClick={closeSettings}>Save</button>
          </div>
        </div>
      )}
      {matchScheduleOpen && (
        <div className="settings-modal-overlay" role="dialog" aria-modal="true" aria-label="Match schedule">
          <div className="schedule-modal-card">
            <div className="schedule-modal-header">
              <div className="schedule-modal-title-wrap">
                <h3 className="settings-modal-title">Match Schedule</h3>
                <span className="schedule-winloss-summary">Predicted W-L: {predictedWins}-{predictedLosses}</span>
              </div>
              <div className="schedule-modal-actions">
                <button
                  type="button"
                  className="header-icon-btn schedule-sync-btn"
                  title="Sync schedule"
                  aria-label="Sync schedule"
                  onClick={syncMatchSchedule}
                  disabled={scheduleSyncing}
                >
                  <IconRefreshCw size={15} />
                </button>
                <button type="button" className="schedule-close-btn" onClick={closeMatchSchedule} disabled={scheduleSyncing}>
                  &times;
                </button>
              </div>
            </div>

            <p className="schedule-sync-status">
              {scheduleSyncing
                ? `Syncing ${Math.round(scheduleSyncProgress)}%`
                : `Sync progress ${Math.round(scheduleSyncProgress)}%`}
            </p>
            <div className="schedule-sync-progress-track" role="progressbar" aria-valuemin={0} aria-valuemax={100} aria-valuenow={Math.round(scheduleSyncProgress)}>
              <div className="schedule-sync-progress-fill" style={{ width: `${scheduleSyncProgress}%` }} />
            </div>

            {scheduleError && <p className="schedule-sync-error">{scheduleError}</p>}

            <div className="schedule-list">
              {scheduleRows.length === 0 ? (
                <div className="schedule-empty">No matches loaded yet. Press sync.</div>
              ) : (
                scheduleRows.map((match) => {
                  const redTeams = parseTeamNumbers(match?.alliances?.red?.team_keys);
                  const blueTeams = parseTeamNumbers(match?.alliances?.blue?.team_keys);

                  return (
                    <div key={match.key} className="schedule-item">
                      <span className="schedule-item-match">Match {match.match_number}</span>
                      <span className="schedule-item-time">{match.predicted_day_time}</span>
                      <span
                        className={`schedule-item-prediction ${typeof match.prediction === 'number' && match.prediction < 0.5 ? 'loss' : 'win'}`}
                      >
                        {typeof match.prediction === 'number' ? `${(match.prediction * 100).toFixed(1)}%` : '--'}
                      </span>
                      <div className="schedule-item-alliances">
                        <div className="schedule-item-alliance schedule-item-alliance-red">
                          <span className="schedule-item-alliance-label">Red</span>
                          <div className="schedule-team-list">
                            {redTeams.map((teamNumberValue) => (
                              <span
                                key={`red-${match.key}-${teamNumberValue}`}
                                className={`schedule-team-pill ${teamNumberValue === teamNumber ? 'client-team' : ''}`}
                              >
                                {teamNumberValue}
                              </span>
                            ))}
                          </div>
                        </div>
                        <div className="schedule-item-alliance schedule-item-alliance-blue">
                          <span className="schedule-item-alliance-label">Blue</span>
                          <div className="schedule-team-list">
                            {blueTeams.map((teamNumberValue) => (
                              <span
                                key={`blue-${match.key}-${teamNumberValue}`}
                                className={`schedule-team-pill ${teamNumberValue === teamNumber ? 'client-team' : ''}`}
                              >
                                {teamNumberValue}
                              </span>
                            ))}
                          </div>
                        </div>
                      </div>
                    </div>
                  );
                })
              )}
            </div>
          </div>
        </div>
      )}
      <DownloadMenu autoRoutines={autoRoutines} currentLog={currentLog} />
      <AlertsOverlay />
      {!uploadReplayLog && <RewindBar />}
      {uploadReplayLog && (
        <LogReplayProvider log={uploadReplayLog} onClose={() => setUploadReplayLog(null)}>
          <LogReplayDashboard />
        </LogReplayProvider>
      )}
    </>
  );
}
