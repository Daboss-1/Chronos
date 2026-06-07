import { useCallback, useEffect, useRef, useState, useMemo } from 'react';
import { useNt4 } from '@frc-web-components/react/networktables';
import { useRewind } from '../contexts/RewindContext';
import FieldMap from '../components/FieldMap';
import { buildTabData, NFR_ROOT, KEYBINDS_TAB } from '../utils/ntTabData';

function normalizeKeybindName(key) {
  if (typeof key !== 'string') return '';
  return key === ' ' ? 'space' : key.toLowerCase();
}

export default function NTTabView({ tabName, layout = 'full', heldKeybindKeys = new Set() }) {
  const { nt4Provider } = useNt4();
  const { scrubTime, getValueAt } = useRewind();
  const [data, setData] = useState({
    commands: [], keybinds: [], tunables: [], readValues: [], cameras: [], robotsByField: new Map(), systems: []
  });
  const [tunableDrafts, setTunableDrafts]       = useState({});
  const [submittedTunables, setSubmittedTunables] = useState({});
  const [focusedTunables, setFocusedTunables]   = useState(() => new Set());
  const [expandedSystems, setExpandedSystems]   = useState({});
  const requestIdsRef = useRef(new Map());

  // Memoize the historical data snapshot to prevent re-renders from live data
  const historicalTopicValues = useMemo(() => {
    if (scrubTime == null || !nt4Provider) return null;
    return Object.fromEntries(
      Array.from(nt4Provider.topics.keys()).map(topic => {
        const value = getValueAt(topic, scrubTime);
        return [topic, value];
      })
    );
  }, [scrubTime, nt4Provider, getValueAt]);

  const sync = useCallback(() => {
    if (!nt4Provider) return;
    const topicValues = scrubTime == null
      ? (nt4Provider.topicValues || {})
      : historicalTopicValues;
    
    if (topicValues) {
      setData(buildTabData(nt4Provider.topics, topicValues, tabName));
    }
  }, [nt4Provider, tabName, scrubTime, historicalTopicValues]);

  useEffect(() => {
    if (!nt4Provider) return;
    let subId;
    const client = nt4Provider.client;
    if (client?.subscribeAll) subId = client.subscribeAll([`${NFR_ROOT}/`], true);
    sync();
    const id = setInterval(sync, scrubTime == null ? 50 : 150); // Slower updates when rewinding
    return () => {
      clearInterval(id);
      if (typeof subId === 'number' && client?.unsubscribe) client.unsubscribe(subId);
    };
  }, [nt4Provider, sync, scrubTime]);

  const toggleCommand = (cmd) => {
    if (!nt4Provider?.setValue || scrubTime != null) return; // No commands in rewind
    const prev = requestIdsRef.current.get(cmd.id);
    const next = typeof prev === 'number' ? prev + 1 : 0;
    requestIdsRef.current.set(cmd.id, next);
    nt4Provider.setValue(cmd.requestIdTopic, next);
  };

  const updateTunable = (t, value) => {
    if (!nt4Provider?.setValue || scrubTime != null) return; // No tuning in rewind
    nt4Provider.setValue(t.valueTopic, value);
    nt4Provider.setValue(t.changedTopic, true);
  };

  const getDraft = (t) => {
    if (Object.prototype.hasOwnProperty.call(tunableDrafts, t.id)) return tunableDrafts[t.id];
    if (Object.prototype.hasOwnProperty.call(submittedTunables, t.id)) return String(submittedTunables[t.id]);
    if (t.type === 'number') return String(Number.isFinite(t.value) ? t.value : 0);
    return String(t.value ?? '');
  };

  const getBooleanValue = (t) => {
    if (Object.prototype.hasOwnProperty.call(submittedTunables, t.id)) {
      return Boolean(submittedTunables[t.id]);
    }
    return Boolean(t.value);
  };

  const toggleBoolean = (t) => {
    const next = !getBooleanValue(t);
    setSubmittedTunables(p => ({ ...p, [t.id]: next }));
    updateTunable(t, next);
  };

  const commitDraft = (t) => {
    if (t.type === 'number') {
      const trimmed = getDraft(t).trim();
      if (!trimmed) return;
      const parsed = Number(trimmed);
      if (!Number.isFinite(parsed)) return;
      setSubmittedTunables(p => ({ ...p, [t.id]: parsed }));
      updateTunable(t, parsed);
    } else if (t.type === 'string') {
      const draft = getDraft(t);
      setSubmittedTunables(p => ({ ...p, [t.id]: draft }));
      updateTunable(t, draft);
    }
  };

  const toggleSystem = (name) =>
    setExpandedSystems(p => ({ ...p, [name]: !p[name] }));

  // Styles
  const trackStyle = (on) => ({
    display: 'inline-flex', alignItems: 'center',
    width: 46, height: 26, borderRadius: 999,
    border: '1px solid rgba(255,255,255,0.22)',
    background: on ? 'linear-gradient(135deg,#34d399,#10b981)' : 'rgba(255,255,255,0.18)',
    position: 'relative', transition: 'all 140ms', cursor: 'pointer',
    boxShadow: on ? '0 0 0 3px rgba(16,185,129,0.18)' : 'none',
    flexShrink: 0,
  });
  const knobStyle = (on) => ({
    position: 'absolute', top: 2, left: on ? 22 : 2,
    width: 20, height: 20, borderRadius: '50%',
    background: '#fff', transition: 'left 140ms',
  });
  const inputStyle = {
    width: '100%', padding: '8px 10px', borderRadius: 8,
    border: '1px solid rgba(255,255,255,0.2)',
    background: 'rgba(255,255,255,0.08)',
    color: 'inherit', outline: 'none', fontSize: 13,
  };

  // ---- Reusable renderers ----

  const renderTunable = (t) => (
    <div key={t.id} className="developer-command-btn" style={{ display: 'grid', gap: 8 }}>
      <span className="command-name">{t.name}</span>
      {t.type === 'boolean' ? (
        <button
          type="button"
          onClick={() => toggleBoolean(t)}
          aria-pressed={getBooleanValue(t)}
          aria-label={`${t.name} toggle`}
          style={{ display: 'flex', alignItems: 'center', gap: 10, cursor: 'pointer', userSelect: 'none', background: 'transparent', border: 'none', padding: 0, color: 'inherit', textAlign: 'left' }}
        >
          <span style={trackStyle(getBooleanValue(t))}><span style={knobStyle(getBooleanValue(t))} /></span>
          <span className="command-state">
            {getBooleanValue(t) ? 'True' : 'False'}{t.changed ? ' (pending)' : ''}
          </span>
        </button>
      ) : (
        <input
          type="text"
          inputMode={t.type === 'number' ? 'decimal' : undefined}
          value={getDraft(t)}
          disabled={t.changed}
          style={{ ...inputStyle, opacity: t.changed ? 0.7 : 1, cursor: t.changed ? 'not-allowed' : 'text' }}
          onFocus={() => setFocusedTunables(p => { const n = new Set(p); n.add(t.id); return n; })}
          onChange={e => setTunableDrafts(p => ({ ...p, [t.id]: e.target.value }))}
          onBlur={() => {
            setFocusedTunables(p => { const n = new Set(p); n.delete(t.id); return n; });
            commitDraft(t);
          }}
          onKeyDown={e => { if (e.key === 'Enter') { e.preventDefault(); commitDraft(t); e.currentTarget.blur(); } }}
        />
      )}
    </div>
  );

  const renderCommand = (cmd) => (
    <button
      key={cmd.id}
      type="button"
      className={`developer-command-btn ${cmd.running ? 'running' : ''}`}
      onClick={() => toggleCommand(cmd)}
      aria-pressed={cmd.running}
    >
      <span className="command-name">{cmd.name}</span>
      <span className="command-state">{cmd.running ? 'Running' : 'Stopped'}</span>
    </button>
  );

  const renderKeybind = (keybind) => (
    <div
      key={keybind.id}
      className={`developer-command-btn ${(keybind.running || keybind.pressed || heldKeybindKeys.has(normalizeKeybindName(keybind.key))) ? 'running' : ''}`}
      style={{ display: 'grid', gap: 6 }}
    >
      <span className="command-name">{keybind.key}</span>
      <span className="command-state">{keybind.description || 'No description'}</span>
    </div>
  );

  const renderValue = (v) => (
    <div key={v.id} className="developer-command-btn" style={{ display: 'grid', gap: 6 }}>
      <span className="command-name">{v.name}</span>
      <span className="command-state">
        {v.type === 'boolean' ? (v.value ? 'True' : 'False') : String(v.value)}
      </span>
    </div>
  );

  // ---- Field robots (full layout only) ----
  const hasContent =
    data.commands.length > 0 || (tabName === KEYBINDS_TAB && data.keybinds.length > 0) || data.tunables.length > 0 || data.readValues.length > 0 ||
    data.cameras.length > 0 || data.systems.length > 0 || data.robotsByField.size > 0;

  if (!hasContent) {
    if (layout === 'panel') return null;
    const emptyMessage = tabName === KEYBINDS_TAB
      ? 'Waiting for keybind entries under /ChronosDashboard/commands/Keybinds'
      : `No NT data for tab ${tabName} yet`;
    return (
      <section className="stage-container developer-dashboard">
        <div className="developer-empty">
          {emptyMessage}
        </div>
      </section>
    );
  }

  const body = (
    <>
      {/* Fields — only in full layout, all fields with labeled robots */}
      {layout === 'full' && data.robotsByField.size > 0 && (
        <div style={{ marginBottom: 16 }}>
          {Array.from(data.robotsByField.entries()).map(([fieldName, robotMap]) => {
            const robots = Array.from(robotMap.entries()).map(([name, r]) => ({
              name,
              x: r.x,
              y: r.y,
              heading: r.rotation,
            }));
            return (
              <div key={fieldName} style={{ marginBottom: 12, maxWidth: 520 }}>
                <div style={{ fontSize: 11, fontWeight: 600, letterSpacing: '0.06em', textTransform: 'uppercase', color: 'rgba(255,255,255,0.45)', marginBottom: 4 }}>
                  {fieldName}
                </div>
                <FieldMap robots={robots} paths={[]} width={520} />
              </div>
            );
          })}
        </div>
      )}

      {tabName === KEYBINDS_TAB && data.keybinds.length > 0 && (
        <>
          <h3 className="stage-title" style={{ marginBottom: 8 }}>Keybinds</h3>
          <div className="developer-command-grid">
            {data.keybinds.map(renderKeybind)}
          </div>
        </>
      )}

      {/* Top-level commands */}
      {data.commands.length > 0 && (
        <>
          <h3 className="stage-title" style={{ marginBottom: 8 }}>Commands</h3>
          <div className="developer-command-grid">
            {data.commands.map(renderCommand)}
          </div>
        </>
      )}

      {/* Top-level tunables */}
      {data.tunables.length > 0 && (
        <>
          <h3 className="stage-title" style={{ marginTop: 12, marginBottom: 8 }}>Tunables</h3>
          <div className="developer-command-grid">
            {data.tunables.map(renderTunable)}
          </div>
        </>
      )}

      {/* Top-level read-only values */}
      {data.readValues.length > 0 && (
        <>
          <h3 className="stage-title" style={{ marginTop: 12, marginBottom: 8 }}>Values</h3>
          <div className="developer-command-grid">
            {data.readValues.map(renderValue)}
          </div>
        </>
      )}

      {/* Systems — each as a collapsible dropdown */}
      {data.systems.length > 0 && (
        <>
          <h3 className="stage-title" style={{ marginTop: 12, marginBottom: 8 }}>Systems</h3>
          <div style={{ display: 'grid', gap: 8 }}>
            {data.systems.map(sys => {
              const expanded = Boolean(expandedSystems[sys.name]);
              return (
                <div key={sys.name} className="developer-command-btn" style={{ display: 'grid', gap: 10 }}>
                  <button
                    type="button"
                    className="btn btn-secondary"
                    onClick={() => toggleSystem(sys.name)}
                    style={{ justifySelf: 'start' }}
                  >
                    {expanded ? '▾' : '▸'} {sys.name}
                  </button>

                  {expanded && (
                    <div style={{ display: 'grid', gap: 10 }}>
                      {sys.commands.length > 0 && (
                        <div className="developer-command-grid">
                          {sys.commands.map(renderCommand)}
                        </div>
                      )}
                      {sys.tunables.length > 0 && (
                        <div className="developer-command-grid">
                          {sys.tunables.map(renderTunable)}
                        </div>
                      )}
                      {sys.readValues.length > 0 && (
                        <div className="developer-command-grid">
                          {sys.readValues.map(renderValue)}
                        </div>
                      )}
                    </div>
                  )}
                </div>
              );
            })}
          </div>
        </>
      )}

      {/* Camera streams */}
      {data.cameras.length > 0 && (
        <>
          <h3 className="stage-title" style={{ marginTop: 12, marginBottom: 8 }}>Cameras</h3>
          <div className="developer-command-grid">
            {data.cameras.map(cam => (
              <div key={cam.id} className="developer-command-btn" style={{ display: 'grid', gap: 8 }}>
                <span className="command-name">{cam.name}</span>
                <img
                  src={cam.url}
                  alt={`${cam.name} stream`}
                  style={{ width: '100%', maxHeight: 180, objectFit: 'cover', borderRadius: 8, border: '1px solid rgba(255,255,255,0.18)' }}
                  loading="lazy"
                />
              </div>
            ))}
          </div>
        </>
      )}
    </>
  );

  if (layout === 'panel') {
    return <div style={{ display: 'grid', gap: 8 }}>{body}</div>;
  }

  return (
    <section className="stage-container developer-dashboard" aria-label={`${tabName} tab`}>
      <div className="developer-headline">
        <h2 className="stage-title">{tabName}</h2>
      </div>
      {body}
    </section>
  );
}
