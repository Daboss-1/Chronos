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
import MatchPreviewMenu from './components/MatchPreviewMenu';
import AlertsOverlay from './components/AlertsOverlay';
import useMatchRecorder from './hooks/useMatchRecorder';
import useAdvantageScope from './hooks/useAdvantageScope';
import { useDiscoveredTabs } from './hooks/useDiscoveredTabs';
import MatchRunning from './stages/MatchRunning';
import RewindBar from './components/RewindBar';
import { LogReplayProvider } from './contexts/LogReplayContext';
import LogReplayDashboard from './components/LogReplayDashboard';
import { IconRefreshCw } from './utils/icons';
import { sync, generatePreMatchBrief, matchSchedule, percentSyncComplete, nextMatch } from '../scripts/sync-predictions';

const KEYBINDS_ROOT = '/ChronosDashboard/commands/Keybinds';
const DASHBOARD_LIGHT_TOPIC = '/ChronosDashboard/dashboardLight/color';
const HEX_COLOR_RE = /^#?[0-9a-fA-F]{6}([0-9a-fA-F]{2})?$/;
const TEAM_NUMBER_STORAGE_KEY = 'chronos.teamNumber';
const MATCH_SCHEDULE_STORAGE_KEY = 'chronos.matchSchedule';
const BACKGROUND_SYNC_ENABLED_STORAGE_KEY = 'chronos.backgroundScheduleSyncEnabled';
const BACKGROUND_SYNC_MINUTES_STORAGE_KEY = 'chronos.backgroundScheduleSyncMinutes';

function readStoredMatchSchedule() {
  try {
    const raw = window.localStorage.getItem(MATCH_SCHEDULE_STORAGE_KEY);
    if (!raw) return [];
    const parsed = JSON.parse(raw);
    return Array.isArray(parsed) ? parsed : [];
  } catch {
    return [];
  }
}

function persistMatchSchedule(scheduleRows) {
  if (!Array.isArray(scheduleRows)) return;
  window.localStorage.setItem(MATCH_SCHEDULE_STORAGE_KEY, JSON.stringify(scheduleRows));
}

function readStoredBackgroundSyncEnabled() {
  const raw = window.localStorage.getItem(BACKGROUND_SYNC_ENABLED_STORAGE_KEY);
  if (raw === null) return true;
  return raw !== 'false';
}

function readStoredBackgroundSyncMinutes() {
  const raw = window.localStorage.getItem(BACKGROUND_SYNC_MINUTES_STORAGE_KEY);
  const parsed = Number.parseInt(raw || '', 10);
  return Number.isFinite(parsed) && parsed > 0 ? parsed : 2;
}

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

function formatCountdown(totalSeconds) {
  const clamped = Math.max(0, Math.floor(totalSeconds));
  const hours = Math.floor(clamped / 3600);
  const minutes = Math.floor((clamped % 3600) / 60);
  const seconds = clamped % 60;

  if (hours > 0) {
    return `${hours}:${String(minutes).padStart(2, '0')}:${String(seconds).padStart(2, '0')}`;
  }

  return `${minutes}:${String(seconds).padStart(2, '0')}`;
}

function getMatchWinProbability(match, teamNumber) {
  const redWinProb = Number(match?.pred?.red_win_prob);
  if (!Number.isFinite(redWinProb)) return null;

  const redTeams = match?.alliances?.red?.team_keys;
  const blueTeams = match?.alliances?.blue?.team_keys;
  const normalizeTeamValue = (value) => {
    if (typeof value === 'number') {
      return Number.isFinite(value) ? value : null;
    }
    const parsed = Number.parseInt(String(value).replace(/^frc/i, '').trim(), 10);
    return Number.isFinite(parsed) ? parsed : null;
  };

  const targetTeam = normalizeTeamValue(teamNumber);
  if (!Number.isFinite(targetTeam)) return null;

  const redHasTeam = Array.isArray(redTeams) && redTeams.some((value) => normalizeTeamValue(value) === targetTeam);
  const blueHasTeam = Array.isArray(blueTeams) && blueTeams.some((value) => normalizeTeamValue(value) === targetTeam);

  if (redHasTeam) {
    return redWinProb;
  }
  if (blueHasTeam) {
    return 1 - redWinProb;
  }

  return null;
}

function formatPredictedDayTime(epochSeconds) {
  const numeric = Number(epochSeconds);
  if (!Number.isFinite(numeric) || numeric <= 0) return '--';

  const date = new Date(numeric * 1000);
  return date.toLocaleString([], {
    weekday: 'short',
    hour: 'numeric',
    minute: '2-digit'
  });
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
  if (window.localStorage.getItem(TEAM_NUMBER_STORAGE_KEY) === null) {
    window.localStorage.setItem(TEAM_NUMBER_STORAGE_KEY, '172');
  }
  if (window.localStorage.getItem(BACKGROUND_SYNC_ENABLED_STORAGE_KEY) === null) {
    window.localStorage.setItem(BACKGROUND_SYNC_ENABLED_STORAGE_KEY, 'true');
  }
  if (window.localStorage.getItem(BACKGROUND_SYNC_MINUTES_STORAGE_KEY) === null) {
    window.localStorage.setItem(BACKGROUND_SYNC_MINUTES_STORAGE_KEY, '2');
  }

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
  const [scheduleRows, setScheduleRows] = useState(() => readStoredMatchSchedule());
  const [scheduleSyncing, setScheduleSyncing] = useState(false);
  const [scheduleSyncProgress, setScheduleSyncProgress] = useState(0);
  const [scheduleError, setScheduleError] = useState('');
  const [scheduleNextMatch, setScheduleNextMatch] = useState(nextMatch ?? null);
  const [scheduleHasSuccessfulSync, setScheduleHasSuccessfulSync] = useState(false);
  const [preMatchBrief, setPreMatchBrief] = useState('');
  const [preMatchBriefLoading, setPreMatchBriefLoading] = useState(false);
  const [matchPreviewView, setMatchPreviewView] = useState('projections');
  const [currentEpochMs, setCurrentEpochMs] = useState(() => Date.now());
  const [backgroundSyncEnabled, setBackgroundSyncEnabled] = useState(() => readStoredBackgroundSyncEnabled());
  const [backgroundSyncEnabledDraft, setBackgroundSyncEnabledDraft] = useState(() => backgroundSyncEnabled);
  const [backgroundSyncMinutes, setBackgroundSyncMinutes] = useState(() => readStoredBackgroundSyncMinutes());
  const [backgroundSyncMinutesDraft, setBackgroundSyncMinutesDraft] = useState(() => String(backgroundSyncMinutes));
  const [backgroundSyncActive, setBackgroundSyncActive] = useState(false);
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

  // Next match hook: for usage by the sync function
  const setNextMatchEntryHandler = (nextMatchToSend) => {
    console.log("Setting next match")
    console.log(nextMatchToSend)
    if (nextMatchToSend?.alliances?.blue?.team_keys && nextMatchToSend?.alliances?.blue?.team_predictions) {
      for (let i of nextMatchToSend.alliances.blue.team_keys) {
        nt4Provider.setValue(`/ChronosDashboard/matches/nextMatch/blueAlliance/${i}/present`, true)
      }
      for (let i of nextMatchToSend.alliances.blue.team_predictions) {
        nt4Provider.setValue(`/ChronosDashboard/matches/nextMatch/blueAlliance/${i.team}/epa/predicted_contribution`, i.epa.total_points)
        nt4Provider.setValue(`/ChronosDashboard/matches/nextMatch/blueAlliance/${i.team}/epa/post_match_adjustment`, i.epa.post)
        for (let k of Object.keys(i.epa.breakdown)) {
          nt4Provider.setValue(`/ChronosDashboard/matches/nextMatch/blueAlliance/${i.team}/epa/breakdown/${k}`, i.epa.breakdown[k])
        }
      }
    }
    if (nextMatchToSend?.alliances?.red?.team_keys && nextMatchToSend?.alliances?.red?.team_predictions) {
      for (let i of nextMatchToSend.alliances.red.team_keys) {
        nt4Provider.setValue(`/ChronosDashboard/matches/nextMatch/redAlliance/${i}/present`, true)
      }
      for (let i of nextMatchToSend.alliances.red.team_predictions) {
        nt4Provider.setValue(`/ChronosDashboard/matches/nextMatch/redAlliance/${i.team}/epa/predicted_contribution`, i.epa.total_points)
        nt4Provider.setValue(`/ChronosDashboard/matches/nextMatch/redAlliance/${i.team}/epa/post_match_adjustment`, i.epa.post)
        for (let k of Object.keys(i.epa.breakdown)) {
          nt4Provider.setValue(`/ChronosDashboard/matches/nextMatch/redAlliance/${i.team}/epa/breakdown/${k}`, i.epa.breakdown[k])
        }
      }
    }
    if (nextMatchToSend?.pred) {
      for (let i of Object.keys(nextMatchToSend.pred)) {
        nt4Provider.setValue(`/ChronosDashboard/matches/nextMatch/prediction/${i}`, nextMatchToSend.pred[i])
      }
    }
  }

  const setNextMatchScheduleEntryHandler = (matchesToSend) => {
    for (let nextMatchToSend of matchesToSend) {
      if (nextMatchToSend?.alliances?.blue?.team_keys && nextMatchToSend?.alliances?.blue?.team_predictions) {
        for (let i of nextMatchToSend.alliances.blue.team_keys) {
          nt4Provider.setValue(`/ChronosDashboard/matches/${nextMatchToSend.key}/blueAlliance/${i}/present`, true)
        }
        for (let i of nextMatchToSend.alliances.blue.team_predictions) {
          nt4Provider.setValue(`/ChronosDashboard/matches/${nextMatchToSend.key}/blueAlliance/${i.team}/epa/predicted_contribution`, i.epa.total_points)
          nt4Provider.setValue(`/ChronosDashboard/matches/${nextMatchToSend.key}/blueAlliance/${i.team}/epa/post_match_adjustment`, i.epa.post)
          for (let k of Object.keys(i.epa.breakdown)) {
            nt4Provider.setValue(`/ChronosDashboard/matches/${nextMatchToSend.key}/blueAlliance/${i.team}/epa/breakdown/${k}`, i.epa.breakdown[k])
          }
        }
      }
      if (nextMatchToSend?.alliances?.red?.team_keys && nextMatchToSend?.alliances?.red?.team_predictions) {
        for (let i of nextMatchToSend.alliances.red.team_keys) {
          nt4Provider.setValue(`/ChronosDashboard/matches/${nextMatchToSend.key}/redAlliance/${i}/present`, true)
        }
        for (let i of nextMatchToSend.alliances.red.team_predictions) {
          nt4Provider.setValue(`/ChronosDashboard/matches/${nextMatchToSend.key}/redAlliance/${i.team}/epa/predicted_contribution`, i.epa.total_points)
          nt4Provider.setValue(`/ChronosDashboard/matches/${nextMatchToSend.key}/redAlliance/${i.team}/epa/post_match_adjustment`, i.epa.post)
          for (let k of Object.keys(i.epa.breakdown)) {
            nt4Provider.setValue(`/ChronosDashboard/matches/${nextMatchToSend.key}/redAlliance/${i.team}/epa/breakdown/${k}`, i.epa.breakdown[k])
          }
        }
      }
      if (nextMatchToSend?.pred) {
        for (let i of Object.keys(nextMatchToSend.pred)) {
          nt4Provider.setValue(`/ChronosDashboard/matches/${nextMatchToSend.key}/prediction/${i}`, nextMatchToSend.pred[i])
        }
      }
    }
  }


  const driverTabName = typeof driverTabRaw === 'string' && driverTabRaw.trim() ? driverTabRaw.trim() : null;

  const goToStage = (newStage) => setStage(newStage);

  const resetDashboard = () => {
    setSelectedAuto(null);
    setMatchStats({ totalPoints: 0, autoPoints: 0, teleopPoints: 0, endGamePoints: 0 });
    setMatchTime(null);
    goToStage('checklist');
  };

  const heldKeybindsRef = useRef(new Set());
  const runScheduleSyncRef = useRef(null);

  const persistTeamNumber = (value) => {
    window.localStorage.setItem(TEAM_NUMBER_STORAGE_KEY, String(value));
  };

  const persistBackgroundSyncEnabled = (value) => {
    window.localStorage.setItem(BACKGROUND_SYNC_ENABLED_STORAGE_KEY, value ? 'true' : 'false');
  };

  const persistBackgroundSyncMinutes = (value) => {
    window.localStorage.setItem(BACKGROUND_SYNC_MINUTES_STORAGE_KEY, String(value));
  };

  const normalizeTeamNumber = (value, fallback = 172) => {
    const parsed = Number.parseInt(String(value), 10);
    if (!Number.isFinite(parsed) || parsed <= 0) return fallback;
    return parsed;
  };

  const normalizeBackgroundSyncMinutes = (value, fallback = 2) => {
    const parsed = Number.parseInt(String(value), 10);
    if (!Number.isFinite(parsed) || parsed <= 0) return fallback;
    return Math.min(120, parsed);
  };

  const openSettings = () => {
    setTeamNumberDraft(String(teamNumber));
    setBackgroundSyncEnabledDraft(backgroundSyncEnabled);
    setBackgroundSyncMinutesDraft(String(backgroundSyncMinutes));
    setSettingsOpen(true);
  };

  const toggleSidebar = () => setSidebarOpen((open) => !open);

  const openMatchSchedule = () => {
    if (document.activeElement instanceof HTMLElement) {
      document.activeElement.blur();
    }
    const cachedSchedule = readStoredMatchSchedule();
    const latestSchedule = Array.isArray(matchSchedule) && matchSchedule.length > 0 ? [...matchSchedule] : cachedSchedule;
    setScheduleRows(latestSchedule);
    setScheduleNextMatch(nextMatch ?? null);
    setScheduleSyncProgress(normalizeSyncProgress(percentSyncComplete));
    setMatchScheduleOpen(true);
    setSidebarOpen(false);
  };

  const closeMatchSchedule = () => {
    if (scheduleSyncing) return;
    setMatchScheduleOpen(false);
  };

  const runScheduleSync = async (options = {}) => {
    if (scheduleSyncing) return;

    const source = options.source || 'manual';
    const isBackground = source === 'background';

    setScheduleError('');
    setScheduleSyncing(true);
    setBackgroundSyncActive(isBackground);
    setScheduleSyncProgress(0);

    const teamKey = window.localStorage.getItem(TEAM_NUMBER_STORAGE_KEY);

    const syncPoller = window.setInterval(() => {
      setScheduleSyncProgress(normalizeSyncProgress(percentSyncComplete));
      setScheduleRows(Array.isArray(matchSchedule) ? [...matchSchedule] : []);
      setScheduleNextMatch(nextMatch ?? null);
    }, 120);


    try {
      await sync(teamKey, setNextMatchEntryHandler, setNextMatchScheduleEntryHandler);

      const nextScheduleRows = Array.isArray(matchSchedule) ? [...matchSchedule] : [];
      setScheduleRows(nextScheduleRows);
      setScheduleNextMatch(nextMatch ?? null);
      setScheduleHasSuccessfulSync(nextScheduleRows.length > 0);
      persistMatchSchedule(nextScheduleRows);
      setScheduleSyncProgress(normalizeSyncProgress(percentSyncComplete));
    } catch (error) {
      setScheduleError(error?.message || 'Failed to sync match schedule.');
      setScheduleNextMatch(nextMatch ?? null);
    } finally {
      window.clearInterval(syncPoller);
      setScheduleSyncing(false);
      setBackgroundSyncActive(false);
      setScheduleNextMatch(nextMatch ?? null);
      setScheduleSyncProgress(normalizeSyncProgress(percentSyncComplete));
    }
  };

  runScheduleSyncRef.current = runScheduleSync;

  const closeSettings = () => {
    const normalized = normalizeTeamNumber(teamNumberDraft, teamNumber);
    const normalizedBackgroundSyncMinutes = normalizeBackgroundSyncMinutes(backgroundSyncMinutesDraft, backgroundSyncMinutes);
    setTeamNumber(normalized);
    setTeamNumberDraft(String(normalized));
    setBackgroundSyncEnabled(backgroundSyncEnabledDraft);
    setBackgroundSyncMinutes(normalizedBackgroundSyncMinutes);
    setBackgroundSyncMinutesDraft(String(normalizedBackgroundSyncMinutes));
    persistTeamNumber(normalized);
    persistBackgroundSyncEnabled(backgroundSyncEnabledDraft);
    persistBackgroundSyncMinutes(normalizedBackgroundSyncMinutes);
    setSettingsOpen(false);
  };

  useEffect(() => {
    const flushSettings = () => {
      persistTeamNumber(normalizeTeamNumber(teamNumberDraft, teamNumber));
      persistBackgroundSyncEnabled(backgroundSyncEnabledDraft);
      persistBackgroundSyncMinutes(normalizeBackgroundSyncMinutes(backgroundSyncMinutesDraft, backgroundSyncMinutes));
    };

    const handleVisibilityChange = () => {
      if (document.hidden) flushSettings();
    };

    window.addEventListener('beforeunload', flushSettings);
    document.addEventListener('visibilitychange', handleVisibilityChange);
    return () => {
      window.removeEventListener('beforeunload', flushSettings);
      document.removeEventListener('visibilitychange', handleVisibilityChange);
    };
  }, [backgroundSyncEnabledDraft, backgroundSyncMinutes, backgroundSyncMinutesDraft, teamNumber, teamNumberDraft]);

  useEffect(() => {
    persistMatchSchedule(scheduleRows);
  }, [scheduleRows]);

  useEffect(() => {
    const matchKey = typeof scheduleNextMatch?.key === 'string' ? scheduleNextMatch.key : '';
    if (!scheduleHasSuccessfulSync || !matchKey || matchPreviewView !== 'brief') {
      setPreMatchBrief('');
      setPreMatchBriefLoading(false);
      return undefined;
    }

    let cancelled = false;
    setPreMatchBrief('');
    setPreMatchBriefLoading(true);

    generatePreMatchBrief(matchKey, teamNumber)
      .then((brief) => {
        if (!cancelled) setPreMatchBrief(brief);
      })
      .catch((error) => {
        // A schedule can come from the TBA fallback without Statbotics detail data.
        console.warn('Unable to generate pre-match brief', error);
        if (!cancelled) setPreMatchBrief('');
      })
      .finally(() => {
        if (!cancelled) setPreMatchBriefLoading(false);
      });

    return () => {
      cancelled = true;
    };
  }, [scheduleHasSuccessfulSync, scheduleNextMatch?.key, teamNumber, matchPreviewView]);

  useEffect(() => {
    if (!backgroundSyncEnabled) return;

    const intervalMs = normalizeBackgroundSyncMinutes(backgroundSyncMinutes, 2) * 60 * 1000;
    const intervalId = window.setInterval(() => {
      runScheduleSyncRef.current?.({ source: 'background' });
    }, intervalMs);

    return () => {
      window.clearInterval(intervalId);
    };
  }, [backgroundSyncEnabled, backgroundSyncMinutes]);

  useEffect(() => {
    const ticker = window.setInterval(() => {
      setCurrentEpochMs(Date.now());
    }, 1000);

    return () => {
      window.clearInterval(ticker);
    };
  }, []);

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
        const syntheticEvent = { key, preventDefault: () => { } };
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

  const predictedWins = scheduleRows.filter((match) => {
    const probability = getMatchWinProbability(match, teamNumber);
    return typeof probability === 'number' && probability >= 0.5;
  }).length;
  const predictedLosses = scheduleRows.filter((match) => {
    const probability = getMatchWinProbability(match, teamNumber);
    return typeof probability === 'number' && probability < 0.5;
  }).length;
  const nowEpochSeconds = currentEpochMs / 1000;
  const nextMatchNumber = Number.parseInt(String(scheduleNextMatch?.match_number ?? ''), 10);
  const nextMatchKey = typeof scheduleNextMatch?.key === 'string' ? scheduleNextMatch.key : null;
  const nextMatchIndex = nextMatchKey ? scheduleRows.findIndex((row) => row?.key === nextMatchKey) : -1;
  const nextUpcomingMatch = scheduleRows.reduce((candidate, match) => {
    const predictedTime = Number(match?.predicted_time);
    if (!Number.isFinite(predictedTime) || predictedTime <= nowEpochSeconds) {
      return candidate;
    }

    if (!candidate || predictedTime < Number(candidate.predicted_time)) {
      return match;
    }

    return candidate;
  }, null);
  const secondsUntilNextMatch = nextUpcomingMatch
    ? Math.max(0, Number(nextUpcomingMatch.predicted_time) - nowEpochSeconds)
    : null;
  const showMatchPreview = scheduleHasSuccessfulSync
    && scheduleRows.length > 0
    && typeof scheduleNextMatch?.key === 'string';

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
            <label className="settings-modal-toggle" htmlFor="background-sync-toggle">
              <input
                id="background-sync-toggle"
                type="checkbox"
                checked={backgroundSyncEnabledDraft}
                onChange={(event) => setBackgroundSyncEnabledDraft(event.target.checked)}
              />
              <span>Enable background schedule refresh</span>
            </label>
            <label className="settings-modal-label" htmlFor="background-sync-minutes-input">Minutes Between Refreshes</label>
            <input
              id="background-sync-minutes-input"
              className="settings-modal-input"
              type="number"
              min="1"
              max="120"
              step="1"
              value={backgroundSyncMinutesDraft}
              onChange={(event) => setBackgroundSyncMinutesDraft(event.target.value)}
              disabled={!backgroundSyncEnabledDraft}
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
                <div className="schedule-sync-group">
                  <button
                    type="button"
                    className="schedule-sync-main-btn"
                    title="Refresh match schedule"
                    aria-label="Refresh match schedule"
                    onClick={() => runScheduleSync()}
                    disabled={scheduleSyncing}
                  >
                    <IconRefreshCw size={15} />
                    <span>Sync</span>
                  </button>
                </div>
                <button type="button" className="schedule-close-btn" onClick={closeMatchSchedule} disabled={scheduleSyncing}>
                  &times;
                </button>
              </div>
            </div>

            <p className="schedule-sync-status">
              {scheduleSyncing
                ? backgroundSyncActive
                  ? `Background refresh ${Math.round(scheduleSyncProgress)}%`
                  : `Syncing ${Math.round(scheduleSyncProgress)}%`
                : backgroundSyncEnabled
                  ? `Background refresh every ${backgroundSyncMinutes} min`
                  : `Background refresh off`}
            </p>
            <div className="schedule-sync-progress-track" role="progressbar" aria-valuemin={0} aria-valuemax={100} aria-valuenow={Math.round(scheduleSyncProgress)}>
              <div className="schedule-sync-progress-fill" style={{ width: `${scheduleSyncProgress}%` }} />
            </div>

            {scheduleError && <p className="schedule-sync-error">{scheduleError}</p>}

            <div className="schedule-list">
              {scheduleRows.length === 0 ? (
                <div className="schedule-empty">No matches loaded yet. Press sync.</div>
              ) : (
                scheduleRows.map((match, matchIndex) => {
                  const redTeams = parseTeamNumbers(match?.alliances?.red?.team_keys);
                  const blueTeams = parseTeamNumbers(match?.alliances?.blue?.team_keys);
                  const matchWinProbability = getMatchWinProbability(match, teamNumber);
                  const currentMatchNumber = Number.parseInt(String(match?.match_number ?? ''), 10);
                  const predictedTime = Number(match?.predicted_time);
                  const matchOccurred = Number.isFinite(predictedTime)
                    ? predictedTime <= nowEpochSeconds
                    : scheduleNextMatch == null
                      ? true
                      : Number.isFinite(nextMatchNumber) && Number.isFinite(currentMatchNumber)
                        ? currentMatchNumber < nextMatchNumber
                        : nextMatchIndex >= 0
                          ? matchIndex < nextMatchIndex
                          : false;

                  return (
                    <div key={match.key} className="schedule-item">
                      <div className="schedule-item-top">
                        <div className="schedule-item-match-wrap">
                          <span className="schedule-item-match">Match {match.match_number}</span>
                          {matchOccurred && <span className="schedule-item-status occurred">Occurred</span>}
                        </div>
                        <span
                          className={`schedule-item-prediction ${typeof matchWinProbability === 'number' && matchWinProbability < 0.5 ? 'loss' : 'win'}`}
                        >
                          {typeof matchWinProbability === 'number' ? `${(matchWinProbability * 100).toFixed(1)}%` : '--'}
                        </span>
                      </div>
                      <span className="schedule-item-time">{formatPredictedDayTime(match?.predicted_time ?? match?.time)}</span>
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
      {backgroundSyncActive && (
        <div className="background-sync-indicator" role="status" aria-live="polite">
          <IconRefreshCw size={14} />
          <span>Refreshing schedule {Math.round(scheduleSyncProgress)}%</span>
        </div>
      )}
      {scheduleRows.length > 0 && (
        <div className="next-match-countdown" role="status" aria-live="polite">
          {nextUpcomingMatch ? (
            <>
              <span className="next-match-countdown-label">Match {nextUpcomingMatch.match_number} starts in</span>
              <span className="next-match-countdown-value">{formatCountdown(secondsUntilNextMatch)}</span>
            </>
          ) : (
            <>
              <span className="next-match-countdown-label">Match schedule</span>
              <span className="next-match-countdown-value">No upcoming matches</span>
            </>
          )}
        </div>
      )}
      {activeTab === 'Match' && showMatchPreview && (
        <MatchPreviewMenu
          match={scheduleNextMatch}
          view={matchPreviewView}
          onViewChange={setMatchPreviewView}
          brief={preMatchBrief}
          briefLoading={preMatchBriefLoading}
          formatTime={formatPredictedDayTime}
        />
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
