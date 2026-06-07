/**
 * LogReplayBar
 *
 * Bottom transport bar for the log viewer. Mirrors the RewindBar layout but
 * drives LogReplayContext instead of the live ring buffer.
 */

import { useLogReplay } from '../contexts/LogReplayContext';
import { IconPlay, IconPause } from '../utils/icons';

const PlayIcon  = () => <IconPlay  size={12}/>;
const PauseIcon = () => <IconPause size={12}/>;

function fmt(ms) {
  const s = Math.floor(ms / 1000);
  return `${Math.floor(s / 60)}:${String(s % 60).padStart(2, '0')}`;
}

const SPEEDS = [0.25, 0.5, 1, 2, 4];

export default function LogReplayBar() {
  const {
    log, duration, displayPlayhead, playing, setPlaying,
    speed, setSpeed, scrubTo, onClose,
  } = useLogReplay();

  if (!log) return null;

  const pct = duration > 0 ? (displayPlayhead / duration) * 100 : 0;

  const togglePlay = () => {
    if (displayPlayhead >= duration) scrubTo(0);
    setPlaying(p => !p);
  };

  return (
    <div className="log-replay-bar">
      {/* Left: log info */}
      <div className="log-replay-left">
        <span className="log-replay-badge">LOG</span>
        <span className="log-replay-date">
          {new Date(log.startTimestamp).toLocaleDateString(undefined, { month: 'short', day: 'numeric', year: 'numeric' })}
        </span>
      </div>

      {/* Centre: scrubber */}
      <div className="log-replay-center">
        <span className="log-replay-time">{fmt(displayPlayhead)}</span>
        <input
          type="range"
          className="rewind-scrubber"
          min={0}
          max={Math.max(duration, 1)}
          step={50}
          value={displayPlayhead}
          onChange={e => scrubTo(Number(e.target.value))}
          aria-label="Log playhead"
        />
        <span className="log-replay-time log-replay-time--total">{fmt(duration)}</span>
      </div>

      {/* Right: controls */}
      <div className="log-replay-right">
        {/* Skip to start */}
        <button className="btn btn-sm btn-ghost log-replay-ctrl" onClick={() => scrubTo(0)} title="Skip to start">⏮</button>

        {/* Play / Pause */}
        <button
          className={`btn btn-sm log-replay-ctrl log-replay-play ${playing ? 'btn-primary' : 'btn-ghost'}`}
          onClick={togglePlay}
          title={playing ? 'Pause' : 'Play'}
        >
          {playing ? <PauseIcon/> : <PlayIcon/>}
        </button>

        {/* Skip to end */}
        <button className="btn btn-sm btn-ghost log-replay-ctrl" onClick={() => scrubTo(duration)} title="Skip to end">⏭</button>

        {/* Speed */}
        <select
          className="log-replay-speed"
          value={speed}
          onChange={e => setSpeed(Number(e.target.value))}
          title="Playback speed"
        >
          {SPEEDS.map(s => <option key={s} value={s}>{s}×</option>)}
        </select>

        {/* Exit */}
        <button className="btn btn-sm btn-ghost log-replay-ctrl log-replay-exit" onClick={onClose} title="Exit log view">
          ✕ Exit
        </button>
      </div>
    </div>
  );
}
