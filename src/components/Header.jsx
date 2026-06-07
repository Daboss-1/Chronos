import { useRef, useState } from 'react';
import { useEntry } from '@frc-web-components/react/networktables';
import { useDiscoveredTabs } from '../hooks/useDiscoveredTabs';
import { useTheme, THEMES } from '../contexts/ThemeContext';
import { useI18n, LANGUAGES } from '../contexts/I18nContext';
import { useLayout } from '../contexts/LayoutContext';
import DownloadMenu from './DownloadMenu';
import { parseUploadedLog } from '../utils/wpilog';
import { IconMoon, IconSun, IconContrast, IconGlobe, IconSignal, IconReset, IconGrid, IconWarning } from '../utils/icons';

const LAYOUT_STAGES = ['teleop', 'autonomous'];

export default function Header({ stage, activeTab, setActiveTab, autoRoutines, isRecording, onUploadLog, robotAddress }) {
  const [fmsInfo] = useEntry('/FMSInfo', { IsRedAlliance: false });
  const [batteryVoltage] = useEntry('/ChronosDashboard/battery/voltage', null);
  const [akReady] = useEntry('/ChronosDashboard/advantagescope/ready', false);
  const discoveredTabs = useDiscoveredTabs();

  const { theme, setTheme } = useTheme();
  const { lang, changeLang, t } = useI18n();
  const { editMode, setEditMode, resetLayout } = useLayout();

  const [themeOpen, setThemeOpen] = useState(false);
  const [langOpen, setLangOpen] = useState(false);
  const [robotOpen, setRobotOpen] = useState(false);
  const [addressDraft, setAddressDraft] = useState('');
  const [uploadError, setUploadError] = useState(null);
  const themeRef  = useRef(null);
  const langRef   = useRef(null);
  const robotRef  = useRef(null);
  const uploadRef = useRef(null);

  const handleRobotToggle = () => {
    if (!robotOpen) setAddressDraft(robotAddress ?? '');
    setRobotOpen((o) => !o);
    setThemeOpen(false);
    setLangOpen(false);
  };

  const applyRobotAddress = () => {
    const trimmed = addressDraft.trim();
    window.electronAPI?.setRobotAddress(trimmed || null);
    setRobotOpen(false);
  };

  const autoDiscover = () => {
    window.electronAPI?.setRobotAddress(null);
    setRobotOpen(false);
  };

  const handleUploadChange = async (e) => {
    const file = e.target.files?.[0];
    if (!file) return;
    e.target.value = '';
    setUploadError(null);
    try {
      const log = await parseUploadedLog(file);
      onUploadLog?.(log);
    } catch (err) {
      setUploadError(err.message ?? 'Failed to parse log file');
      setTimeout(() => setUploadError(null), 5000);
    }
  };

  const isRedAlliance = fmsInfo?.IsRedAlliance || false;
  const type = fmsInfo?.['.type'] || '';
  const connected = type !== '';
  const batteryText = typeof batteryVoltage === 'number' ? `${batteryVoltage.toFixed(1)}V` : t('battery.unknown');

  const batteryPercent = typeof batteryVoltage === 'number'
    ? Math.max(0, Math.min(100, Math.round((batteryVoltage / 13) * 100)))
    : null;
  const batteryFillLevel = batteryPercent ?? 0;

  const batteryClass =
    typeof batteryVoltage !== 'number'
      ? 'battery-unknown'
      : batteryVoltage >= 11.8
        ? 'battery-good'
        : batteryVoltage >= 10.8
          ? 'battery-warn'
          : 'battery-low';

  const stageNames = {
    checklist:     t('stages.checklist'),
    autoSelection: t('stages.autoSelection'),
    confirmation:  t('stages.confirmation'),
    autonomous:    t('stages.autonomous'),
    teleop:        t('stages.teleop'),
    postGame:      t('stages.postGame'),
  };

  const allianceClass = isRedAlliance ? 'alliance-red' : 'alliance-blue';
  const allianceText  = isRedAlliance ? t('alliance.red') : t('alliance.blue');

  const allTabs = ['Match', ...discoveredTabs];

  const stageIndicator =
    activeTab === 'Match'
      ? (stageNames[stage] || 'PRE-MATCH')
      : activeTab.toUpperCase();

  // Show layout edit controls only during match stages that support it
  const showLayoutControls =
    activeTab === 'Match' && LAYOUT_STAGES.includes(stage);

  const themeLabels = {
    dark:            t('theme.dark'),
    light:           t('theme.light'),
    'high-contrast': t('theme.highContrast'),
  };

  const langLabels = { en: t('language.en'), es: t('language.es'), pt: t('language.pt') };

  const handleThemeToggle = () => { setThemeOpen((o) => !o); setLangOpen(false); setRobotOpen(false); };
  const handleLangToggle  = () => { setLangOpen((o) => !o); setThemeOpen(false); setRobotOpen(false); };

  return (
    <header className="dashboard-header">

      {/* ── Left: Chronos branding + alliance ── */}
      <div className="header-left">
        <span className="header-team-name">Chronos</span>
        <span className={`alliance-pill ${allianceClass}`}>{allianceText}</span>
        {isRecording && (
          <span className="rec-badge" title="Match recording active">
            <span className="rec-dot" />
            REC
          </span>
        )}
        {akReady && (
          <span className="as-badge" title="AdvantageScope bridge active">AS</span>
        )}
      </div>

      {/* ── Centre: tab bar + stage label ── */}
      <div className="header-center">
        <div className="mode-tabs" role="tablist" aria-label="Dashboard tab">
          {allTabs.map(tab => (
            <button
              key={tab}
              type="button"
              className={`mode-tab ${activeTab === tab ? 'active' : ''}`}
              onClick={() => setActiveTab(tab)}
              role="tab"
              aria-selected={activeTab === tab}
            >
              {tab}
            </button>
          ))}
        </div>
        <span className="stage-pill">{stageIndicator}</span>
      </div>

      {/* ── Right: status + utilities ── */}
      <div className="header-right">

        {/* Robot connection + battery — always visible */}
        <div className={`header-robot-status ${connected ? 'connected' : 'disconnected'}`}>
          <span className="header-status-dot" />
          <span className="header-status-label">{t('header.robot')}</span>
          <div className={`battery-indicator ${batteryClass}`} aria-label={`Battery ${batteryText}`}>
            <span className="battery-icon" aria-hidden="true">
              <span className="battery-icon-body">
                <span className="battery-icon-fill" style={{ width: `${batteryFillLevel}%` }} />
              </span>
              <span className="battery-icon-cap" />
            </span>
            <span className="battery-icon-text">{batteryText}</span>
          </div>
        </div>

        {/* Separator */}
        <span className="header-sep" />

        {/* Layout edit */}
        {showLayoutControls && (
          editMode ? (
            <>
              <button className="btn btn-sm btn-success" onClick={() => setEditMode(false)}>
                {t('header.doneEditing')}
              </button>
              <button className="btn btn-sm btn-ghost" onClick={() => resetLayout(stage)} title={t('header.resetLayout')}><IconReset size={14}/></button>
            </>
          ) : (
            <button className="btn btn-sm btn-ghost" onClick={() => setEditMode(true)}>
              <IconGrid size={14}/> {t('header.editLayout')}
            </button>
          )
        )}

        {/* Theme */}
        <div className="header-dropdown-wrapper" ref={themeRef}>
          <button className="header-icon-btn" onClick={handleThemeToggle} title="Theme" aria-expanded={themeOpen}>
            {theme === 'dark' ? <IconMoon size={15}/> : theme === 'light' ? <IconSun size={15}/> : <IconContrast size={15}/>}
          </button>
          {themeOpen && (
            <div className="header-dropdown">
              {THEMES.map(th => (
                <button key={th} className={`header-dropdown-item ${theme === th ? 'active' : ''}`}
                  onClick={() => { setTheme(th); setThemeOpen(false); }}>
                  {themeLabels[th]}
                </button>
              ))}
            </div>
          )}
        </div>

        {/* Language */}
        <div className="header-dropdown-wrapper" ref={langRef}>
          <button className="header-icon-btn" onClick={handleLangToggle} title="Language" aria-expanded={langOpen}>
            <IconGlobe size={15}/>
          </button>
          {langOpen && (
            <div className="header-dropdown">
              {LANGUAGES.map(l => (
                <button key={l} className={`header-dropdown-item ${lang === l ? 'active' : ''}`}
                  onClick={() => { changeLang(l); setLangOpen(false); }}>
                  {langLabels[l]}
                </button>
              ))}
            </div>
          )}
        </div>

        {/* Robot address settings (Electron only) */}
        {window.electronAPI && (
          <div className="header-dropdown-wrapper" ref={robotRef}>
            <button
              className="header-icon-btn"
              onClick={handleRobotToggle}
              title={`Robot: ${robotAddress ?? 'discovering…'}`}
              aria-expanded={robotOpen}
              style={{ fontSize: '0.75rem', fontWeight: 700, letterSpacing: '0.03em', width: 'auto', padding: '0 8px' }}
            >
              <IconSignal size={13}/> {robotAddress ?? '…'}
            </button>
            {robotOpen && (
              <div className="header-dropdown" style={{ width: 260, right: 0, padding: '10px 12px' }}>
                <p style={{ fontSize: '0.7rem', color: 'var(--color-text-muted)', marginBottom: 8, fontWeight: 600 }}>NT4 ROBOT ADDRESS</p>
                <input
                  type="text"
                  value={addressDraft}
                  onChange={(e) => setAddressDraft(e.target.value)}
                  onKeyDown={(e) => e.key === 'Enter' && applyRobotAddress()}
                  placeholder="10.1.72.2"
                  style={{
                    width: '100%', padding: '6px 8px', borderRadius: 6,
                    border: '1px solid var(--color-border-light)',
                    background: 'var(--color-bg-dark)', color: 'var(--color-text-primary)',
                    fontSize: '0.8rem', marginBottom: 8, outline: 'none'
                  }}
                />
                <div style={{ display: 'flex', gap: 6 }}>
                  <button className="btn btn-sm btn-primary" style={{ flex: 1 }} onClick={applyRobotAddress}>Connect</button>
                  <button className="btn btn-sm btn-ghost" style={{ flex: 1 }} onClick={autoDiscover}>Auto-Discover</button>
                </div>
                <p style={{ fontSize: '0.65rem', color: 'var(--color-text-muted)', marginTop: 8 }}>
                  Candidates: 10.1.72.2 · roboRIO-172-FRC.local · localhost
                </p>
              </div>
            )}
          </div>
        )}

        {/* Load log */}
        {onUploadLog && (
          <>
            <input ref={uploadRef} type="file" accept=".wpilog,.json"
              style={{ display: 'none' }} onChange={handleUploadChange} />
            <button className="header-icon-btn" onClick={() => uploadRef.current?.click()}
              title="Upload and replay a .wpilog or .json log file">
              <svg width="15" height="15" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round">
                <path d="M14 2H6a2 2 0 0 0-2 2v16a2 2 0 0 0 2 2h12a2 2 0 0 0 2-2V8z"/>
                <polyline points="14 2 14 8 20 8"/>
                <line x1="12" y1="9" x2="12" y2="15"/><polyline points="9 12 12 15 15 12"/>
              </svg>
            </button>
            {uploadError && (
              <span className="header-upload-error" title={uploadError}><IconWarning size={14}/></span>
            )}
          </>
        )}
      </div>
    </header>
  );
}
