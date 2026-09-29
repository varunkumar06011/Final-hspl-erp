import i18n from 'i18next';
import { initReactI18next } from 'react-i18next';
import en from './locales/en.json';
import te from './locales/te.json';

export const SUPPORTED_LANGUAGES = ['en', 'te'] as const;
export type AppLanguage = (typeof SUPPORTED_LANGUAGES)[number];

const STORAGE_KEY = 'appLanguage';

// Per-screen namespaces: locales/<lang>/<namespace>.json is registered as
// namespace <namespace> (e.g. locales/te/mpr.json -> useTranslation('mpr')).
// The shared app-wide strings stay in locales/<lang>.json ("translation").
function loadNamespaces(modules: Record<string, unknown>): Record<string, unknown> {
  const out: Record<string, unknown> = {};
  for (const [path, mod] of Object.entries(modules)) {
    const name = path.split('/').pop()!.replace(/\.json$/, '');
    out[name] = (mod as { default: unknown }).default;
  }
  return out;
}

const enNamespaces = loadNamespaces(
  import.meta.glob('./locales/en/*.json', { eager: true }) as Record<string, unknown>,
);
const teNamespaces = loadNamespaces(
  import.meta.glob('./locales/te/*.json', { eager: true }) as Record<string, unknown>,
);

// iOS WebKit can block storage access — never let it break startup.
function readSavedLanguage(): AppLanguage {
  try {
    const saved = localStorage.getItem(STORAGE_KEY);
    if (saved && (SUPPORTED_LANGUAGES as readonly string[]).includes(saved)) {
      return saved as AppLanguage;
    }
  } catch {
    /* storage unavailable */
  }
  return 'en';
}

export function saveLanguage(lang: AppLanguage): void {
  try {
    localStorage.setItem(STORAGE_KEY, lang);
  } catch {
    /* storage unavailable */
  }
}

void i18n.use(initReactI18next).init({
  resources: {
    en: { translation: en, ...enNamespaces },
    te: { translation: te, ...teNamespaces },
  } as Record<string, Record<string, object>>,
  ns: ['translation', ...Object.keys(enNamespaces)],
  defaultNS: 'translation',
  lng: readSavedLanguage(),
  fallbackLng: 'en',
  interpolation: { escapeValue: false },
  returnNull: false,
});

// Keep <html lang> in sync so Telugu gets correct font shaping/hyphenation.
document.documentElement.lang = i18n.language;
i18n.on('languageChanged', (lng) => {
  document.documentElement.lang = lng;
});

/** BCP-47 locale for Intl / toLocaleDateString, following the active UI language. */
export const dateLocale = (): string => (i18n.language?.startsWith('te') ? 'te-IN' : 'en-IN');

export default i18n;
