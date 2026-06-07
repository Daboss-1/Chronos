import { useEffect, useRef, useState } from 'react';
import { useNt4 } from '@frc-web-components/react/networktables';
import { useI18n } from '../contexts/I18nContext';
import { IconWarning, IconX, IconInfo } from '../utils/icons';

const ALERTS_ROOT = '/NFRDashboard/alerts';
const AUTO_DISMISS_MS = 6000;

let toastIdCounter = 0;

/**
 * Monitors /NFRDashboard/alerts/<name>/ in NT.
 * When `active` transitions false→true a toast is pushed.
 * Toasts auto-dismiss after AUTO_DISMISS_MS.
 */
export default function AlertsOverlay() {
  const { nt4Provider } = useNt4();
  const { t } = useI18n();
  const [toasts, setToasts] = useState([]);
  const prevActive = useRef({});

  useEffect(() => {
    if (!nt4Provider) return;

    const poll = () => {
      const values = nt4Provider.topicValues || {};
      const getVal = (key) =>
        values instanceof Map ? values.get(key) : values[key];

      const allKeys =
        values instanceof Map ? [...values.keys()] : Object.keys(values);

      const alertNames = new Set();
      for (const key of allKeys) {
        if (key.startsWith(ALERTS_ROOT + '/')) {
          const rest = key.slice(ALERTS_ROOT.length + 1);
          const name = rest.split('/')[0];
          if (name) alertNames.add(name);
        }
      }

      for (const name of alertNames) {
        const active   = getVal(`${ALERTS_ROOT}/${name}/active`) === true;
        const wasActive = prevActive.current[name] || false;

        if (active && !wasActive) {
          // Rising edge → create toast
          const severity = getVal(`${ALERTS_ROOT}/${name}/severity`) || 'info';
          const message  = getVal(`${ALERTS_ROOT}/${name}/message`) || name;
          const id = ++toastIdCounter;

          setToasts((prev) => [
            ...prev,
            { id, name, severity, message, timestamp: Date.now() },
          ]);
        }
        prevActive.current[name] = active;
      }
    };

    poll();
    const id = setInterval(poll, 100);
    return () => clearInterval(id);
  }, [nt4Provider]);

  // Auto-dismiss toasts
  useEffect(() => {
    if (toasts.length === 0) return;
    const oldest = toasts[0];
    const age = Date.now() - oldest.timestamp;
    const remaining = AUTO_DISMISS_MS - age;
    if (remaining <= 0) {
      setToasts((prev) => prev.filter((t) => t.id !== oldest.id));
      return;
    }
    const timer = setTimeout(() => {
      setToasts((prev) => prev.filter((t) => t.id !== oldest.id));
    }, remaining);
    return () => clearTimeout(timer);
  }, [toasts]);

  const dismiss = (id) => setToasts((prev) => prev.filter((t) => t.id !== id));

  if (toasts.length === 0) return null;

  return (
    <div className="alerts-overlay" role="status" aria-live="assertive">
      {toasts.map((toast) => (
        <div key={toast.id} className={`alert-toast alert-toast-${toast.severity}`}>
          <span className="alert-toast-icon"><SeverityIcon severity={toast.severity} /></span>
          <div className="alert-toast-body">
            <span className="alert-toast-name">{toast.name}</span>
            <span className="alert-toast-message">{toast.message}</span>
          </div>
          <button
            className="alert-toast-dismiss"
            onClick={() => dismiss(toast.id)}
            aria-label={t('alerts.dismiss')}
          >
            ✕
          </button>
        </div>
      ))}
    </div>
  );
}

function SeverityIcon({ severity }) {
  switch (severity) {
    case 'critical': return <IconWarning size={16}/>;
    case 'error':    return <IconX size={16}/>;
    case 'warn':     return <IconWarning size={16}/>;
    default:         return <IconInfo size={16}/>;
  }
}
