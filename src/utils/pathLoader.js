let autoMapCache = null;

function normalizeAutoReference(value) {
  if (value == null) return '';

  let normalized = String(value).trim().replace(/\\/g, '/');
  if (!normalized) return '';

  // If the value is an absolute filesystem path containing /autos/,
  // extract the relative "autos/<filename>" portion so the browser can
  // fetch it from the dashboard server (e.g. /autos/MyAuto.auto).
  const autosIdx = normalized.lastIndexOf('/autos/');
  if (autosIdx >= 0) {
    return normalized.slice(autosIdx + 1); // "autos/filename.auto"
  }

  // Otherwise strip any leading ./ or / characters
  return normalized.replace(/^[./]+/, '');
}

function normalizePathReference(value) {
  if (value == null) return '';

  let normalized = String(value).trim();
  if (!normalized) return '';

  normalized = normalized.replace(/^[./\\]+/, '');
  normalized = normalized.replace(/\\/g, '/');

  if (normalized.endsWith('.path')) {
    normalized = normalized.slice(0, -5);
  }

  const slashIndex = normalized.lastIndexOf('/');
  if (slashIndex >= 0) {
    normalized = normalized.slice(slashIndex + 1);
  }

  return normalized;
}

export async function loadAutoMap() {
  if (autoMapCache) return autoMapCache;
  try {
    const res = await fetch('./paths/automap.json');
    autoMapCache = await res.json();
    return autoMapCache;
  } catch {
    return {};
  }
}

export async function loadPath(name) {
  try {
    const normalizedPath = normalizePathReference(name);
    if (!normalizedPath) return null;

    const res = await fetch(`./paths/${normalizedPath}.path`);
    return await res.json();
  } catch {
    return null;
  }
}

function extractPathNames(command) {
  const names = [];
  if (!command) return names;

  if (command.type === 'path' && command.data?.pathName) {
    names.push(command.data.pathName);
  }

  const children = command.data?.commands;
  if (Array.isArray(children)) {
    for (const child of children) {
      names.push(...extractPathNames(child));
    }
  }

  return names;
}

export async function loadAutoDefinition(autoPath) {
  const normalizedPath = normalizeAutoReference(autoPath);
  if (!normalizedPath) return null;

  try {
    const res = await fetch(`./${normalizedPath}`);
    return await res.json();
  } catch {
    return null;
  }
}

export async function loadAutoPathsFromAutoPath(autoPath) {
  const autoDefinition = await loadAutoDefinition(autoPath);
  const pathNames = extractPathNames(autoDefinition?.command);
  if (!pathNames.length) return [];

  const paths = await Promise.all(pathNames.map(loadPath));
  return paths.filter(Boolean);
}

export async function loadAutoPaths(autoName) {
  const autoMap = await loadAutoMap();
  const pathNames = autoMap[autoName];
  if (!pathNames || pathNames.length === 0) return [];

  const paths = await Promise.all(pathNames.map(loadPath));
  return paths.filter(Boolean);
}

function interpolateRotationKeyframes(keyframes, t) {
  if (!keyframes || keyframes.length === 0) return null;
  if (t <= keyframes[0].t) return keyframes[0].deg;
  if (t >= keyframes[keyframes.length - 1].t) return keyframes[keyframes.length - 1].deg;

  for (let j = 0; j < keyframes.length - 1; j++) {
    const lo = keyframes[j];
    const hi = keyframes[j + 1];
    if (t >= lo.t && t <= hi.t) {
      const alpha = hi.t === lo.t ? 0 : (t - lo.t) / (hi.t - lo.t);
      // Shortest-path angular interpolation
      const diff = ((hi.deg - lo.deg + 540) % 360) - 180;
      return lo.deg + diff * alpha;
    }
  }
  return keyframes[keyframes.length - 1].deg;
}

/**
 * Accepts either a full PathPlanner path object or a raw waypoints array.
 * Returns an array of { x, y, rotation } points.
 * `rotation` is interpolated from idealStartingState, rotationTargets, and
 * goalEndState (degrees, CCW positive). It is null when no rotation data exists.
 */
export function computeBezierPoints(path, numSegments = 50) {
  const waypoints = Array.isArray(path) ? path : (path?.waypoints ?? []);
  if (!waypoints || waypoints.length < 2) return [];

  const rotationTargets = Array.isArray(path) ? [] : (path?.rotationTargets ?? []);
  const idealStartRotation = Array.isArray(path) ? undefined : path?.idealStartingState?.rotation;
  const goalEndRotation = Array.isArray(path) ? undefined : path?.goalEndState?.rotation;
  const totalT = waypoints.length - 1;

  // Build rotation keyframes sorted by path-parameter t (0 … numWaypoints-1)
  const keyframes = [];
  if (typeof idealStartRotation === 'number') keyframes.push({ t: 0, deg: idealStartRotation });
  for (const rt of rotationTargets) {
    if (typeof rt.waypointRelativePos === 'number' && typeof rt.rotationDegrees === 'number') {
      keyframes.push({ t: rt.waypointRelativePos, deg: rt.rotationDegrees });
    }
  }
  if (typeof goalEndRotation === 'number') keyframes.push({ t: totalT, deg: goalEndRotation });
  keyframes.sort((a, b) => a.t - b.t);

  const hasRotation = keyframes.length >= 2;
  const points = [];

  for (let i = 0; i < waypoints.length - 1; i++) {
    const p0 = waypoints[i].anchor;
    const p1 = waypoints[i].nextControl;
    const p2 = waypoints[i + 1].prevControl;
    const p3 = waypoints[i + 1].anchor;

    if (!p0 || !p3) continue;

    const cp1 = p1 || p0;
    const cp2 = p2 || p3;

    for (let s = 0; s <= numSegments; s++) {
      const subT = s / numSegments;
      const mt = 1 - subT;
      const x = mt * mt * mt * p0.x
        + 3 * mt * mt * subT * cp1.x
        + 3 * mt * subT * subT * cp2.x
        + subT * subT * subT * p3.x;
      const y = mt * mt * mt * p0.y
        + 3 * mt * mt * subT * cp1.y
        + 3 * mt * subT * subT * cp2.y
        + subT * subT * subT * p3.y;

      const globalT = i + subT;
      const rotation = hasRotation ? interpolateRotationKeyframes(keyframes, globalT) : null;

      points.push({ x, y, rotation });
    }
  }

  return points;
}

/**
 * Estimates the travel time for a single PathPlanner path segment using a
 * trapezoidal velocity profile derived from the path's globalConstraints,
 * idealStartingState, and goalEndState.
 *
 * @param {object} path  Full PathPlanner path object
 * @param {Array}  points Output of computeBezierPoints — used for arc length
 * @returns {number} Estimated duration in milliseconds
 */
export function estimatePathDurationMs(path, points) {
  if (!points || points.length < 2) return 0;

  let arcLength = 0;
  for (let i = 1; i < points.length; i++) {
    const dx = points[i].x - points[i - 1].x;
    const dy = points[i].y - points[i - 1].y;
    arcLength += Math.sqrt(dx * dx + dy * dy);
  }
  if (arcLength === 0) return 0;

  const v0 = Math.max(0, path?.idealStartingState?.velocity ?? 0);
  const v1 = Math.max(0, path?.goalEndState?.velocity ?? 0);
  const vmax = Math.max(0.1, path?.globalConstraints?.maxVelocity ?? 4.0);
  const a = Math.max(0.1, path?.globalConstraints?.maxAcceleration ?? 4.0);

  const v0c = Math.min(v0, vmax);
  const v1c = Math.min(v1, vmax);

  const dAccel = (vmax * vmax - v0c * v0c) / (2 * a);
  const dDecel = (vmax * vmax - v1c * v1c) / (2 * a);

  let durationS;
  if (dAccel + dDecel <= arcLength) {
    // Full trapezoidal profile
    const tAccel = (vmax - v0c) / a;
    const tDecel = (vmax - v1c) / a;
    const tCruise = (arcLength - dAccel - dDecel) / vmax;
    durationS = tAccel + tDecel + tCruise;
  } else {
    // Triangle profile — find achievable peak velocity
    const vPeak = Math.min(vmax, Math.sqrt(Math.max(0, (2 * a * arcLength + v0c * v0c + v1c * v1c) / 2)));
    const tAccel = (vPeak - v0c) / a;
    const tDecel = (vPeak - v1c) / a;
    durationS = Math.max(0, tAccel + tDecel);
  }

  return durationS * 1000;
}
