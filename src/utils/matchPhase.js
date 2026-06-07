export function computeMatchPhase(gameSpecificMessage, isRedAlliance, teleopTimeRemaining) {
  // Determine starting activity from game specific message
  // "R" → Red starts active first, "B" → Blue starts active first
  // The auto winner defers their first active window to Shift 2
  const startActive = (gameSpecificMessage === 'R' && isRedAlliance) ||
                      (gameSpecificMessage === 'B' && !isRedAlliance);

  let hubState, phaseName;

  // Match structure after auto (140s total):
  // 140-131: Transition Shift (10s) - both hubs active
  // 130-106: Shift 1 (25s) - one alliance active
  // 105-81:  Shift 2 (25s) - other alliance active
  // 80-56:   Shift 3 (25s) - swap
  // 55-31:   Shift 4 (25s) - swap
  // 30-0:    Endgame (30s) - both hubs active

  if (teleopTimeRemaining > 130) {
    // Transition Shift (first 10s after auto) - both hubs active
    hubState = 'active';
    phaseName = 'TRANSITION';
  } else if (teleopTimeRemaining > 105) {
    // Shift 1
    hubState = startActive ? 'inactive' : 'active';
    phaseName = 'SHIFT 1';
  } else if (teleopTimeRemaining > 80) {
    // Shift 2
    hubState = startActive ? 'active' : 'inactive';
    phaseName = 'SHIFT 2';
  } else if (teleopTimeRemaining > 55) {
    // Shift 3
    hubState = startActive ? 'inactive' : 'active';
    phaseName = 'SHIFT 3';
  } else if (teleopTimeRemaining > 30) {
    // Shift 4
    hubState = startActive ? 'active' : 'inactive';
    phaseName = 'SHIFT 4';
  } else {
    // Endgame (last 30s) - both hubs active
    hubState = 'active';
    phaseName = 'ENDGAME';
  }

  return { hubState, phaseName };
}
