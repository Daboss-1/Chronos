import { useEffect, useRef } from 'react';

/**
 * Plays match timer sound cues using the Web Audio API.
 * Cue points (seconds remaining in teleop):
 *   30s → endgame start tone (triple beep, low-high-high)
 *   10s → countdown warning (rapid triple beep)
 *    0s → match end tone (long low tone)
 *
 * @param {number} timeRemaining - current seconds remaining (counts down)
 */
export function useSoundCues(timeRemaining) {
  const audioCtxRef = useRef(null);
  const firedRef = useRef(new Set());

  // Reset fired cues when timeRemaining resets to a high value
  useEffect(() => {
    if (timeRemaining > 30) {
      firedRef.current.clear();
    }
  }, [timeRemaining]);

  useEffect(() => {
    const ctx = getAudioContext(audioCtxRef);

    if (timeRemaining === 30 && !firedRef.current.has(30)) {
      firedRef.current.add(30);
      playEndgameChime(ctx);
    } else if (timeRemaining === 10 && !firedRef.current.has(10)) {
      firedRef.current.add(10);
      playWarningBeep(ctx);
    } else if (timeRemaining === 0 && !firedRef.current.has(0)) {
      firedRef.current.add(0);
      playMatchEndTone(ctx);
    }
  }, [timeRemaining]);
}

// ── helpers ──────────────────────────────────────────────────────

function getAudioContext(ref) {
  if (!ref.current) {
    ref.current = new (window.AudioContext || window.webkitAudioContext)();
  }
  // Resume if suspended (browser autoplay policy)
  if (ref.current.state === 'suspended') {
    ref.current.resume();
  }
  return ref.current;
}

/** Plays a single tone. */
function playTone(ctx, freq, startTime, duration, gainPeak = 0.4, type = 'sine') {
  const osc  = ctx.createOscillator();
  const gain = ctx.createGain();

  osc.type      = type;
  osc.frequency.setValueAtTime(freq, startTime);

  gain.gain.setValueAtTime(0, startTime);
  gain.gain.linearRampToValueAtTime(gainPeak, startTime + 0.01);
  gain.gain.setValueAtTime(gainPeak, startTime + duration - 0.02);
  gain.gain.linearRampToValueAtTime(0, startTime + duration);

  osc.connect(gain);
  gain.connect(ctx.destination);

  osc.start(startTime);
  osc.stop(startTime + duration);
}

/** Endgame start: three rising tones (E4 → G4 → B4). */
function playEndgameChime(ctx) {
  const now = ctx.currentTime;
  playTone(ctx, 329.63, now + 0.00, 0.18, 0.35); // E4
  playTone(ctx, 392.00, now + 0.22, 0.18, 0.40); // G4
  playTone(ctx, 493.88, now + 0.44, 0.28, 0.45); // B4
}

/** 10-second warning: rapid triple beep at higher pitch. */
function playWarningBeep(ctx) {
  const now = ctx.currentTime;
  playTone(ctx, 880, now + 0.00, 0.08, 0.35, 'square');
  playTone(ctx, 880, now + 0.12, 0.08, 0.35, 'square');
  playTone(ctx, 880, now + 0.24, 0.08, 0.35, 'square');
}

/** Match end: descending long tone. */
function playMatchEndTone(ctx) {
  const now = ctx.currentTime;
  playTone(ctx, 440, now + 0.00, 0.15, 0.5);
  playTone(ctx, 330, now + 0.18, 0.15, 0.5);
  playTone(ctx, 220, now + 0.36, 0.50, 0.5);
}
