import { createContext, useContext, useEffect, useState, type ReactNode } from 'react';
import deCommon from '../../locales/de/common.json';
import enCommon from '../../locales/en/common.json';

// Define standard registry type based on German structure
type TranslationSchema = typeof deCommon & Record<string, any>;

const defaultTranslations: Record<string, TranslationSchema> = {
  de: deCommon as unknown as TranslationSchema,
  en: enCommon as unknown as TranslationSchema,
};

/** Feste Standardsprache — neue Sessions und ungültige Werte landen immer auf Deutsch. */
export const DEFAULT_LANGUAGE = 'de';

interface I18nContextProps {
  language: string;
  languages: string[];
  t: (keyPath: string, defaultValue?: string) => string;
  i18n: {
    language: string;
    changeLanguage: (lang: string) => void;
  };
  addTranslations: (lang: string, translations: any) => void;
}

const I18nContext = createContext<I18nContextProps | undefined>(undefined);

// Helper function to resolve dot notation nested keys
function getNestedValue(obj: any, path: string): string | undefined {
  if (!obj) return undefined;
  const parts = path.split('.');
  let current = obj;
  for (const part of parts) {
    if (current && typeof current === 'object' && part in current) {
      current = current[part];
    } else {
      return undefined;
    }
  }
  return typeof current === 'string' ? current : undefined;
}

function resolveInitialLanguage(): string {
  try {
    const saved = localStorage.getItem('lang');
    if (saved === 'de' || saved === 'en') return saved;
  } catch {
    /* private mode */
  }
  return DEFAULT_LANGUAGE;
}

export function I18nProvider({ children }: { children: ReactNode }) {
  const [translations, setTranslations] = useState<Record<string, any>>(defaultTranslations);
  const [language, setLanguageState] = useState<string>(resolveInitialLanguage);

  useEffect(() => {
    try {
      localStorage.setItem('lang', language);
    } catch {
      /* ignore */
    }
    if (typeof document !== 'undefined') {
      document.documentElement.lang = language;
    }
  }, [language]);

  const changeLanguage = (lang: string) => {
    setLanguageState(lang === 'en' ? 'en' : DEFAULT_LANGUAGE);
  };

  const addTranslations = (lang: string, extraTranslations: any) => {
    setTranslations(prev => ({
      ...prev,
      [lang]: {
        ...(prev[lang] || {}),
        ...extraTranslations,
      },
    }));
  };

  // Strict locale: never cross-fallback to the other language.
  // Bei fehlendem DE-Schlüssel: EN-Fallback vermeiden — defaultValue oder Key.
  // Bei EN-Sprache und fehlendem Key: deutschen Text als letzte Hilfe nutzen (DE ist Quelle der Wahrheit).
  const t = (keyPath: string, defaultValue?: string): string => {
    const activeText = getNestedValue(translations[language], keyPath);
    if (activeText !== undefined) return activeText;

    if (language !== DEFAULT_LANGUAGE) {
      const deText = getNestedValue(translations[DEFAULT_LANGUAGE], keyPath);
      if (deText !== undefined) return deText;
    }

    if (defaultValue !== undefined) return defaultValue;
    return keyPath;
  };

  const languages = Object.keys(translations);

  const i18n = {
    language,
    changeLanguage,
  };

  return (
    <I18nContext.Provider value={{ language, languages, t, i18n, addTranslations }}>
      {children}
    </I18nContext.Provider>
  );
}

export function useTranslation() {
  const context = useContext(I18nContext);
  if (context === undefined) {
    throw new Error('useTranslation must be used within an I18nProvider');
  }
  return context;
}
