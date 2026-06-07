import { createContext, useContext, useState, useCallback } from 'react';

const LayoutContext = createContext(null);

// ──────────────────────────────────────────────────────────────────────────────
// Default layouts (12-column grid, rowHeight = 60 px)
// ──────────────────────────────────────────────────────────────────────────────
const TELEOP_DEFAULT_LAYOUT = [
  { i: 'fieldMap',   x: 0, y: 0,  w: 7, h: 8, minW: 3, minH: 4 },
  { i: 'cameras',    x: 7, y: 0,  w: 5, h: 4, minW: 2, minH: 2 },
  { i: 'phase',      x: 7, y: 4,  w: 5, h: 2, minW: 2, minH: 2 },
  { i: 'status',     x: 7, y: 6,  w: 5, h: 2, minW: 2, minH: 2 },
  { i: 'ntControls', x: 0, y: 8,  w: 7, h: 4, minW: 2, minH: 2 },
  { i: 'scoring',    x: 7, y: 8,  w: 5, h: 4, minW: 2, minH: 2 },
];

const AUTO_DEFAULT_LAYOUT = [
  { i: 'fieldMap',   x: 0, y: 0,  w: 7, h: 8, minW: 3, minH: 4 },
  { i: 'autoInfo',   x: 7, y: 0,  w: 5, h: 2, minW: 2, minH: 2 },
  { i: 'cameras',    x: 7, y: 2,  w: 5, h: 3, minW: 2, minH: 2 },
  { i: 'status',     x: 7, y: 5,  w: 5, h: 3, minW: 2, minH: 2 },
  { i: 'ntControls', x: 0, y: 8,  w: 12, h: 4, minW: 2, minH: 2 },
];

export const DEFAULT_LAYOUTS = {
  teleop:     TELEOP_DEFAULT_LAYOUT,
  autonomous: AUTO_DEFAULT_LAYOUT,
};

/** All possible widget keys + human labels, per stage */
export const WIDGET_CATALOG = {
  teleop: [
    { key: 'fieldMap',   label: 'Field Map',      defaultSize: { w: 7, h: 8 } },
    { key: 'cameras',    label: 'Cameras',         defaultSize: { w: 5, h: 4 } },
    { key: 'phase',      label: 'Match Phase',     defaultSize: { w: 5, h: 2 } },
    { key: 'status',     label: 'Status',          defaultSize: { w: 5, h: 2 } },
    { key: 'ntControls', label: 'NT Controls',     defaultSize: { w: 7, h: 4 } },
    { key: 'scoring',    label: 'Scoring',         defaultSize: { w: 5, h: 4 } },
    { key: 'graph',      label: 'Graph',           defaultSize: { w: 12, h: 7 } },
  ],
  autonomous: [
    { key: 'fieldMap',   label: 'Field Map',      defaultSize: { w: 7, h: 8 } },
    { key: 'autoInfo',   label: 'Auto Routine',    defaultSize: { w: 5, h: 2 } },
    { key: 'cameras',    label: 'Cameras',         defaultSize: { w: 5, h: 3 } },
    { key: 'status',     label: 'Status',          defaultSize: { w: 5, h: 3 } },
    { key: 'ntControls', label: 'NT Controls',     defaultSize: { w: 12, h: 4 } },
    { key: 'graph',      label: 'Graph',           defaultSize: { w: 12, h: 7 } },
  ],
};

// ──────────────────────────────────────────────────────────────────────────────

function loadLayout(stage) {
  try {
    const raw = localStorage.getItem(`nfr-layout-${stage}`);
    if (raw) return JSON.parse(raw);
  } catch { /* ignore */ }
  return DEFAULT_LAYOUTS[stage] || [];
}

function saveLayout(stage, layout) {
  try {
    localStorage.setItem(`nfr-layout-${stage}`, JSON.stringify(layout));
  } catch { /* ignore */ }
}

export function LayoutProvider({ children }) {
  const [editMode, setEditMode] = useState(false);
  const [layouts, setLayouts] = useState({
    teleop:     loadLayout('teleop'),
    autonomous: loadLayout('autonomous'),
  });

  const updateLayout = useCallback((stage, newLayout) => {
    setLayouts(prev => {
      const next = { ...prev, [stage]: newLayout };
      saveLayout(stage, newLayout);
      return next;
    });
  }, []);

  const resetLayout = useCallback((stage) => {
    const def = DEFAULT_LAYOUTS[stage] || [];
    setLayouts(prev => ({ ...prev, [stage]: def }));
    saveLayout(stage, def);
  }, []);

  /** Add a widget to the stage layout (places it at the bottom). */
  const addWidget = useCallback((stage, key) => {
    const catalog = WIDGET_CATALOG[stage] || [];
    const meta = catalog.find(c => c.key === key);
    if (!meta) return;

    setLayouts(prev => {
      const current = prev[stage] || [];
      // Already present → no-op
      if (current.some(item => item.i === key)) return prev;

      // Find lowest y + h occupied
      const bottomY = current.reduce((max, item) => Math.max(max, item.y + item.h), 0);
      const newItem = {
        i: key,
        x: 0,
        y: bottomY,
        w: meta.defaultSize.w,
        h: meta.defaultSize.h,
        minW: 2,
        minH: 2,
      };
      const next = [...current, newItem];
      saveLayout(stage, next);
      return { ...prev, [stage]: next };
    });
  }, []);

  /** Remove a widget from the stage layout. */
  const removeWidget = useCallback((stage, key) => {
    setLayouts(prev => {
      const next = (prev[stage] || []).filter(item => item.i !== key);
      saveLayout(stage, next);
      return { ...prev, [stage]: next };
    });
  }, []);

  return (
    <LayoutContext.Provider value={{
      editMode, setEditMode,
      layouts, updateLayout,
      resetLayout, addWidget, removeWidget,
    }}>
      {children}
    </LayoutContext.Provider>
  );
}

export function useLayout() {
  const ctx = useContext(LayoutContext);
  if (!ctx) throw new Error('useLayout must be used inside LayoutProvider');
  return ctx;
}
