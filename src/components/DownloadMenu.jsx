import { useState, useRef, useEffect } from 'react';
import { useRewind } from '../contexts/RewindContext';
import { generateAutoRoutinesPdf } from '../utils/pdfGenerator.jsx';
import { downloadTrimmedWpilog, downloadWpilog } from '../utils/wpilog';

function fmtDur(sec) {
  const m = Math.floor(sec / 60);
  const s = Math.floor(sec % 60);
  return `${m}:${String(s).padStart(2, '0')}`;
}

const IconFile = () => (
  <svg width="15" height="15" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round">
    <path d="M14 2H6a2 2 0 0 0-2 2v16a2 2 0 0 0 2 2h12a2 2 0 0 0 2-2V8z"/>
    <polyline points="14 2 14 8 20 8"/>
    <line x1="16" y1="13" x2="8" y2="13"/><line x1="16" y1="17" x2="8" y2="17"/>
  </svg>
);

const IconDownload = ({ size = 15 }) => (
  <svg width={size} height={size} viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round">
    <path d="M21 15v4a2 2 0 0 1-2 2H5a2 2 0 0 1-2-2v-4"/>
    <polyline points="7 10 12 15 17 10"/>
    <line x1="12" y1="15" x2="12" y2="3"/>
  </svg>
);

export default function DownloadMenu({ autoRoutines, currentLog }) {
  const [isOpen, setIsOpen] = useState(false);
  const [logClipStart, setLogClipStart] = useState(0);
  const [logClipEnd, setLogClipEnd]     = useState(0);
  const [bufClipStart, setBufClipStart] = useState(0);
  const [bufClipEnd, setBufClipEnd]     = useState(0);
  const [nowMs, setNowMs] = useState(Date.now());
  const panelRef = useRef(null);
  const { startTime, bufferRef } = useRewind();

  // Keep nowMs ticking so buffer duration updates
  useEffect(() => {
    const id = setInterval(() => setNowMs(Date.now()), 1000);
    return () => clearInterval(id);
  }, []);

  const bufDurSec = Math.max(0, (nowMs - startTime) / 1000);
  const logDurSec = currentLog ? Math.max(0, (currentLog.durationMs ?? 0) / 1000) : 0;
  const hasBuffer = bufferRef.current.size > 0;

  // Initialise log clip range when a log is loaded
  useEffect(() => {
    if (currentLog) {
      setLogClipStart(0);
      setLogClipEnd(logDurSec);
    }
  }, [currentLog]); // eslint-disable-line react-hooks/exhaustive-deps

  // Initialise buffer clip range once buffer starts filling
  useEffect(() => {
    if (hasBuffer && bufClipEnd === 0) setBufClipEnd(Math.round(bufDurSec));
  }, [hasBuffer]); // eslint-disable-line react-hooks/exhaustive-deps

  // Close on outside click
  useEffect(() => {
    const handler = (e) => {
      if (panelRef.current && !panelRef.current.contains(e.target)) setIsOpen(false);
    };
    document.addEventListener('mousedown', handler);
    return () => document.removeEventListener('mousedown', handler);
  }, []);

  const close = () => setIsOpen(false);

  // ── Build synthetic log from live ring buffer ────────────────────────────
  const buildSyntheticLog = () => {
    const entries = [];
    let id = 1;
    for (const [topic, series] of bufferRef.current.entries()) {
      if (series.timestamps.length === 0) continue;
      entries.push({
        id: id++,
        name: topic,
        type: 'double',   // ring buffer normalises all values to JS number
        metadata: '',
        timestamps: series.timestamps.map(ts => ts - startTime), // → relative ms
        values: [...series.values],
      });
    }
    return {
      startTimestamp: startTime,
      durationMs: nowMs - startTime,
      entries,
    };
  };

  // ── Handlers ─────────────────────────────────────────────────────────────
  const handlePdf = async () => { close(); await generateAutoRoutinesPdf(autoRoutines); };

  const handleFullLog = () => {
    if (!currentLog) return;
    close();
    downloadWpilog(currentLog);
  };

  const handleLogClip = () => {
    if (!currentLog) return;
    const s = Math.min(logClipStart, logClipEnd) * 1000;
    const e = Math.max(logClipStart, logClipEnd) * 1000;
    if (e <= s) return;
    close();
    downloadTrimmedWpilog(currentLog, s, e);
  };

  const handleFullBuffer = () => {
    if (!hasBuffer) return;
    close();
    downloadWpilog(buildSyntheticLog());
  };

  const handleBufferClip = () => {
    if (!hasBuffer) return;
    const s = Math.min(bufClipStart, bufClipEnd) * 1000;
    const e = Math.max(bufClipStart, bufClipEnd) * 1000;
    if (e <= s) return;
    close();
    downloadTrimmedWpilog(buildSyntheticLog(), s, e);
  };

  // ── Render ────────────────────────────────────────────────────────────────
  return (
    <div className="dl-container" ref={panelRef}>
      <button
        className={`dl-fab ${isOpen ? 'dl-fab--open' : ''}`}
        onClick={() => setIsOpen(o => !o)}
        aria-label="Export options"
        title="Export data"
      >
        <IconDownload size={22} />
      </button>

      {isOpen && (
        <div className="dl-panel">
          <div className="dl-panel-header">
            <span className="dl-panel-title">Export Data</span>
            <button className="dl-close-btn" onClick={close} aria-label="Close">✕</button>
          </div>

          {/* ── Auto PDF ── */}
          <div className="dl-section">
            <button className="dl-action-row" onClick={handlePdf}>
              <span className="dl-action-icon"><IconFile /></span>
              <div className="dl-action-text">
                <span className="dl-action-label">Auto Routines PDF</span>
                <span className="dl-action-desc">Current auto selections</span>
              </div>
              <span className="dl-action-chevron"><IconDownload /></span>
            </button>
          </div>

          {/* ── Live Buffer ── */}
          {hasBuffer && (
            <>
              <div className="dl-section-divider">
                <span>Live Buffer</span>
                <span className="dl-divider-badge">{fmtDur(bufDurSec)} · {bufferRef.current.size} topics</span>
              </div>
              <div className="dl-section">
                <button className="dl-action-row" onClick={handleFullBuffer}>
                  <span className="dl-action-icon"><IconDownload /></span>
                  <div className="dl-action-text">
                    <span className="dl-action-label">Full Buffer</span>
                    <span className="dl-action-desc">All {fmtDur(bufDurSec)} of recorded data</span>
                  </div>
                  <span className="dl-action-chevron"><IconDownload /></span>
                </button>
                <div className="dl-clip-form">
                  <div className="dl-clip-label">
                    <span>Clip Range</span>
                    <span className="dl-clip-hint">seconds from start</span>
                  </div>
                  <div className="dl-clip-row">
                    <div className="dl-clip-field">
                      <label htmlFor="buf-clip-start">Start</label>
                      <input id="buf-clip-start" type="number" min="0" max={bufDurSec} step="0.5"
                        value={bufClipStart} onChange={e => setBufClipStart(Number(e.target.value))} />
                    </div>
                    <span className="dl-clip-arrow">→</span>
                    <div className="dl-clip-field">
                      <label htmlFor="buf-clip-end">End</label>
                      <input id="buf-clip-end" type="number" min="0" max={bufDurSec} step="0.5"
                        value={bufClipEnd} onChange={e => setBufClipEnd(Number(e.target.value))} />
                    </div>
                  </div>
                  <button className="dl-clip-btn" onClick={handleBufferClip}
                    disabled={Math.max(bufClipStart, bufClipEnd) <= Math.min(bufClipStart, bufClipEnd)}>
                    Download Clip (.wpilog)
                  </button>
                </div>
              </div>
            </>
          )}

          {/* ── Match Log ── */}
          {currentLog && (
            <>
              <div className="dl-section-divider">
                <span>Match Recording</span>
                <span className="dl-divider-badge">{fmtDur(logDurSec)}</span>
              </div>
              <div className="dl-section">
                <button className="dl-action-row" onClick={handleFullLog}>
                  <span className="dl-action-icon"><IconDownload /></span>
                  <div className="dl-action-text">
                    <span className="dl-action-label">Full Match Log</span>
                    <span className="dl-action-desc">{fmtDur(logDurSec)} recording</span>
                  </div>
                  <span className="dl-action-chevron"><IconDownload /></span>
                </button>
                <div className="dl-clip-form">
                  <div className="dl-clip-label">
                    <span>Clip Range</span>
                    <span className="dl-clip-hint">seconds from start</span>
                  </div>
                  <div className="dl-clip-row">
                    <div className="dl-clip-field">
                      <label htmlFor="log-clip-start">Start</label>
                      <input id="log-clip-start" type="number" min="0" max={logDurSec} step="0.1"
                        value={logClipStart} onChange={e => setLogClipStart(Number(e.target.value))} />
                    </div>
                    <span className="dl-clip-arrow">→</span>
                    <div className="dl-clip-field">
                      <label htmlFor="log-clip-end">End</label>
                      <input id="log-clip-end" type="number" min="0" max={logDurSec} step="0.1"
                        value={logClipEnd} onChange={e => setLogClipEnd(Number(e.target.value))} />
                    </div>
                  </div>
                  <button className="dl-clip-btn" onClick={handleLogClip}
                    disabled={Math.max(logClipStart, logClipEnd) <= Math.min(logClipStart, logClipEnd)}>
                    Download Clip (.wpilog)
                  </button>
                </div>
              </div>
            </>
          )}

          {!hasBuffer && !currentLog && (
            <div className="dl-empty">No recording data available yet</div>
          )}
        </div>
      )}
    </div>
  );
}
