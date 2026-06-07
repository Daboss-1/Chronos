import { useCallback, useEffect, useMemo, useRef, useState } from 'react';
import { useNt4 } from '@frc-web-components/react/networktables';

const COMMAND_PREFIX = '/ChronosDashboard/commands/';
const TUNABLE_BOOLEAN_PREFIX = '/ChronosDashboard/tunableBooleans/';
const TUNABLE_NUMBER_PREFIX = '/ChronosDashboard/tunableNumbers/';
const TUNABLE_STRING_PREFIX = '/ChronosDashboard/tunableStrings/';
const VALUE_BOOLEAN_PREFIX = '/ChronosDashboard/booleans/';
const VALUE_NUMBER_PREFIX = '/ChronosDashboard/numbers/';
const VALUE_STRING_PREFIX = '/ChronosDashboard/strings/';
const SYSTEMS_PREFIX = '/ChronosDashboard/systems/';
const CAMERA_STREAM_PREFIX = '/ChronosDashboard/cameraStreams/';

function getTopicKeys(data) {
  if (!data) return [];
  if (Array.isArray(data)) return data;
  if (data instanceof Map) return Array.from(data.keys());
  if (typeof data === 'object') return Object.keys(data);
  return [];
}

// Backend path format: /<table>/<section>/<tab>/<name>/<field>
const COMMAND_FIELD_REGEX = /^\/ChronosDashboard\/commands\/([^/]+)\/([^/]+)(?:\/(running|requestId|lastHandledRequestId|requested|tab))?$/;
const TUNABLE_BOOLEAN_REGEX = /^\/ChronosDashboard\/tunableBooleans\/([^/]+)\/([^/]+)\/(value|changed|tab)$/;
const TUNABLE_NUMBER_REGEX = /^\/ChronosDashboard\/tunableNumbers\/([^/]+)\/([^/]+)\/(value|changed|tab)$/;
const TUNABLE_STRING_REGEX = /^\/ChronosDashboard\/tunableStrings\/([^/]+)\/([^/]+)\/(value|changed|tab)$/;
const VALUE_BOOLEAN_REGEX = /^\/ChronosDashboard\/booleans\/([^/]+)\/([^/]+)\/value$/;
const VALUE_NUMBER_REGEX = /^\/ChronosDashboard\/numbers\/([^/]+)\/([^/]+)\/value$/;
const VALUE_STRING_REGEX = /^\/ChronosDashboard\/strings\/([^/]+)\/([^/]+)\/value$/;
const SYSTEM_ROOT_REGEX = /^\/ChronosDashboard\/systems\/([^/]+)\/(.+)$/;
// Camera streams: /ChronosDashboard/cameraStreams/<tab>/<name>/<url|tab|name>
const CAMERA_STREAM_REGEX = /^\/ChronosDashboard\/cameraStreams\/([^/]+)\/([^/]+)\/(url|tab|name)$/;

function toCommandList(topics, values) {
  const commands = new Map();
  const keys = new Set([...getTopicKeys(topics), ...getTopicKeys(values || {})]);

  const getValue = (k) => {
    if (!values) return undefined;
    if (values instanceof Map) return values.get(k);
    return values[k];
  };

  keys.forEach((topic) => {
    const match = COMMAND_FIELD_REGEX.exec(topic);
    if (!match) return;

    const tab = match[1];
    const commandName = match[2];
    const field = match[3];
    const commandId = `${tab}/${commandName}`;
    const baseTopic = `${COMMAND_PREFIX}${tab}/${commandName}`;
    const runningTopic = `${baseTopic}/running`;

    const command = commands.get(commandId) || {
      id: commandId,
      name: commandName,
      tab,
      runningTopic,
      requestIdTopic: `${baseTopic}/requestId`,
      running: false
    };

    if (field === 'running') {
      command.running = Boolean(getValue(topic));
    } else if (field === 'requestId' || field === 'lastHandledRequestId' || field === 'requested' || field === 'tab') {
      // metadata fields, no action needed
    }

    const runningValue = getValue(runningTopic);
    if (typeof runningValue !== 'undefined') command.running = Boolean(runningValue);

    commands.set(commandId, command);
  });

  return Array.from(commands.values()).sort((a, b) => a.name.localeCompare(b.name));
}

function toTunableList(topics, values) {
  const tunables = new Map();
  const keys = new Set([...getTopicKeys(topics), ...getTopicKeys(values || {})]);

  const getValue = (k) => {
    if (!values) return undefined;
    if (values instanceof Map) return values.get(k);
    return values[k];
  };

  keys.forEach((topic) => {
    let match = TUNABLE_BOOLEAN_REGEX.exec(topic);
    let type = 'boolean';

    if (!match) {
      match = TUNABLE_NUMBER_REGEX.exec(topic);
      type = 'number';
    }
    if (!match) {
      match = TUNABLE_STRING_REGEX.exec(topic);
      type = 'string';
    }
    if (!match) return;

    const tab = match[1];
    const name = match[2];
    const field = match[3];

    const basePrefix =
      type === 'boolean'
        ? TUNABLE_BOOLEAN_PREFIX
        : type === 'number'
          ? TUNABLE_NUMBER_PREFIX
          : TUNABLE_STRING_PREFIX;

    const baseTopic = `${basePrefix}${tab}/${name}`;
    const valueTopic = `${baseTopic}/value`;
    const changedTopic = `${baseTopic}/changed`;
    const tunableId = `${type}:${tab}/${name}`;

    const existing = tunables.get(tunableId) || {
      id: tunableId,
      name,
      tab,
      type,
      valueTopic,
      changedTopic,
      value: type === 'boolean' ? false : type === 'number' ? 0 : '',
      changed: false
    };

    if (field === 'value') {
      const raw = getValue(topic);
      if (type === 'boolean') existing.value = Boolean(raw);
      else if (type === 'number') existing.value = typeof raw === 'number' ? raw : Number(raw ?? 0);
      else existing.value = raw == null ? '' : String(raw);
    } else if (field === 'changed') {
      existing.changed = Boolean(getValue(topic));
    }

    tunables.set(existing.id, existing);
  });

  return Array.from(tunables.values()).sort((a, b) => a.id.localeCompare(b.id));
}

function toValueList(topics, values) {
  const items = new Map();
  const keys = new Set([...getTopicKeys(topics), ...getTopicKeys(values || {})]);

  const getValue = (k) => {
    if (!values) return undefined;
    if (values instanceof Map) return values.get(k);
    return values[k];
  };

  keys.forEach((topic) => {
    let match = VALUE_BOOLEAN_REGEX.exec(topic);
    let type = 'boolean';

    if (!match) {
      match = VALUE_NUMBER_REGEX.exec(topic);
      type = 'number';
    }
    if (!match) {
      match = VALUE_STRING_REGEX.exec(topic);
      type = 'string';
    }
    if (!match) return;

    const tab = match[1];
    const name = match[2];
    const raw = getValue(topic);
    const itemId = `${type}:${tab}/${name}`;

    const value =
      type === 'boolean'
        ? Boolean(raw)
        : type === 'number'
          ? (typeof raw === 'number' ? raw : Number(raw ?? 0))
          : (raw == null ? '' : String(raw));

    items.set(itemId, { id: itemId, name, tab, type, value });
  });

  return Array.from(items.values()).sort((a, b) => a.name.localeCompare(b.name));
}

function parseSystemRelativeTopic(relativeTopic) {
  // Format: <category>/<tab>/<name>/<field>
  const parts = relativeTopic.split('/');
  if (parts.length < 3) return null;

  const category = parts[0];
  const tab = parts[1];
  const name = parts[2];
  const field = parts[3];

  return { category, tab, name, field };
}

function toSystemList(topics, values) {
  const systems = new Map();
  const keys = new Set([...getTopicKeys(topics), ...getTopicKeys(values || {})]);

  const getValue = (k) => {
    if (!values) return undefined;
    if (values instanceof Map) return values.get(k);
    return values[k];
  };

  const ensureSystem = (systemName) => {
    if (!systems.has(systemName)) {
      systems.set(systemName, {
        name: systemName,
        commands: new Map(),
        tunables: new Map(),
        values: new Map()
      });
    }
    return systems.get(systemName);
  };

  keys.forEach((topic) => {
    const rootMatch = SYSTEM_ROOT_REGEX.exec(topic);
    if (!rootMatch) return;

    const systemName = rootMatch[1];
    const relative = rootMatch[2];
    const parsed = parseSystemRelativeTopic(relative);
    if (!parsed) return;

    const { category, tab, name, field } = parsed;
    const raw = getValue(topic);
    const system = ensureSystem(systemName);

    if (category === 'commands') {
      const id = `${tab}/${name}`;
      const command = system.commands.get(id) || {
        id,
        name,
        tab,
        running: false,
        requestIdTopic: `${SYSTEMS_PREFIX}${systemName}/commands/${tab}/${name}/requestId`
      };

      if (field === 'running') command.running = Boolean(raw);

      system.commands.set(id, command);
      return;
    }

    const isTunableCategory = category === 'tunableBooleans' || category === 'tunableNumbers' || category === 'tunableStrings';
    if (isTunableCategory) {
      const type =
        category === 'tunableBooleans' ? 'boolean' :
        category === 'tunableNumbers' ? 'number' : 'string';

      const id = `${type}:${tab}/${name}`;
      const baseTopic = `${SYSTEMS_PREFIX}${systemName}/${category}/${tab}/${name}`;
      const tunable = system.tunables.get(id) || {
        id,
        name,
        tab,
        type,
        valueTopic: `${baseTopic}/value`,
        changedTopic: `${baseTopic}/changed`,
        value: type === 'boolean' ? false : type === 'number' ? 0 : '',
        changed: false
      };

      if (field === 'value') {
        if (type === 'boolean') tunable.value = Boolean(raw);
        else if (type === 'number') tunable.value = typeof raw === 'number' ? raw : Number(raw ?? 0);
        else tunable.value = raw == null ? '' : String(raw);
      }
      if (field === 'changed') tunable.changed = Boolean(raw);

      system.tunables.set(id, tunable);
      return;
    }

    const isValueCategory = category === 'booleans' || category === 'numbers' || category === 'strings';
    if (isValueCategory && field === 'value') {
      const type =
        category === 'booleans' ? 'boolean' :
        category === 'numbers' ? 'number' : 'string';

      const id = `${type}:${tab}/${name}`;
      const value =
        type === 'boolean' ? Boolean(raw) :
        type === 'number' ? (typeof raw === 'number' ? raw : Number(raw ?? 0)) :
        (raw == null ? '' : String(raw));

      system.values.set(id, { id, name, tab, type, value });
    }
  });

  return Array.from(systems.values())
    .map((system) => ({
      ...system,
      commands: Array.from(system.commands.values()).sort((a, b) => a.name.localeCompare(b.name)),
      tunables: Array.from(system.tunables.values()).sort((a, b) => a.name.localeCompare(b.name)),
      values: Array.from(system.values.values()).sort((a, b) => a.name.localeCompare(b.name))
    }))
    .sort((a, b) => a.name.localeCompare(b.name));
}

function toCameraStreamList(topics, values) {
  const streams = new Map();
  const keys = new Set([...getTopicKeys(topics), ...getTopicKeys(values || {})]);

  const getValue = (k) => {
    if (!values) return undefined;
    if (values instanceof Map) return values.get(k);
    return values[k];
  };

  keys.forEach((topic) => {
    const match = CAMERA_STREAM_REGEX.exec(topic);
    if (!match) return;

    const tab = match[1];
    const name = match[2];
    const field = match[3];
    const streamId = `${tab}/${name}`;

    const stream = streams.get(streamId) || { id: streamId, name, tab, url: '' };
    if (field === 'url') {
      const raw = getValue(topic);
      stream.url = raw == null ? '' : String(raw);
    }
    streams.set(streamId, stream);
  });

  return Array.from(streams.values()).sort((a, b) => a.name.localeCompare(b.name));
}

export default function DeveloperDashboard() {
  const { nt4Provider } = useNt4();
  const [commands, setCommands] = useState([]);
  const [tunables, setTunables] = useState([]);
  const [valuesList, setValuesList] = useState([]);
  const [tunableDrafts, setTunableDrafts] = useState({});
  const [focusedTunables, setFocusedTunables] = useState(() => new Set());
  const [submittedTunables, setSubmittedTunables] = useState({});
  const [systems, setSystems] = useState([]);
  const [expandedSystems, setExpandedSystems] = useState({});
  const [cameraStreams, setCameraStreams] = useState([]);
  const requestIdsRef = useRef(new Map());

  const syncCommands = useCallback(() => {
    if (!nt4Provider) return;
    const nextCommands = toCommandList(nt4Provider.topics, nt4Provider.topicValues || {});
    setCommands(nextCommands);
  }, [nt4Provider]);

  const syncTunables = useCallback(() => {
    if (!nt4Provider) return;
    const nextTunables = toTunableList(nt4Provider.topics, nt4Provider.topicValues || {});
    setTunables(nextTunables);
  }, [nt4Provider]);

  const syncValues = useCallback(() => {
    if (!nt4Provider) return;
    const nextValues = toValueList(nt4Provider.topics, nt4Provider.topicValues || {});
    setValuesList(nextValues);
  }, [nt4Provider]);

  const syncSystems = useCallback(() => {
    if (!nt4Provider) return;
    const nextSystems = toSystemList(nt4Provider.topics, nt4Provider.topicValues || {});
    setSystems(nextSystems);
  }, [nt4Provider]);

  const syncCameraStreams = useCallback(() => {
    if (!nt4Provider) return;
    const next = toCameraStreamList(nt4Provider.topics, nt4Provider.topicValues || {});
    setCameraStreams(next);
  }, [nt4Provider]);

  useEffect(() => {
    if (!nt4Provider) return;

    let subscriptionId;
    const client = nt4Provider.client;
    if (client && typeof client.subscribeAll === 'function') {
      subscriptionId = client.subscribeAll(
        [
          COMMAND_PREFIX,
          TUNABLE_BOOLEAN_PREFIX,
          TUNABLE_NUMBER_PREFIX,
          TUNABLE_STRING_PREFIX,
          VALUE_BOOLEAN_PREFIX,
          VALUE_NUMBER_PREFIX,
          VALUE_STRING_PREFIX,
          SYSTEMS_PREFIX,
          CAMERA_STREAM_PREFIX
        ],
        true
      );
    }

    syncCommands();
    syncTunables();
    syncValues();
    syncSystems();
    syncCameraStreams();

    const interval = setInterval(() => {
      syncCommands();
      syncTunables();
      syncValues();
      syncSystems();
      syncCameraStreams();
    }, 50);

    return () => {
      clearInterval(interval);
      if (typeof subscriptionId === 'number' && client && typeof client.unsubscribe === 'function') {
        client.unsubscribe(subscriptionId);
      }
    };
  }, [
    nt4Provider,
    syncCommands,
    syncTunables,
    syncValues,
    syncSystems,
    syncCameraStreams
  ]);

  const setDraftValue = (tunable, value) => {
    setTunableDrafts((prev) => ({ ...prev, [tunable.id]: value }));
  };

  const handleTunableFocus = (tunableId) => {
    setFocusedTunables((prev) => {
      const next = new Set(prev);
      next.add(tunableId);
      return next;
    });
  };

  const handleTunableBlur = (tunable) => {
    setFocusedTunables((prev) => {
      const next = new Set(prev);
      next.delete(tunable.id);
      return next;
    });
    commitTunableDraft(tunable);
  };

  const updateTunable = (tunable, nextValue) => {
    if (!nt4Provider || typeof nt4Provider.setValue !== 'function') return;
    if (tunable.type !== 'boolean' && tunable.changed && !String(tunable.id).startsWith('system:')) return;
    nt4Provider.setValue(tunable.valueTopic, nextValue);
    nt4Provider.setValue(tunable.changedTopic, true);
  };

  const commitTunableDraft = (tunable) => {
    if (tunable.changed && !String(tunable.id).startsWith('system:')) return;

    const draft = getDraftValue(tunable);

    if (tunable.type === 'number') {
      const trimmed = draft.trim();
      if (!trimmed.length) return;
      const parsed = Number(trimmed);
      if (!Number.isFinite(parsed)) return;
      setSubmittedTunables((prev) => ({ ...prev, [tunable.id]: parsed }));
      updateTunable(tunable, parsed);
      return;
    }

    if (tunable.type === 'string') {
      setSubmittedTunables((prev) => ({ ...prev, [tunable.id]: draft }));
      updateTunable(tunable, draft);
    }
  };

  const isConnected = useMemo(() => {
    if (!nt4Provider) return false;
    if (typeof nt4Provider.isConnected === 'function') {
      return nt4Provider.isConnected();
    }
    return Boolean(nt4Provider.connected);
  }, [nt4Provider]);

  const toggleCommand = (command) => {
    if (!nt4Provider || typeof nt4Provider.setValue !== 'function') return;

    const prev = requestIdsRef.current.get(command.id);
    const nextRequestId = typeof prev === 'number' ? prev + 1 : 0;
    requestIdsRef.current.set(command.id, nextRequestId);

    nt4Provider.setValue(command.requestIdTopic, nextRequestId);
  };

  const valuesEqual = (type, a, b) => {
    if (type === 'number') return Number(a) === Number(b);
    if (type === 'boolean') return Boolean(a) === Boolean(b);
    return String(a ?? '') === String(b ?? '');
  };

  useEffect(() => {
    setTunableDrafts((prevDrafts) => {
      let draftMutated = false;
      const nextDrafts = { ...prevDrafts };

      for (const tunable of tunables) {
        const hasDraft = Object.prototype.hasOwnProperty.call(nextDrafts, tunable.id);
        if (!hasDraft) continue;

        const isFocused = focusedTunables.has(tunable.id);
        const submitted = submittedTunables[tunable.id];
        const backendMatchesSubmitted =
          typeof submitted !== 'undefined' && valuesEqual(tunable.type, tunable.value, submitted);

        if (!isFocused && backendMatchesSubmitted) {
          delete nextDrafts[tunable.id];
          draftMutated = true;
        }
      }

      return draftMutated ? nextDrafts : prevDrafts;
    });

    setSubmittedTunables((prevSubmitted) => {
      let submittedMutated = false;
      const nextSubmitted = { ...prevSubmitted };

      for (const tunable of tunables) {
        const submitted = nextSubmitted[tunable.id];
        if (typeof submitted === 'undefined') continue;

        if (valuesEqual(tunable.type, tunable.value, submitted)) {
          delete nextSubmitted[tunable.id];
          submittedMutated = true;
        }
      }

      return submittedMutated ? nextSubmitted : prevSubmitted;
    });
  }, [tunables, focusedTunables, submittedTunables]);

  const getDraftValue = (tunable) => {
    if (Object.prototype.hasOwnProperty.call(tunableDrafts, tunable.id)) {
      return tunableDrafts[tunable.id];
    }

    if (Object.prototype.hasOwnProperty.call(submittedTunables, tunable.id)) {
      return String(submittedTunables[tunable.id]);
    }

    if (tunable.type === 'number') return String(Number.isFinite(tunable.value) ? tunable.value : 0);
    return String(tunable.value ?? '');
  };

  const getBooleanDisplayValue = (tunable) => {
    if (Object.prototype.hasOwnProperty.call(submittedTunables, tunable.id)) {
      return Boolean(submittedTunables[tunable.id]);
    }
    return Boolean(tunable.value);
  };

  const toggleBooleanTunable = (tunable) => {
    const next = !getBooleanDisplayValue(tunable);
    setSubmittedTunables((prev) => ({ ...prev, [tunable.id]: next }));
    updateTunable(tunable, next);
  };

  const tunableInputStyle = {
    width: '100%',
    padding: '10px 12px',
    borderRadius: 10,
    border: '1px solid rgba(255,255,255,0.2)',
    background: 'rgba(255,255,255,0.08)',
    color: 'inherit',
    outline: 'none',
    fontSize: 14,
    transition: 'border-color 120ms ease, box-shadow 120ms ease, background 120ms ease'
  };

  const toggleTrackStyle = (checked) => ({
    width: 46,
    height: 26,
    borderRadius: 999,
    border: '1px solid rgba(255,255,255,0.22)',
    background: checked ? 'linear-gradient(135deg, #34d399, #10b981)' : 'rgba(255,255,255,0.18)',
    position: 'relative',
    transition: 'all 140ms ease',
    boxShadow: checked ? '0 0 0 3px rgba(16,185,129,0.18)' : 'none'
  });

  const toggleKnobStyle = (checked) => ({
    position: 'absolute',
    top: 2,
    left: checked ? 22 : 2,
    width: 20,
    height: 20,
    borderRadius: '50%',
    background: '#fff',
    transition: 'left 140ms ease'
  });

  const toggleSystemExpanded = (name) => {
    setExpandedSystems((prev) => ({ ...prev, [name]: !prev[name] }));
  };

  return (
    <section className="stage-container developer-dashboard" aria-label="Developer command controls">
      <div className="developer-headline">
        <h2 className="stage-title">Developer Commands</h2>
        <span className={`developer-connection ${isConnected ? 'connected' : 'disconnected'}`}>
          {isConnected ? 'NT Connected' : 'NT Disconnected'}
        </span>
      </div>

      {commands.length === 0 ? (
        <div className="developer-empty">
          Waiting for commands under <strong>/ChronosDashboard/commands</strong>
        </div>
      ) : (
        <div className="developer-command-grid">
          {commands.map((command) => (
            <button
              key={command.id}
              type="button"
              className={`developer-command-btn ${command.running ? 'running' : ''}`}
              onClick={() => toggleCommand(command)}
              aria-pressed={command.running}
            >
              <span className="command-name">{command.name}</span>
              <span className="command-state">{command.running ? 'Running' : 'Stopped'}</span>
            </button>
          ))}
        </div>
      )}

      <div className="developer-headline" style={{ marginTop: 16 }}>
        <h2 className="stage-title">Tunables</h2>
      </div>

      {tunables.length === 0 ? (
        <div className="developer-empty">
          Waiting for tunables under <strong>/ChronosDashboard/tunableBooleans</strong>,{' '}
          <strong>/ChronosDashboard/tunableNumbers</strong>, and{' '}
          <strong>/ChronosDashboard/tunableStrings</strong>
        </div>
      ) : (
        <div className="developer-command-grid">
          {tunables.map((tunable) => (
            <div key={tunable.id} className="developer-command-btn" style={{ display: 'grid', gap: 8 }}>
              <span className="command-name">{tunable.name}</span>

              {tunable.type === 'boolean' ? (
                <button
                  type="button"
                  onClick={() => toggleBooleanTunable(tunable)}
                  aria-pressed={getBooleanDisplayValue(tunable)}
                  aria-label={`${tunable.name} toggle`}
                  style={{
                    display: 'flex',
                    alignItems: 'center',
                    gap: 10,
                    cursor: 'pointer',
                    userSelect: 'none',
                    background: 'transparent',
                    border: 'none',
                    padding: 0,
                    color: 'inherit',
                    textAlign: 'left'
                  }}
                >
                  <span style={toggleTrackStyle(getBooleanDisplayValue(tunable))}>
                    <span style={toggleKnobStyle(getBooleanDisplayValue(tunable))} />
                  </span>
                  <span className="command-state">
                    {getBooleanDisplayValue(tunable) ? 'True' : 'False'}
                    {tunable.changed ? ' (pending)' : ''}
                  </span>
                </button>
              ) : tunable.type === 'number' ? (
                <input
                  type="text"
                  inputMode="decimal"
                  value={getDraftValue(tunable)}
                  disabled={tunable.changed}
                  style={{
                    ...tunableInputStyle,
                    opacity: tunable.changed ? 0.7 : 1,
                    cursor: tunable.changed ? 'not-allowed' : 'text'
                  }}
                  onFocus={() => handleTunableFocus(tunable.id)}
                  onChange={(e) => setDraftValue(tunable, e.target.value)}
                  onBlur={() => handleTunableBlur(tunable)}
                  onKeyDown={(e) => {
                    if (e.key === 'Enter') {
                      e.preventDefault();
                      commitTunableDraft(tunable);
                      e.currentTarget.blur();
                    }
                  }}
                />
              ) : (
                <input
                  type="text"
                  value={getDraftValue(tunable)}
                  disabled={tunable.changed}
                  style={{
                    ...tunableInputStyle,
                    opacity: tunable.changed ? 0.7 : 1,
                    cursor: tunable.changed ? 'not-allowed' : 'text'
                  }}
                  onFocus={() => handleTunableFocus(tunable.id)}
                  onChange={(e) => setDraftValue(tunable, e.target.value)}
                  onBlur={() => handleTunableBlur(tunable)}
                  onKeyDown={(e) => {
                    if (e.key === 'Enter') {
                      e.preventDefault();
                      commitTunableDraft(tunable);
                      e.currentTarget.blur();
                    }
                  }}
                />
              )}
            </div>
          ))}
        </div>
      )}

      <div className="developer-headline" style={{ marginTop: 16 }}>
        <h2 className="stage-title">Values</h2>
      </div>

      {valuesList.length === 0 ? (
        <div className="developer-empty">
          Waiting for values under <strong>/ChronosDashboard/booleans</strong>,{' '}
          <strong>/ChronosDashboard/numbers</strong>, and <strong>/ChronosDashboard/strings</strong>
        </div>
      ) : (
        <div className="developer-command-grid">
          {valuesList.map((item) => (
            <div key={item.id} className="developer-command-btn" style={{ display: 'grid', gap: 6 }}>
              <span className="command-name">{item.name}</span>
              <span className="command-state">
                {item.type === 'boolean' ? (item.value ? 'True' : 'False') : String(item.value)}
              </span>
            </div>
          ))}
        </div>
      )}

      <div className="developer-headline" style={{ marginTop: 16 }}>
        <h2 className="stage-title">Systems</h2>
      </div>

      {systems.length === 0 ? (
        <div className="developer-empty">
          Waiting for systems under <strong>/ChronosDashboard/systems</strong>
        </div>
      ) : (
        <div style={{ display: 'grid', gap: 12 }}>
          {systems.map((system) => {
            const expanded = Boolean(expandedSystems[system.name]);
            return (
              <div key={system.name} className="developer-command-btn" style={{ display: 'grid', gap: 10 }}>
                <button
                  type="button"
                  className="btn btn-secondary"
                  onClick={() => toggleSystemExpanded(system.name)}
                  style={{ justifySelf: 'start' }}
                >
                  {expanded ? '▾' : '▸'} {system.name}
                </button>

                {expanded ? (
                  <div style={{ display: 'grid', gap: 12 }}>
                    {/* System Commands */}
                    {system.commands.length > 0 ? (
                      <div className="developer-command-grid">
                        {system.commands.map((command) => (
                          <button
                            key={`${system.name}:cmd:${command.id}`}
                            type="button"
                            className={`developer-command-btn ${command.running ? 'running' : ''}`}
                            onClick={() => {
                              const prev = requestIdsRef.current.get(`${system.name}:${command.id}`);
                              const nextRequestId = typeof prev === 'number' ? prev + 1 : 0;
                              requestIdsRef.current.set(`${system.name}:${command.id}`, nextRequestId);
                              nt4Provider?.setValue?.(command.requestIdTopic, nextRequestId);
                            }}
                            aria-pressed={command.running}
                          >
                            <span className="command-name">{command.name}</span>
                            <span className="command-state">{command.running ? 'Running' : 'Stopped'}</span>
                          </button>
                        ))}
                      </div>
                    ) : null}

                    {/* System Tunables */}
                    {system.tunables.length > 0 ? (
                      <div className="developer-command-grid">
                        {system.tunables.map((tunable) => {
                          const scopedId = `system:${system.name}:${tunable.id}`;
                          const scopedTunable = { ...tunable, id: scopedId };
                          return (
                            <div key={scopedId} className="developer-command-btn" style={{ display: 'grid', gap: 8 }}>
                              <span className="command-name">{tunable.name}</span>
                              {/* reuse same tunable UI behavior */}
                              {tunable.type === 'boolean' ? (
                                <button
                                  type="button"
                                  onClick={() => toggleBooleanTunable(scopedTunable)}
                                  aria-pressed={getBooleanDisplayValue(scopedTunable)}
                                  style={{
                                    display: 'flex',
                                    alignItems: 'center',
                                    gap: 10,
                                    cursor: 'pointer',
                                    userSelect: 'none',
                                    background: 'transparent',
                                    border: 'none',
                                    padding: 0,
                                    color: 'inherit',
                                    textAlign: 'left'
                                  }}
                                >
                                  <span style={toggleTrackStyle(getBooleanDisplayValue(scopedTunable))}>
                                    <span style={toggleKnobStyle(getBooleanDisplayValue(scopedTunable))} />
                                  </span>
                                  <span className="command-state">
                                    {getBooleanDisplayValue(scopedTunable) ? 'True' : 'False'}
                                    {tunable.changed ? ' (pending)' : ''}
                                  </span>
                                </button>
                              ) : tunable.type === 'number' ? (
                                <input
                                  type="text"
                                  inputMode="decimal"
                                  value={getDraftValue(scopedTunable)}
                                  disabled={false}
                                  style={{ ...tunableInputStyle, opacity: 1, cursor: 'text' }}
                                  onFocus={() => handleTunableFocus(scopedTunable.id)}
                                  onChange={(e) => setDraftValue(scopedTunable, e.target.value)}
                                  onBlur={() => handleTunableBlur(scopedTunable)}
                                  onKeyDown={(e) => {
                                    if (e.key === 'Enter') {
                                      e.preventDefault();
                                      commitTunableDraft(scopedTunable);
                                      e.currentTarget.blur();
                                    }
                                  }}
                                />
                              ) : (
                                <input
                                  type="text"
                                  value={getDraftValue(scopedTunable)}
                                  disabled={false}
                                  style={{ ...tunableInputStyle, opacity: 1, cursor: 'text' }}
                                  onFocus={() => handleTunableFocus(scopedTunable.id)}
                                  onChange={(e) => setDraftValue(scopedTunable, e.target.value)}
                                  onBlur={() => handleTunableBlur(scopedTunable)}
                                  onKeyDown={(e) => {
                                    if (e.key === 'Enter') {
                                      e.preventDefault();
                                      commitTunableDraft(scopedTunable);
                                      e.currentTarget.blur();
                                    }
                                  }}
                                />
                              )}
                            </div>
                          );
                        })}
                      </div>
                    ) : null}

                    {/* System Values */}
                    {system.values.length > 0 ? (
                      <div className="developer-command-grid">
                        {system.values.map((item) => (
                          <div key={`${system.name}:val:${item.id}`} className="developer-command-btn" style={{ display: 'grid', gap: 6 }}>
                            <span className="command-name">{item.name}</span>
                            <span className="command-state">
                              {item.type === 'boolean' ? (item.value ? 'True' : 'False') : String(item.value)}
                            </span>
                          </div>
                        ))}
                      </div>
                    ) : null}
                  </div>
                ) : null}
              </div>
            );
          })}
        </div>
      )}

      <div className="developer-headline" style={{ marginTop: 16 }}>
        <h2 className="stage-title">Camera Streams</h2>
      </div>

      {cameraStreams.length === 0 ? (
        <div className="developer-empty">
          Waiting for camera streams under <strong>/ChronosDashboard/cameraStreams</strong>
        </div>
      ) : (
        <div className="developer-command-grid">
          {cameraStreams.map((stream) => (
            <div key={stream.id} className="developer-command-btn" style={{ display: 'grid', gap: 8 }}>
              <span className="command-name">{stream.name}</span>

              {/* Live stream preview (works for MJPEG/http image streams) */}
              <img
                src={stream.url}
                alt={`${stream.name} live stream`}
                style={{
                  width: '100%',
                  maxHeight: 220,
                  objectFit: 'cover',
                  borderRadius: 10,
                  border: '1px solid rgba(255,255,255,0.18)',
                  background: 'rgba(0,0,0,0.25)'
                }}
                loading="lazy"
              />

              <a
                href={stream.url}
                target="_blank"
                rel="noreferrer"
                className="command-state"
                style={{ wordBreak: 'break-all' }}
              >
                {stream.url}
              </a>
            </div>
          ))}
        </div>
      )}
    </section>
  );
}
