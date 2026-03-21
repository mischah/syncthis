import en from './en.json';

type Translations = typeof en;
const locales: Record<string, Translations> = { en };
const lang = navigator.language?.slice(0, 2) ?? 'en';
const strings: Translations = locales[lang] ?? en;
type TranslationKey = keyof Translations;

export function t(key: TranslationKey, vars?: Record<string, string | number>): string {
  let str: string = strings[key] ?? en[key] ?? key;
  if (vars) {
    for (const [k, v] of Object.entries(vars)) {
      str = str.replace(`{${k}}`, String(v));
    }
  }
  return str;
}
