/**
 * Minimal i18n (TECH_SPEC §12): typed t() over per-locale JSON. M0 ships
 * `en` only; `es-419` and later `pt-BR` are translation tasks, not
 * engineering tasks. Player-facing strings never hardcode in components or
 * game logic — a CI check enforces key existence (M2).
 */

import en from "./locales/en.json";

const dictionaries: Record<string, Record<string, string>> = { en };

let activeLocale = "en";

export function setLocale(locale: string): void {
  if (dictionaries[locale]) activeLocale = locale;
}

export function t(key: string, vars?: Record<string, string | number>): string {
  const dict = dictionaries[activeLocale] ?? dictionaries.en;
  let value = dict[key] ?? dictionaries.en[key] ?? key;
  if (vars) {
    for (const [name, replacement] of Object.entries(vars)) {
      value = value.replaceAll(`{${name}}`, String(replacement));
    }
  }
  return value;
}
