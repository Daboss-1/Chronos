import { useEffect, useRef, useState } from 'react';
import { useNt4 } from '@frc-web-components/react/networktables';
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
import RewindBar from './components/RewindBar';
import { LogReplayProvider } from './contexts/LogReplayContext';
import LogReplayDashboard from './components/LogReplayDashboard';

const KEYBINDS_ROOT = '/ChronosDashboard/commands/Keybinds';
const DASHBOARD_LIGHT_TOPIC = '/ChronosDashboard/dashboardLight/color';
const HEX_COLOR_RE = /^#?[0-9a-fA-F]{6}([0-9a-fA-F]{2})?$/;

function normalizeKeybindName(key) {
  if (typeof key !== 'string') return '';
  return key === ' ' ? 'space' : key.toLowerCase();
}

function hasTopic(data, topic) {
  if (!data) return false;
  if (data instanceof Map) return data.has(topic);
  return Object.prototype.hasOwnProperty.call(data, topic);
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

  // Match recorder + AdvantageScope bridge
  const { startRecording, stopRecording, isRecording, currentLog, savedLogs } = useMatchRecorder();
  useAdvantageScope();

  const goToStage = (newStage) => setStage(newStage);

  const resetDashboard = () => {
    setSelectedAuto(null);
    setMatchStats({ totalPoints: 0, autoPoints: 0, teleopPoints: 0, endGamePoints: 0 });
    goToStage('checklist');
  };

  const heldKeybindsRef = useRef(new Set());

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

      // Prevent browser/Electron default only for keys the robot is listening on
      // (avoids blocking Cmd+C, Cmd+V, etc. for normal usage)
      const topic = getPressedTopic(key);
      if (hasTopic(nt4Provider.topics, topic) || hasTopic(nt4Provider.topicValues, topic)) {
        event.preventDefault();
      }

      if (heldKeybindsRef.current.has(key)) return;

      heldKeybindsRef.current.add(key);
      setHeldKeybindKeys(new Set(heldKeybindsRef.current));
      nt4Provider.setValue(topic, true);
    };

    const handleKeyUp = (event) => {
      const key = normalizeKeybindName(event.key);
      if (isIgnoredKey(key)) return;

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

  const lightStyle = dashboardLightColor
    ? {
        backgroundColor: dashboardLightColor,
        backgroundImage: 'none',
        transition: 'background-color 120ms linear',
      }
    : {
        transition: 'background-color 120ms linear',
      };

  function renderStage() {
    // Non-Match tabs use the full widget-grid viewer
    if (activeTab !== 'Match') {
      return <NTTabWidgetGrid tabName={activeTab} heldKeybindKeys={heldKeybindKeys} />;
    }

    switch (stage) {
      case 'checklist':
        return <Checklist goToStage={goToStage} />;
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
        return <Autonomous selectedAuto={selectedAuto} goToStage={goToStage} onEnter={startRecording} />;
      case 'teleop':
        return <Teleop goToStage={goToStage} setMatchStats={setMatchStats} stopRecording={stopRecording} />;
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
        robotAddress={robotAddress}
      />
      <main style={lightStyle}>{renderStage()}</main>
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
