import { useEffect, useRef, useState } from 'react';
import { useNt4 } from '@frc-web-components/react/networktables';
import { useI18n } from '../contexts/I18nContext';

const STREAMS_ROOT = '/NFRDashboard/cameraStreams';

/**
 * Discovers camera streams from NT under /NFRDashboard/cameraStreams/<tab>/<name>/url
 * and returns an array of { tab, name, url }.
 */
function useCameraStreams(nt4Provider, filterTab = null) {
  const [streams, setStreams] = useState([]);

  useEffect(() => {
    if (!nt4Provider) return;

    const poll = () => {
      const values = nt4Provider.topicValues || {};
      const getVal = (key) =>
        values instanceof Map ? values.get(key) : values[key];

      const allKeys =
        values instanceof Map ? [...values.keys()] : Object.keys(values);

      const seen = new Map(); // key: `${tab}/${name}` → url
      for (const key of allKeys) {
        if (!key.startsWith(STREAMS_ROOT + '/')) continue;
        const rest = key.slice(STREAMS_ROOT.length + 1);
        const parts = rest.split('/');
        if (parts.length < 3) continue;
        const [tab, name, field] = parts;
        if (field !== 'url') continue;
        if (filterTab && tab !== filterTab) continue;
        const url = getVal(key);
        if (typeof url === 'string' && url) {
          seen.set(`${tab}/${name}`, { tab, name, url });
        }
      }
      setStreams([...seen.values()]);
    };

    poll();
    const id = setInterval(poll, 500);
    return () => clearInterval(id);
  }, [nt4Provider, filterTab]);

  return streams;
}

/**
 * Camera switcher: thumbnail strip at the bottom.
 * Click a thumbnail to open a fullscreen modal overlay.
 * Pass `filterTab` to show only streams for that NT tab.
 */
export default function CameraSwitcher({ filterTab = null }) {
  const { nt4Provider } = useNt4();
  const { t } = useI18n();
  const streams = useCameraStreams(nt4Provider, filterTab);
  const [fullscreenStream, setFullscreenStream] = useState(null);
  const overlayRef = useRef(null);

  // Close fullscreen on Escape
  useEffect(() => {
    const onKey = (e) => {
      if (e.key === 'Escape') setFullscreenStream(null);
    };
    window.addEventListener('keydown', onKey);
    return () => window.removeEventListener('keydown', onKey);
  }, []);

  if (streams.length === 0) return null;

  return (
    <>
      <div className="camera-switcher">
        <div className="camera-switcher-label">{t('teleop.cameras')}</div>
        <div className="camera-switcher-strip">
          {streams.map((s) => (
            <button
              key={`${s.tab}/${s.name}`}
              className={`camera-thumb-btn ${
                fullscreenStream?.url === s.url ? 'active' : ''
              }`}
              onClick={() => setFullscreenStream(s)}
              title={s.name}
            >
              {/* mjpeg img — crossOrigin is fine for local robot streams */}
              <img
                src={s.url}
                alt={s.name}
                className="camera-thumb-img"
                loading="lazy"
              />
              <span className="camera-thumb-label">{s.name}</span>
            </button>
          ))}
        </div>
      </div>

      {fullscreenStream && (
        <div
          className="camera-fullscreen-overlay"
          ref={overlayRef}
          onClick={(e) => {
            if (e.target === overlayRef.current) setFullscreenStream(null);
          }}
          role="dialog"
          aria-modal="true"
          aria-label={fullscreenStream.name}
        >
          <div className="camera-fullscreen-inner">
            <div className="camera-fullscreen-toolbar">
              <span className="camera-fullscreen-name">{fullscreenStream.name}</span>
              <button
                className="camera-fullscreen-close"
                onClick={() => setFullscreenStream(null)}
                aria-label={t('teleop.close')}
              >
                ✕
              </button>
            </div>
            <img
              src={fullscreenStream.url}
              alt={fullscreenStream.name}
              className="camera-fullscreen-img"
            />
          </div>
        </div>
      )}
    </>
  );
}
