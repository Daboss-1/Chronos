import { useEffect, useState } from 'react';
import { useNt4 } from '@frc-web-components/react/networktables';
import { useI18n } from '../contexts/I18nContext';
import { IconCheck, IconWarning, IconX, IconQuestion } from '../utils/icons';

const CHECKLIST_ROOT = '/NFRDashboard/checklist';

/**
 * Returns an array of checklist items discovered from NT.
 * Each item: { name, status: 'ok'|'warn'|'error'|'unknown', message }
 */
function useChecklistItems(nt4Provider) {
  const [items, setItems] = useState([]);

  useEffect(() => {
    if (!nt4Provider) return;

    const poll = () => {
      const values = nt4Provider.topicValues || {};
      const getVal = (key) =>
        values instanceof Map ? values.get(key) : values[key];

      // Collect all topic keys under the checklist root
      const allKeys =
        values instanceof Map
          ? [...values.keys()]
          : Object.keys(values);

      const names = new Set();
      for (const key of allKeys) {
        if (key.startsWith(CHECKLIST_ROOT + '/')) {
          const rest = key.slice(CHECKLIST_ROOT.length + 1);
          const name = rest.split('/')[0];
          if (name) names.add(name);
        }
      }

      const discovered = [...names].map((name) => {
        const statusRaw = getVal(`${CHECKLIST_ROOT}/${name}/status`);
        const message   = getVal(`${CHECKLIST_ROOT}/${name}/message`) || '';
        const status =
          statusRaw === 'ok' || statusRaw === 'warn' || statusRaw === 'error'
            ? statusRaw
            : 'unknown';
        return { name, status, message };
      });

      setItems(discovered);
    };

    poll();
    const id = setInterval(poll, 200);
    return () => clearInterval(id);
  }, [nt4Provider]);

  return items;
}

export default function Checklist({ goToStage }) {
  const { nt4Provider } = useNt4();
  const { t } = useI18n();
  const items = useChecklistItems(nt4Provider);

  const notOkCount = items.filter((i) => i.status !== 'ok').length;
  const allOk = notOkCount === 0 && items.length > 0;

  const statusIcon = {
    ok:      <IconCheck size={15}/>,
    warn:    <IconWarning size={15}/>,
    error:   <IconX size={15}/>,
    unknown: <IconQuestion size={15}/>,
  };

  return (
    <div className="stage-container checklist-stage">
      <div className="checklist-header">
        <h2>{t('checklist.title')}</h2>
        <p className="checklist-subtitle">{t('checklist.subtitle')}</p>
      </div>

      <div className="checklist-list">
        {items.length === 0 ? (
          <div className="checklist-empty">
            <span className="checklist-item-icon status-unknown"><IconQuestion size={18}/></span>
            <span>No checklist items published by robot</span>
          </div>
        ) : (
          items.map((item) => (
            <div key={item.name} className={`checklist-item status-${item.status}`}>
              <span className={`checklist-item-icon status-${item.status}`}>
                {statusIcon[item.status]}
              </span>
              <div className="checklist-item-info">
                <span className="checklist-item-name">{item.name}</span>
                {item.message && (
                  <span className="checklist-item-message">{item.message}</span>
                )}
              </div>
              <span className={`checklist-item-badge status-${item.status}`}>
                {t(`checklist.status.${item.status}`)}
              </span>
            </div>
          ))
        )}
      </div>

      <div className="checklist-actions">
        {!allOk && items.length > 0 && (
          <p className="checklist-remaining">
            {t('checklist.itemsRemaining', { count: notOkCount })}
          </p>
        )}

        <button
          className="btn btn-primary btn-large"
          onClick={() => goToStage('autoSelection')}
          disabled={!allOk}
        >
          {t('checklist.allClear')}
        </button>

        <button
          className="btn btn-danger btn-large"
          onClick={() => goToStage('autoSelection')}
        >
          {t('checklist.override')}
        </button>
      </div>
    </div>
  );
}
