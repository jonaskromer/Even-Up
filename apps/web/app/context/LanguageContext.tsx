import { createContext, type ReactNode, useCallback, useContext, useEffect, useState } from 'react';
import { type Lang, type LangPref, translations } from '../i18n/translations';

export type { Lang, LangPref };
export type TFunc = (key: string, vars?: Record<string, string | number>) => string;

interface LanguageContextValue {
  lang: Lang;
  langPref: LangPref;
  setLangPref: (pref: LangPref) => void;
  t: TFunc;
}

const LanguageContext = createContext<LanguageContextValue | null>(null);

function resolveKey(obj: unknown, path: string): string {
  const parts = path.split('.');
  let current: unknown = obj;
  for (const part of parts) {
    if (current == null || typeof current !== 'object') return path;
    current = (current as Record<string, unknown>)[part];
  }
  return typeof current === 'string' ? current : path;
}

function interpolate(str: string, vars?: Record<string, string | number>): string {
  if (!vars) return str;
  return Object.entries(vars).reduce(
    (acc, [key, val]) => acc.replace(new RegExp(`\\{\\{${key}\\}\\}`, 'g'), String(val)),
    str,
  );
}

function detectLang(pref: LangPref): Lang {
  if (pref === 'de' || pref === 'en') return pref;
  if (typeof navigator === 'undefined') return 'de';
  const browserLang = navigator.language.slice(0, 2).toLowerCase();
  return browserLang === 'de' ? 'de' : 'en';
}

function getStoredPref(): LangPref {
  try {
    const stored = localStorage.getItem('evenup:lang');
    if (stored === 'de' || stored === 'en' || stored === 'auto') return stored;
  } catch {
    // not available in SSR / test environments
  }
  return 'auto';
}

export function LanguageProvider({ children }: { children: ReactNode }) {
  const [langPref, setLangPrefState] = useState<LangPref>(() => getStoredPref());
  const [lang, setLang] = useState<Lang>(() => detectLang(getStoredPref()));

  useEffect(() => {
    document.documentElement.lang = lang;
  }, [lang]);

  const setLangPref = useCallback((pref: LangPref) => {
    try {
      localStorage.setItem('evenup:lang', pref);
    } catch {
      // not available in SSR / test environments
    }
    setLangPrefState(pref);
    setLang(detectLang(pref));
  }, []);

  const t = useCallback<TFunc>(
    (key, vars) => {
      const str = resolveKey(translations[lang], key);
      return interpolate(str, vars);
    },
    [lang],
  );

  return (
    <LanguageContext.Provider value={{ lang, langPref, setLangPref, t }}>
      {children}
    </LanguageContext.Provider>
  );
}

export function useLanguage(): LanguageContextValue {
  const ctx = useContext(LanguageContext);
  if (!ctx) throw new Error('useLanguage must be used inside <LanguageProvider>');
  return ctx;
}
