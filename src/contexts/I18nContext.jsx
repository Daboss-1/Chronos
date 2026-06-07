import { createContext, useContext, useState } from 'react';
import en from '../i18n/en.json';
import es from '../i18n/es.json';
import pt from '../i18n/pt.json';

const TRANSLATIONS = { en, es, pt };
export const LANGUAGES = ['en', 'es', 'pt'];

const I18nContext = createContext(null);

export function I18nProvider({ children }) {
  const [lang, setLang] = useState(
    () => localStorage.getItem('nfr-lang') || 'en'
  );

  /**
   * Resolve a dotted key path, e.g. "checklist.title".
   * Supports {{count}} placeholder replacement via an optional opts object.
   */
  const t = (key, opts = {}) => {
    const parts = key.split('.');
    let obj = TRANSLATIONS[lang] ?? TRANSLATIONS.en;
    for (const part of parts) {
      if (obj && typeof obj === 'object') {
        obj = obj[part];
      } else {
        return key; // key not found
      }
    }
    if (typeof obj !== 'string') return key;
    return obj.replace(/\{\{(\w+)\}\}/g, (_, k) =>
      opts[k] !== undefined ? String(opts[k]) : `{{${k}}}`
    );
  };

  const changeLang = (newLang) => {
    if (LANGUAGES.includes(newLang)) {
      localStorage.setItem('nfr-lang', newLang);
      setLang(newLang);
    }
  };

  return (
    <I18nContext.Provider value={{ lang, changeLang, t }}>
      {children}
    </I18nContext.Provider>
  );
}

export function useI18n() {
  const ctx = useContext(I18nContext);
  if (!ctx) throw new Error('useI18n must be used inside I18nProvider');
  return ctx;
}
