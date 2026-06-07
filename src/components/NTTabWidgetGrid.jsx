/**
 * NTTabWidgetGrid
 *
 * Grid-based (drag / resize / add / remove) viewer for dynamically-discovered
 * NT tabs (Driver, Developer, Dashboard, SysId, Keybinds, …).
 *
 * Each logical section of a tab (Commands, Tunables, Values, Cameras,
 * Systems, Field Maps, Keybinds) becomes its own resizable panel.
 * Layout is persisted per-tab in localStorage.
 */

import { useCallback, useEffect, useRef, useState, useMemo } from 'react';
import { ResponsiveGridLayout } from 'react-grid-layout';
import { useNt4 } from '@frc-web-components/react/networktables';
import { useRewind } from '../contexts/RewindContext';
import FieldMap from './FieldMap';
import GraphPanel from './GraphPanel';
import { buildTabData, NFR_ROOT, KEYBINDS_TAB } from '../utils/ntTabData';
import 'react-grid-layout/css/styles.css';
import 'react-resizable/css/styles.css';
import { IconReset, IconGrid } from '../utils/icons';

const ResetIcon = () => <IconReset size={14}/>;
const GridIcon  = () => <IconGrid  size={14}/>;

// ──────────────────────────────────────────────────────────────────────────────
// Section catalog — every possible panel a NT tab can have
// ──────────────────────────────────────────────────────────────────────────────
const NT_CATALOG = [
  { key: 'fields',   label: 'Field Maps',  defaultSize: { w: 8, h: 8  } },
  { key: 'commands', label: 'Commands',    defaultSize: { w: 6, h: 6  } },
  { key: 'keybinds', label: 'Keybinds',   defaultSize: { w: 12, h: 6 } },
  { key: 'tunables', label: 'Tunables',   defaultSize: { w: 6, h: 6  } },
  { key: 'values',   label: 'Values',     defaultSize: { w: 6, h: 4  } },
  { key: 'cameras',  label: 'Cameras',    defaultSize: { w: 6, h: 5  } },
  { key: 'systems',  label: 'Systems',    defaultSize: { w: 12, h: 6 } },
  { key: 'graph',    label: 'Graph',      defaultSize: { w: 12, h: 7 } },
];

// Default starting layout for a fresh NT tab
const NT_DEFAULT_LAYOUT = [
  { i: 'fields',   x: 0, y: 0,  w: 8, h: 8,  minW: 2, minH: 3 },
  { i: 'commands', x: 8, y: 0,  w: 4, h: 5,  minW: 2, minH: 2 },
  { i: 'tunables', x: 8, y: 5,  w: 4, h: 5,  minW: 2, minH: 2 },
  { i: 'values',   x: 0, y: 8,  w: 4, h: 4,  minW: 2, minH: 2 },
  { i: 'cameras',  x: 4, y: 8,  w: 4, h: 4,  minW: 2, minH: 2 },
  { i: 'systems',  x: 8, y: 10, w: 4, h: 4,  minW: 2, minH: 2 },
  { i: 'keybinds', x: 0, y: 12, w: 12, h: 4, minW: 2, minH: 2 },
];

// ── Persistence helpers ───────────────────────────────────────────────────────

function layoutKey(tabName) { return `nfr-layout-nt-${tabName}`; }

function loadLayout(tabName) {
  try {
    const raw = localStorage.getItem(layoutKey(tabName));
    if (raw) return JSON.parse(raw);
  } catch { /* ignore */ }
  return null;
}

function saveLayout(tabName, layout) {
  try { localStorage.setItem(layoutKey(tabName), JSON.stringify(layout)); }
  catch { /* ignore */ }
}

// ── Shared styles for tunables ────────────────────────────────────────────────

const trackStyle = (on) => ({
  display: 'inline-flex', alignItems: 'center',
  width: 46, height: 26, borderRadius: 999,
  border: '1px solid rgba(255,255,255,0.22)',
  background: on ? 'linear-gradient(135deg,#34d399,#10b981)' : 'rgba(255,255,255,0.18)',
  position: 'relative', transition: 'all 140ms', cursor: 'pointer',
  boxShadow: on ? '0 0 0 3px rgba(16,185,129,0.18)' : 'none', flexShrink: 0,
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

// ──────────────────────────────────────────────────────────────────────────────
export default function NTTabWidgetGrid({
  tabName,
  heldKeybindKeys = new Set(),
  overrideTopics = null,
  overrideTopicValues = null,
}) {
  // When both override props are provided the component is in log-replay mode:
  // it bypasses the live NT4 provider and the ring-buffer rewind entirely.
  const isLogMode = overrideTopics !== null && overrideTopicValues !== null;

  const { nt4Provider } = useNt4();
  const { scrubTime, getValueAt } = useRewind();

  // NT data
  const [data, setData] = useState({
    commands: [], keybinds: [], tunables: [], readValues: [],
    cameras: [], robotsByField: new Map(), systems: [],
  });

  // Tunable draft state
  const [tunableDrafts, setTunableDrafts]         = useState({});
  const [submittedTunables, setSubmittedTunables] = useState({});
  const requestIdsRef = useRef(new Map());
  const [expandedSystems, setExpandedSystems]     = useState({});

  // Layout + edit mode (per-tab)
  const [editMode, setEditMode] = useState(false);
  const [showAddMenu, setShowAddMenu] = useState(false);
  const [layout, setLayout] = useState(() => loadLayout(tabName) ?? NT_DEFAULT_LAYOUT);
  const [containerWidth, setContainerWidth] = useState(1200);
  const containerRef = useRef(null);

  // Re-initialize layout when tab changes
  useEffect(() => {
    setLayout(loadLayout(tabName) ?? NT_DEFAULT_LAYOUT);
    setEditMode(false);
    setShowAddMenu(false);
  }, [tabName]);

  // ResizeObserver for container width
  useEffect(() => {
    const el = containerRef.current;
    if (!el) return;
    const ro = new ResizeObserver(entries => {
      const w = entries[0]?.contentRect.width;
      if (w > 0) setContainerWidth(w);
    });
    ro.observe(el);
    setContainerWidth(el.getBoundingClientRect().width || 1200);
    return () => ro.disconnect();
  }, []);

  // ── Log-mode: compute data directly from override props (no NT subscription) ──
  // This memo re-runs every time the parent passes new overrideTopicValues (20 Hz).
  const logData = useMemo(() => {
    if (!isLogMode) return null;
    return buildTabData(overrideTopics, overrideTopicValues, tabName);
  }, [isLogMode, overrideTopics, overrideTopicValues, tabName]);

  // ── Live mode: ring-buffer rewind snapshot ────────────────────────────────
  const historicalTopicValues = useMemo(() => {
    if (isLogMode || scrubTime == null || !nt4Provider) return null;
    return Object.fromEntries(
      Object.keys(nt4Provider.topics).map(topic => {
        const value = getValueAt(topic, scrubTime);
        return [topic, value];
      })
    );
  }, [isLogMode, scrubTime, nt4Provider, getValueAt]);

  const sync = useCallback(() => {
    if (isLogMode || !nt4Provider) return;
    const topicValues = scrubTime == null
      ? (nt4Provider.topicValues || {})
      : historicalTopicValues;
    if (topicValues) {
      setData(buildTabData(nt4Provider.topics, topicValues, tabName));
    }
  }, [isLogMode, nt4Provider, tabName, scrubTime, historicalTopicValues]);

  useEffect(() => {
    if (isLogMode || !nt4Provider) return;
    let subId;
    const client = nt4Provider.client;
    if (client?.subscribeAll) subId = client.subscribeAll([`${NFR_ROOT}/`], true);
    sync();
    const id = setInterval(sync, scrubTime == null ? 50 : 150);
    return () => {
      clearInterval(id);
      if (typeof subId === 'number' && client?.unsubscribe) client.unsubscribe(subId);
    };
  }, [isLogMode, nt4Provider, sync, scrubTime]);

  // ── Layout handlers ────────────────────────────────────────────────────────

  const handleLayoutChange = useCallback((newLayout) => {
    setLayout(newLayout);
    saveLayout(tabName, newLayout);
  }, [tabName]);

  const addPanel = (key) => {
    const meta = NT_CATALOG.find(c => c.key === key);
    if (!meta) return;
    const bottomY = layout.reduce((max, item) => Math.max(max, item.y + item.h), 0);
    const newLayout = [...layout, {
      i: key, x: 0, y: bottomY,
      w: meta.defaultSize.w, h: meta.defaultSize.h,
      minW: 2, minH: 2,
    }];
    setLayout(newLayout);
    saveLayout(tabName, newLayout);
    setShowAddMenu(false);
  };

  const removePanel = (key) => {
    const newLayout = layout.filter(item => item.i !== key);
    setLayout(newLayout);
    saveLayout(tabName, newLayout);
  };

  const resetLayout = () => {
    setLayout(NT_DEFAULT_LAYOUT);
    saveLayout(tabName, NT_DEFAULT_LAYOUT);
  };

  // ── Tunable helpers ────────────────────────────────────────────────────────

  const toggleCommand = (cmd) => {
    if (!nt4Provider?.setValue || scrubTime != null || isLogMode) return;
    const prev = requestIdsRef.current.get(cmd.id);
    const next = typeof prev === 'number' ? prev + 1 : 0;
    requestIdsRef.current.set(cmd.id, next);
    nt4Provider.setValue(cmd.requestIdTopic, next);
  };

  const updateTunable = (t, value) => {
    if (!nt4Provider?.setValue || scrubTime != null || isLogMode) return;
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
    if (Object.prototype.hasOwnProperty.call(submittedTunables, t.id)) return Boolean(submittedTunables[t.id]);
    return Boolean(t.value);
  };

  const toggleBoolean = (t) => {
    const next = !getBooleanValue(t);
    setSubmittedTunables(p => ({ ...p, [t.id]: next }));
    updateTunable(t, next);
  };

  const commitDraft = (t) => {
    if (t.type === 'number') {
      const parsed = Number(getDraft(t).trim());
      if (!Number.isFinite(parsed)) return;
      setSubmittedTunables(p => ({ ...p, [t.id]: parsed }));
      updateTunable(t, parsed);
    } else if (t.type === 'string') {
      const draft = getDraft(t);
      setSubmittedTunables(p => ({ ...p, [t.id]: draft }));
      updateTunable(t, draft);
    }
  };

  // ── Section renderers ──────────────────────────────────────────────────────

  const renderCommand = (cmd) => (
    <button
      key={cmd.id} type="button"
      className={`developer-command-btn ${cmd.running ? 'running' : ''}`}
      onClick={() => toggleCommand(cmd)} aria-pressed={cmd.running}
      disabled={scrubTime != null}
    >
      <span className="command-name">{cmd.name}</span>
      <span className="command-state">{cmd.running ? 'Running' : 'Stopped'}</span>
    </button>
  );

  const renderKeybind = (kb) => (
    <div
      key={kb.id}
      className={`developer-command-btn ${(kb.running || kb.pressed || heldKeybindKeys.has(kb.key?.toLowerCase())) ? 'running' : ''}`}
      style={{ display: 'grid', gap: 6 }}
    >
      <span className="command-name">{kb.key}</span>
      <span className="command-state">{kb.description || 'No description'}</span>
    </div>
  );

  const renderTunable = (t) => (
    <div key={t.id} className="developer-command-btn" style={{ display: 'grid', gap: 8 }}>
      <span className="command-name">{t.name}</span>
      {t.type === 'boolean' ? (
        <button
          type="button" onClick={() => toggleBoolean(t)} aria-pressed={getBooleanValue(t)}
          style={{ display: 'flex', alignItems: 'center', gap: 10, cursor: 'pointer', background: 'transparent', border: 'none', padding: 0, color: 'inherit' }}
          disabled={scrubTime != null}
        >
          <span style={trackStyle(getBooleanValue(t))}><span style={knobStyle(getBooleanValue(t))} /></span>
          <span className="command-state">{getBooleanValue(t) ? 'True' : 'False'}{t.changed ? ' (pending)' : ''}</span>
        </button>
      ) : (
        <input
          type="text" inputMode={t.type === 'number' ? 'decimal' : undefined}
          value={getDraft(t)} disabled={t.changed || scrubTime != null}
          style={{ ...inputStyle, opacity: t.changed ? 0.7 : 1 }}
          onChange={e => setTunableDrafts(p => ({ ...p, [t.id]: e.target.value }))}
          onBlur={() => commitDraft(t)}
          onKeyDown={e => { if (e.key === 'Enter') { e.preventDefault(); commitDraft(t); e.currentTarget.blur(); } }}
        />
      )}
    </div>
  );

  const renderValue = (v, labelPrefix = '') => {
    const isDraggable = (v.type === 'number' || v.type === 'boolean') && v.ntPath;
    const dragLabel   = labelPrefix ? `${labelPrefix} / ${v.name}` : `${tabName} / ${v.name}`;
    const onDragStart = isDraggable ? (e) => {
      e.dataTransfer.effectAllowed = 'copy';
      e.dataTransfer.setData('application/x-nt-topic',
        JSON.stringify({ path: v.ntPath, label: dragLabel }));
      e.dataTransfer.setData('text/plain', v.ntPath);
      // Make the drag preview feel like the card itself.
      const ghost = e.currentTarget.cloneNode(true);
      ghost.style.position = 'absolute';
      ghost.style.top = '-10000px';
      ghost.style.left = '-10000px';
      ghost.style.width = `${e.currentTarget.offsetWidth}px`;
      ghost.style.pointerEvents = 'none';
      document.body.appendChild(ghost);
      e.dataTransfer.setDragImage(ghost, 12, 12);
      setTimeout(() => ghost.remove(), 0);
    } : undefined;

    return (
      <div
        key={v.id}
        className={`developer-command-btn ${isDraggable ? 'value-draggable' : ''}`}
        onMouseDownCapture={isDraggable ? (e) => e.stopPropagation() : undefined}
        style={{ display: 'grid', gap: 6 }}
        title={isDraggable ? 'Drag to a Graph panel to plot' : undefined}
      >
        {isDraggable && (
          <div
            className="value-drag-source"
            draggable={true}
            onDragStart={onDragStart}
            onMouseDown={(e) => e.stopPropagation()}
            aria-label={`Drag ${v.name} to graph`}
            title="Drag to a Graph panel"
          >
            <span className="value-drag-grip" aria-hidden>⠿</span>
            <span className="value-drag-text">Drag to graph</span>
          </div>
        )}
        <span className="command-name">{v.name}</span>
        <span className="command-state">{v.type === 'boolean' ? (v.value ? 'True' : 'False') : String(v.valueStr ?? v.value)}</span>
      </div>
    );
  };

  // ── Merge live and log data ─────────────────────────────────────────────────
  // In log mode `logData` drives rendering; in live mode `data` (state) drives it.
  const displayData = isLogMode ? (logData ?? data) : data;

  // ── Build widget map ───────────────────────────────────────────────────────

  const widgets = {
    fields: displayData.robotsByField.size > 0 ? (
      <div className="nt-widget-panel">
        {Array.from(displayData.robotsByField.entries()).map(([fieldName, robotMap]) => {
          const robots = Array.from(robotMap.entries()).map(([name, r]) => ({
            name, x: r.x, y: r.y, heading: r.rotation,
          }));
          return (
            <div key={fieldName} style={{ marginBottom: 12 }}>
              <div className="nt-widget-section-label">{fieldName}</div>
              <FieldMap robots={robots} paths={[]} width="100%" />
            </div>
          );
        })}
      </div>
    ) : (
      <div className="nt-widget-panel nt-widget-empty">No field data yet</div>
    ),

    commands: (
      <div className="nt-widget-panel">
        {displayData.commands.length > 0
          ? <div className="developer-command-grid">{displayData.commands.map(renderCommand)}</div>
          : <div className="nt-widget-empty">No commands yet</div>}
      </div>
    ),

    keybinds: (
      <div className="nt-widget-panel">
        {displayData.keybinds.length > 0
          ? <div className="developer-command-grid">{displayData.keybinds.map(renderKeybind)}</div>
          : <div className="nt-widget-empty">No keybinds yet</div>}
      </div>
    ),

    tunables: (
      <div className="nt-widget-panel">
        {displayData.tunables.length > 0
          ? <div className="developer-command-grid">{displayData.tunables.map(renderTunable)}</div>
          : <div className="nt-widget-empty">No tunables yet</div>}
      </div>
    ),

    values: (
      <div className="nt-widget-panel">
        {displayData.readValues.length > 0
          ? <div className="developer-command-grid">{displayData.readValues.map(renderValue)}</div>
          : <div className="nt-widget-empty">No values yet</div>}
      </div>
    ),

    cameras: (
      <div className="nt-widget-panel">
        {data.cameras.length > 0 ? (
          <div className="developer-command-grid">
            {data.cameras.map(cam => (
              <div key={cam.id} className="developer-command-btn" style={{ display: 'grid', gap: 8 }}>
                <span className="command-name">{cam.name}</span>
                <img src={cam.url} alt={cam.name}
                  style={{ width: '100%', maxHeight: 180, objectFit: 'cover', borderRadius: 8 }}
                  loading="lazy"
                />
              </div>
            ))}
          </div>
        ) : (
          <div className="nt-widget-empty">No camera streams yet</div>
        )}
      </div>
    ),

    graph: (
      <div className="nt-widget-panel" style={{ padding: 0, overflow: 'hidden' }}>
        <GraphPanel graphId={`nt-${tabName}`} />
      </div>
    ),

    systems: (
      <div className="nt-widget-panel">
        {displayData.systems.length > 0 ? (
          <div style={{ display: 'grid', gap: 8 }}>
            {displayData.systems.map(sys => {
              const expanded = Boolean(expandedSystems[sys.name]);
              return (
                <div key={sys.name} className="developer-command-btn" style={{ display: 'grid', gap: 10 }}>
                  <button
                    type="button" className="btn btn-secondary"
                    onClick={() => setExpandedSystems(p => ({ ...p, [sys.name]: !p[sys.name] }))}
                    style={{ justifySelf: 'start' }}
                  >
                    {expanded ? '▾' : '▸'} {sys.name}
                  </button>
                  {expanded && (
                    <div style={{ display: 'grid', gap: 10 }}>
                      {sys.commands.length > 0 && <div className="developer-command-grid">{sys.commands.map(renderCommand)}</div>}
                      {sys.tunables.length > 0 && <div className="developer-command-grid">{sys.tunables.map(renderTunable)}</div>}
                      {sys.readValues.length > 0 && <div className="developer-command-grid">{sys.readValues.map(v => renderValue(v, sys.name))}</div>}
                    </div>
                  )}
                </div>
              );
            })}
          </div>
        ) : (
          <div className="nt-widget-empty">No systems yet</div>
        )}
      </div>
    ),
  };

  // Section label lookup
  const sectionLabel = Object.fromEntries(NT_CATALOG.map(c => [c.key, c.label]));

  // Panels currently on the board
  const activeKeys = layout.filter(item => widgets[item.i] != null).map(item => item.i);
  // Panels not on the board (can be added)
  const hiddenKeys = NT_CATALOG.filter(c => !layout.some(item => item.i === c.key));

  return (
    <section className="stage-container-full nt-widget-grid-stage">
      {/* ── Tab header ── */}
      <div className="nt-widget-grid-header">
        <h2 className="nt-widget-grid-title">{tabName}</h2>
        <div className="nt-widget-grid-controls">
          {editMode ? (
            <>
              {hiddenKeys.length > 0 && (
                <div className="widget-add-wrapper">
                  <button className="btn btn-sm btn-success" onClick={() => setShowAddMenu(m => !m)}>
                    + Add Panel
                  </button>
                  {showAddMenu && (
                    <div className="widget-add-menu">
                      {hiddenKeys.map(meta => (
                        <button key={meta.key} className="widget-add-item" onClick={() => addPanel(meta.key)}>
                          {meta.label}
                        </button>
                      ))}
                    </div>
                  )}
                </div>
              )}
              <button className="btn btn-sm btn-ghost" onClick={resetLayout} title="Reset to default layout"><ResetIcon/></button>
              <button className="btn btn-sm btn-success" onClick={() => setEditMode(false)}>Done Editing</button>
            </>
          ) : (
            <button className="btn btn-sm btn-ghost" onClick={() => setEditMode(true)}>
              <GridIcon/> Edit Layout
            </button>
          )}
        </div>
      </div>

      {editMode && (
        <div className="widget-grid-edit-bar" style={{ borderRadius: 0, marginBottom: 0 }}>
          <span className="widget-grid-edit-hint">⠿ Drag to move &nbsp;·&nbsp; ↔ Drag corner to resize &nbsp;·&nbsp; ✕ to remove</span>
        </div>
      )}

      {/* ── Grid ── */}
      <div ref={containerRef} className={`nt-widget-grid-body ${editMode ? 'edit-mode' : ''}`}>
        <ResponsiveGridLayout
          className="widget-grid"
          width={containerWidth}
          layouts={{ lg: layout }}
          breakpoints={{ lg: 1200, md: 900, sm: 600 }}
          cols={{ lg: 12, md: 12, sm: 6 }}
          rowHeight={60}
          isDraggable={editMode}
          isResizable={editMode}
          onLayoutChange={handleLayoutChange}
          margin={[8, 8]}
          containerPadding={[0, 0]}
          compactType={null}
          preventCollision={false}
          draggableHandle=".widget-drag-handle"
        >
          {activeKeys.map(key => (
            <div key={key} className="widget-cell">
              <div className="nt-widget-cell-header">
                {editMode && (
                  <span className="widget-drag-handle" title="Drag to move">⠿</span>
                )}
                <span className="nt-widget-cell-title">{sectionLabel[key] ?? key}</span>
                {editMode && (
                  <button className="widget-remove-btn" onClick={() => removePanel(key)} title="Remove panel">✕</button>
                )}
              </div>
              <div className="widget-content" style={{ paddingTop: 0 }}>
                {widgets[key]}
              </div>
            </div>
          ))}
        </ResponsiveGridLayout>
      </div>
    </section>
  );
}
