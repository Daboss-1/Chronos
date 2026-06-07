/**
 * RewindBar
 *
 * Fixed bottom bar that shows a timeline scrubber over the ring buffer.
 *   – When live: scrubber sits at the far right, "● LIVE" badge pulsing.
 *   – When scrubbing: timestamp shown, "▶ Live" button to snap back.
 *   – Total recording duration shown on the left.
 *   – "0s" line marks "now"; negative labels = seconds in the past.
 */

import { useEffect, useState } from 'react';
import { useRewind } from '../contexts/RewindContext';
import { IconPlay, IconPause } from '../utils/icons';

const PlayIcon  = () => <IconPlay  size={12}/>;
const PauseIcon = () => <IconPause size={12}/>;

const LIVE_SNAP_SEC = 0.3;   // within this many seconds of "now" → snap live

function formatDuration(sec) {
  const m = Math.floor(sec / 60);
  const s = Math.floor(sec % 60);
  return `${m}:${String(s).padStart(2, '0')}`;
}

export default function RewindBar() {
  const { startTime, scrubTime, setScrubTime, bufferRef, isPlaying, setIsPlaying } = useRewind();
  const [nowMs, setNowMs] = useState(Date.now());

  // Tick to keep "now" current
  useEffect(() => {
    const id = setInterval(() => setNowMs(Date.now()), 250);
    return () => clearInterval(id);
  }, []);

  const totalSec   = Math.max(0, (nowMs - startTime) / 1000);
  const isLive     = scrubTime == null;
  const scrubSec   = isLive ? totalSec : (scrubTime - startTime) / 1000;
  const relSec     = isLive ? 0 : ((scrubTime - nowMs) / 1000); // always ≤ 0

  // Count topics in buffer
  const topicCount = bufferRef.current.size;

  const handleChange = (e) => {
    const val = parseFloat(e.target.value);
    if (val >= totalSec - LIVE_SNAP_SEC) {
      setScrubTime(null);
      setIsPlaying(false);
    } else {
      setScrubTime(startTime + val * 1000);
      setIsPlaying(false);
    }
  };

  const handlePlayPause = () => {
    if (isLive) return; // Can't play from live position
    setIsPlaying(p => !p);
  };

  return (
    <div className={`rewind-bar ${isLive ? 'rewind-live' : 'rewind-scrubbing'}`}>
      {/* Left: recording info */}
      <div className="rewind-left">
        <span className="rewind-rec-dot" />
        <span className="rewind-duration">{formatDuration(totalSec)}</span>
        {topicCount > 0 && (
          <span className="rewind-topic-count">{topicCount} topics</span>
        )}
      </div>

      {/* Center: scrubber */}
      <div className="rewind-center">
        <input
          type="range"
          className="rewind-scrubber"
          min={0}
          max={Math.max(totalSec, 0.001)}
          step={0.05}
          value={Math.min(scrubSec, totalSec)}
          onChange={handleChange}
          aria-label="Timeline scrubber"
        />
      </div>

      {/* Right: status + back-to-live */}
      <div className="rewind-right">
        {isLive ? (
          <span className="rewind-live-badge"><span className="rewind-live-dot" />LIVE</span>
        ) : (
          <>
            <button
              className={`btn btn-sm ${isPlaying ? 'btn-primary' : 'btn-ghost'}`}
              onClick={handlePlayPause}
              title={isPlaying ? 'Pause playback' : 'Play from current position'}
            >
              {isPlaying ? <><PauseIcon/> Pause</> : <><PlayIcon/> Play</>}
            </button>
            <span className="rewind-timestamp">{relSec.toFixed(1)}s</span>
            <button
              className="btn btn-sm btn-primary rewind-live-btn"
              onClick={() => {
                setScrubTime(null);
                setIsPlaying(false);
              }}
            >
              <PlayIcon/> Live
            </button>
          </>
        )}
      </div>
    </div>
  );
}
