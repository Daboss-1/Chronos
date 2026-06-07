import { useCallback, useEffect, useRef, useState } from 'react';
import { ResponsiveGridLayout } from 'react-grid-layout';
import { useLayout, WIDGET_CATALOG } from '../contexts/LayoutContext';
import 'react-grid-layout/css/styles.css';
import 'react-resizable/css/styles.css';

/**
 * WidgetGrid — drag/resize/add/remove widget layout using react-grid-layout v2.
 *
 * Props:
 *   stage    – 'teleop' | 'autonomous'
 *   widgets  – { [widgetKey]: ReactNode }
 */
export default function WidgetGrid({ stage, widgets }) {
  const { editMode, layouts, updateLayout, addWidget, removeWidget } = useLayout();
  const [containerWidth, setContainerWidth] = useState(1200);
  const [showAddMenu, setShowAddMenu] = useState(false);
  const containerRef = useRef(null);

  // Measure container width and keep it updated on resize
  useEffect(() => {
    const el = containerRef.current;
    if (!el) return;
    const ro = new ResizeObserver(entries => {
      for (const entry of entries) {
        const w = entry.contentRect.width;
        if (w > 0) setContainerWidth(w);
      }
    });
    ro.observe(el);
    // Set initial width immediately
    setContainerWidth(el.getBoundingClientRect().width || 1200);
    return () => ro.disconnect();
  }, []);

  const layout = layouts[stage] || [];

  const onLayoutChange = useCallback(
    (newLayout) => updateLayout(stage, newLayout),
    [stage, updateLayout]
  );

  // Only render items that exist in both the layout and the widgets map
  const activeKeys = layout
    .filter(item => widgets[item.i] != null)
    .map(item => item.i);

  // Widgets in the catalog that aren't currently on the board
  const catalog  = WIDGET_CATALOG[stage] || [];
  const hiddenWidgets = catalog.filter(
    meta => !layout.some(item => item.i === meta.key)
  );

  return (
    <div
      ref={containerRef}
      className={`widget-grid-container ${editMode ? 'edit-mode' : ''}`}
    >
      {editMode && (
        <div className="widget-grid-edit-bar">
          <span className="widget-grid-edit-hint">
            ⠿ Drag to move &nbsp;·&nbsp; ↔ Drag corner to resize
          </span>
          {hiddenWidgets.length > 0 && (
            <div className="widget-add-wrapper">
              <button
                className="btn btn-sm btn-success"
                onClick={() => setShowAddMenu(m => !m)}
              >
                + Add Panel
              </button>
              {showAddMenu && (
                <div className="widget-add-menu">
                  {hiddenWidgets.map(meta => (
                    <button
                      key={meta.key}
                      className="widget-add-item"
                      onClick={() => {
                        addWidget(stage, meta.key);
                        setShowAddMenu(false);
                      }}
                    >
                      {meta.label}
                    </button>
                  ))}
                </div>
              )}
            </div>
          )}
        </div>
      )}

      <ResponsiveGridLayout
        className="widget-grid"
        width={containerWidth}
        layouts={{ lg: layout }}
        breakpoints={{ lg: 1200, md: 900, sm: 600 }}
        cols={{ lg: 12, md: 12, sm: 6 }}
        rowHeight={60}
        isDraggable={editMode}
        isResizable={editMode}
        onLayoutChange={onLayoutChange}
        margin={[8, 8]}
        containerPadding={[0, 0]}
        compactType={null}
        preventCollision={false}
        draggableHandle=".widget-drag-handle"
      >
        {activeKeys.map(key => (
          <div key={key} className="widget-cell">
            {editMode && (
              <div className="widget-cell-edit-overlay">
                <div className="widget-drag-handle" title="Drag to move">⠿</div>
                <button
                  className="widget-remove-btn"
                  title="Remove panel"
                  onClick={() => removeWidget(stage, key)}
                >
                  ✕
                </button>
              </div>
            )}
            <div className="widget-content">{widgets[key]}</div>
          </div>
        ))}
      </ResponsiveGridLayout>
    </div>
  );
}
