/**
 * LogReplayDashboard
 *
 * Full-dashboard shell for log replay. Uses the same NTTabWidgetGrid used in
 * live mode, but overrides topic data from LogReplayContext instead of the
 * live NT4 provider.
 *
 * Layout:
 *   ┌──────────────────────────────────────────────┐
 *   │  LOG VIEW banner  ·  tab bar                 │
 *   ├──────────────────────────────────────────────┤
 *   │  NTTabWidgetGrid (log data, read-only)       │
 *   └──────────────────────────────────────────────┘
 *   │  LogReplayBar                                │
 */

import { useEffect, useMemo, useState } from 'react';
import { useLogReplay } from '../contexts/LogReplayContext';
import NTTabWidgetGrid from './NTTabWidgetGrid';
import LogReplayBar from './LogReplayBar';
import { IconFolder } from '../utils/icons';

const FolderIcon = () => <IconFolder size={28}/>;

function fmt(ms) {
  const s = Math.floor(ms / 1000);
  return `${Math.floor(s / 60)}:${String(s % 60).padStart(2, '0')}`;
}

export default function LogReplayDashboard() {
  const {
    log, duration, displayPlayhead, topicsObj, topicValuesAt, logTabs, onClose,
  } = useLogReplay();

  const tabs = logTabs.length > 0 ? logTabs : ['(no tabs found)'];
  const [activeTab, setActiveTab] = useState(() => tabs[0]);

  // Snapshot values at the current display playhead (20 Hz, driven by context)
  const topicValues = useMemo(
    () => topicValuesAt(displayPlayhead),
    [topicValuesAt, displayPlayhead],
  );

  const logDate = log
    ? new Date(log.startTimestamp).toLocaleString(undefined, {
        month: 'short', day: 'numeric', year: 'numeric',
        hour: '2-digit', minute: '2-digit',
      })
    : '';

  // Prevent the underlying live dashboard page from scrolling while the
  // log replay overlay is open. This keeps all wheel/trackpad input scoped
  // to the replay view.
  useEffect(() => {
    const prevBodyOverflow = document.body.style.overflow;
    const prevHtmlOverflow = document.documentElement.style.overflow;
    document.body.style.overflow = 'hidden';
    document.documentElement.style.overflow = 'hidden';

    return () => {
      document.body.style.overflow = prevBodyOverflow;
      document.documentElement.style.overflow = prevHtmlOverflow;
    };
  }, []);

  return (
    <div
      className="log-replay-shell"
      onWheel={e => e.stopPropagation()}
    >
      {/* ── Top bar ── */}
      <div className="log-replay-topbar">
        <div className="log-replay-topbar-left">
          <span className="log-replay-badge log-replay-badge--lg">LOG VIEW</span>
          <span className="log-replay-topbar-meta">
            {logDate}
            {duration > 0 && <> · {fmt(duration)}</>}
            {log?.entries?.length > 0 && <> · {log.entries.length} topics</>}
          </span>
        </div>

        {/* Tab navigation derived from the log */}
        <nav className="log-replay-tabs">
          {logTabs.map(tab => (
            <button
              key={tab}
              className={`log-replay-tab ${activeTab === tab ? 'log-replay-tab--active' : ''}`}
              onClick={() => setActiveTab(tab)}
            >
              {tab}
            </button>
          ))}
          {logTabs.length === 0 && (
            <span className="log-replay-tab-empty">No NT tabs found in log</span>
          )}
        </nav>

        <button className="btn btn-sm btn-ghost log-replay-topbar-close" onClick={onClose}>
          ✕ Exit Log View
        </button>
      </div>

      {/* ── Main grid area ── */}
      <div className="log-replay-body">
        {logTabs.length > 0 ? (
          <NTTabWidgetGrid
            key={activeTab}
            tabName={activeTab}
            overrideTopics={topicsObj}
            overrideTopicValues={topicValues}
          />
        ) : (
          <div className="log-replay-no-tabs">
            <div style={{ marginBottom: 12, opacity: 0.45 }}><FolderIcon/></div>
            <div>No ChronosDashboard topics found in this log.</div>
            <div style={{ fontSize: '0.82rem', opacity: 0.6, marginTop: 8 }}>
              This log may use a different topic namespace.
            </div>
          </div>
        )}
      </div>

      {/* ── Playback bar ── */}
      <LogReplayBar />
    </div>
  );
}
