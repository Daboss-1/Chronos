/**
 * ntTabData.js
 * Pure NT topic parser shared by NTTabView (panel mode) and NTTabWidgetGrid (full mode).
 */

export const NFR_ROOT     = '/ChronosDashboard';
export const SYS_ROOT     = '/ChronosDashboard/systems';
export const KEYBINDS_TAB = 'Keybinds';

export function getTopicKeys(data) {
  if (!data) return [];
  if (data instanceof Map) return Array.from(data.keys());
  if (typeof data === 'object') return Object.keys(data);
  return [];
}

export function getTopicValue(data, topic) {
  if (!data) return undefined;
  if (data instanceof Map) return data.get(topic);
  return data[topic];
}

function ensureSystem(systems, sysName) {
  if (!systems.has(sysName)) {
    systems.set(sysName, {
      name: sysName,
      commands:   new Map(),
      tunables:   new Map(),
      readValues: new Map(),
    });
  }
  return systems.get(sysName);
}

/**
 * Parse all NT topics that belong to `tabName` and return structured data.
 */
export function buildTabData(topics, values, tabName) {
  const commands      = new Map();
  const keybinds      = new Map();
  const tunables      = new Map();
  const readValues    = new Map();
  const cameras       = new Map();
  const systems       = new Map();
  const robotsByField = new Map();

  const allKeys = new Set([
    ...getTopicKeys(topics),
    ...getTopicKeys(values || {}),
  ]);

  const getValue = (k) => {
    if (!values) return undefined;
    if (values instanceof Map) return values.get(k);
    return values[k];
  };

  const esc = tabName.replace(/[.*+?^${}()|[\]\\]/g, '\\$&');

  const CMD_RE      = new RegExp(`^${NFR_ROOT}/commands/${esc}/([^/]+)/(running|requestId|lastHandledRequestId|tab)$`);
  const TUN_BOOL_RE = new RegExp(`^${NFR_ROOT}/tunableBooleans/${esc}/([^/]+)/(value|changed|tab)$`);
  const TUN_NUM_RE  = new RegExp(`^${NFR_ROOT}/tunableNumbers/${esc}/([^/]+)/(value|changed|tab)$`);
  const TUN_STR_RE  = new RegExp(`^${NFR_ROOT}/tunableStrings/${esc}/([^/]+)/(value|changed|tab)$`);
  const VAL_BOOL_RE = new RegExp(`^${NFR_ROOT}/booleans/${esc}/([^/]+)/value$`);
  const VAL_NUM_RE  = new RegExp(`^${NFR_ROOT}/numbers/${esc}/([^/]+)/value$`);
  const VAL_STR_RE  = new RegExp(`^${NFR_ROOT}/strings/${esc}/([^/]+)/value$`);
  const KEYBIND_RE  = new RegExp(`^${NFR_ROOT}/commands/${KEYBINDS_TAB}/([^/]+)/(description|running|pressed|tab)$`);
  const CAM_RE      = new RegExp(`^${NFR_ROOT}/cameraStreams/${esc}/([^/]+)/(url|tab|name)$`);
  const ROBOT_RE    = new RegExp(`^${NFR_ROOT}/robots/${esc}/([^/]+)/([^/]+)/(x|y|rotation)$`);

  const SYS_CMD_RE   = new RegExp(`^${SYS_ROOT}/([^/]+)/commands/${esc}/([^/]+)/(running|requestId|tab)$`);
  const SYS_TBOOL_RE = new RegExp(`^${SYS_ROOT}/([^/]+)/tunableBooleans/${esc}/([^/]+)/(value|changed|tab)$`);
  const SYS_TNUM_RE  = new RegExp(`^${SYS_ROOT}/([^/]+)/tunableNumbers/${esc}/([^/]+)/(value|changed|tab)$`);
  const SYS_TSTR_RE  = new RegExp(`^${SYS_ROOT}/([^/]+)/tunableStrings/${esc}/([^/]+)/(value|changed|tab)$`);
  const SYS_VBOOL_RE = new RegExp(`^${SYS_ROOT}/([^/]+)/booleans/${esc}/([^/]+)/value$`);
  const SYS_VNUM_RE  = new RegExp(`^${SYS_ROOT}/([^/]+)/numbers/${esc}/([^/]+)/value$`);
  const SYS_VSTR_RE  = new RegExp(`^${SYS_ROOT}/([^/]+)/strings/${esc}/([^/]+)/value$`);

  allKeys.forEach(topic => {
    let m;

    // Keybinds
    m = KEYBIND_RE.exec(topic);
    if (m) {
      const [, key, field] = m;
      const keybind = keybinds.get(key) || {
        id: key, key, name: key, tab: KEYBINDS_TAB, description: '',
        running: false, pressed: false,
        requestIdTopic: `${NFR_ROOT}/commands/${KEYBINDS_TAB}/${key}/requestId`,
        pressedTopic:   `${NFR_ROOT}/commands/${KEYBINDS_TAB}/${key}/pressed`,
      };
      const raw = getValue(topic);
      if (field === 'description') keybind.description = raw == null ? '' : String(raw);
      else if (field === 'running') keybind.running = Boolean(raw);
      else if (field === 'pressed') keybind.pressed = Boolean(raw);
      keybinds.set(key, keybind);
      return;
    }

    // Top-level commands
    m = CMD_RE.exec(topic);
    if (m) {
      const [, name, field] = m;
      const cmd = commands.get(name) || {
        id: name, name, running: false,
        requestIdTopic: `${NFR_ROOT}/commands/${tabName}/${name}/requestId`,
      };
      if (field === 'running') cmd.running = Boolean(getValue(topic));
      else {
        const v = getValue(`${NFR_ROOT}/commands/${tabName}/${name}/running`);
        if (v != null) cmd.running = Boolean(v);
      }
      commands.set(name, cmd);
      return;
    }

    // Top-level tunables
    for (const [re, type, section] of [
      [TUN_BOOL_RE, 'boolean', 'tunableBooleans'],
      [TUN_NUM_RE,  'number',  'tunableNumbers'],
      [TUN_STR_RE,  'string',  'tunableStrings'],
    ]) {
      m = re.exec(topic);
      if (m) {
        const [, name, field] = m;
        const id   = `${type}:${name}`;
        const base = `${NFR_ROOT}/${section}/${tabName}/${name}`;
        const t = tunables.get(id) || {
          id, name, type,
          valueTopic:   `${base}/value`,
          changedTopic: `${base}/changed`,
          value:   type === 'boolean' ? false : type === 'number' ? 0 : '',
          changed: false,
        };
        const raw = getValue(topic);
        if (field === 'value') {
          if (type === 'boolean') t.value = Boolean(raw);
          else if (type === 'number') t.value = typeof raw === 'number' ? raw : Number(raw ?? 0);
          else t.value = raw == null ? '' : String(raw);
        }
        if (field === 'changed') t.changed = Boolean(raw);
        tunables.set(id, t);
        return;
      }
    }

    // Top-level read-only values
    for (const [re, type] of [
      [VAL_BOOL_RE, 'boolean'],
      [VAL_NUM_RE,  'number'],
      [VAL_STR_RE,  'string'],
    ]) {
      m = re.exec(topic);
      if (m) {
        const [, name] = m;
        const raw = getValue(topic);
        const value = type === 'boolean' ? Boolean(raw)
          : type === 'number' ? (typeof raw === 'number' ? raw : Number(raw ?? 0))
          : (raw == null ? '' : String(raw));
        readValues.set(`${type}:${name}`, { id: `${type}:${name}`, name, type, value, ntPath: topic });
        return;
      }
    }

    // Cameras
    m = CAM_RE.exec(topic);
    if (m) {
      const [, name, field] = m;
      const cam = cameras.get(name) || { id: name, name, url: '' };
      if (field === 'url') { const raw = getValue(topic); cam.url = raw == null ? '' : String(raw); }
      cameras.set(name, cam);
      return;
    }

    // Robots / fields
    m = ROBOT_RE.exec(topic);
    if (m) {
      const [, fieldName, robotName, field] = m;
      const fieldRobots = robotsByField.get(fieldName) || new Map();
      const robot = fieldRobots.get(robotName) || { x: 0, y: 0, rotation: 0 };
      const raw = getValue(topic);
      if (field === 'x')        robot.x        = typeof raw === 'number' ? raw : 0;
      if (field === 'y')        robot.y        = typeof raw === 'number' ? raw : 0;
      if (field === 'rotation') robot.rotation = typeof raw === 'number' ? raw : 0;
      fieldRobots.set(robotName, robot);
      robotsByField.set(fieldName, fieldRobots);
      return;
    }

    // System commands
    m = SYS_CMD_RE.exec(topic);
    if (m) {
      const [, sysName, name, field] = m;
      const sys = ensureSystem(systems, sysName);
      const cmd = sys.commands.get(name) || {
        id: `sys:${sysName}/${name}`, name, running: false,
        requestIdTopic: `${SYS_ROOT}/${sysName}/commands/${tabName}/${name}/requestId`,
      };
      if (field === 'running') cmd.running = Boolean(getValue(topic));
      sys.commands.set(name, cmd);
      return;
    }

    // System tunables
    for (const [re, type, section] of [
      [SYS_TBOOL_RE, 'boolean', 'tunableBooleans'],
      [SYS_TNUM_RE,  'number',  'tunableNumbers'],
      [SYS_TSTR_RE,  'string',  'tunableStrings'],
    ]) {
      m = re.exec(topic);
      if (m) {
        const [, sysName, name, field] = m;
        const sys  = ensureSystem(systems, sysName);
        const id   = `${type}:sys:${sysName}/${name}`;
        const base = `${SYS_ROOT}/${sysName}/${section}/${tabName}/${name}`;
        const t = sys.tunables.get(id) || {
          id, name, type,
          valueTopic:   `${base}/value`,
          changedTopic: `${base}/changed`,
          value:   type === 'boolean' ? false : type === 'number' ? 0 : '',
          changed: false,
        };
        const raw = getValue(topic);
        if (field === 'value') {
          if (type === 'boolean') t.value = Boolean(raw);
          else if (type === 'number') t.value = typeof raw === 'number' ? raw : Number(raw ?? 0);
          else t.value = raw == null ? '' : String(raw);
        }
        if (field === 'changed') t.changed = Boolean(raw);
        sys.tunables.set(id, t);
        return;
      }
    }

    // System read-only values
    for (const [re, type] of [
      [SYS_VBOOL_RE, 'boolean'],
      [SYS_VNUM_RE,  'number'],
      [SYS_VSTR_RE,  'string'],
    ]) {
      m = re.exec(topic);
      if (m) {
        const [, sysName, name] = m;
        const sys = ensureSystem(systems, sysName);
        const raw = getValue(topic);
        const id  = `${type}:sys:${sysName}/${name}`;
        const value = type === 'boolean' ? Boolean(raw)
          : type === 'number' ? (typeof raw === 'number' ? raw : Number(raw ?? 0))
          : (raw == null ? '' : String(raw));
        sys.readValues.set(id, { id, name, type, value, ntPath: topic });
        return;
      }
    }
  });

  const sortByName = (map) =>
    Array.from(map.values()).sort((a, b) => a.name.localeCompare(b.name));

  return {
    commands:   sortByName(commands),
    keybinds:   sortByName(keybinds),
    tunables:   sortByName(tunables),
    readValues: sortByName(readValues),
    cameras:    sortByName(cameras),
    robotsByField,
    systems: Array.from(systems.values())
      .map(s => ({
        name:       s.name,
        commands:   sortByName(s.commands),
        tunables:   sortByName(s.tunables),
        readValues: sortByName(s.readValues),
      }))
      .sort((a, b) => a.name.localeCompare(b.name)),
  };
}
