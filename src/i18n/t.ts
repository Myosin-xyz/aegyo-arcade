/**
 * Minimal i18n (TECH_SPEC §12): typed t() over per-locale JSON. Locales:
 * `en` + `es-419` (LOCALE-1 launch pair; `pt-BR` is a follow-up
 * translation task). Player-facing strings never hardcode in components
 * or game logic — a parity test enforces key existence per locale.
 *
 * Locale lifecycle (M4 review P1): the module initializes to `en` on
 * BOTH server and client so hydration is deterministic — React never
 * sees mismatched text/attributes. <LocaleBoundary> then resolves the
 * device preference POST-hydration (§12.1: device language, stored
 * preference wins) and remounts the localized subtree, so every t()
 * output — text AND aria attributes — re-renders in the new locale.
 * The stored preference also updates the device record via /api/session.
 */

import en from "./locales/en.json";
import es419 from "./locales/es-419.json";

export const LOCALES = ["en", "es-419"] as const;
export type Locale = (typeof LOCALES)[number];

export const LOCALE_STORAGE_KEY = "aa-locale";

const dictionaries: Record<string, Record<string, string>> = {
  en,
  "es-419": es419,
};

export function resolveClientLocale(): Locale {
  try {
    const stored = localStorage.getItem(LOCALE_STORAGE_KEY);
    if (stored && (LOCALES as readonly string[]).includes(stored)) {
      return stored as Locale;
    }
    if (navigator.language?.toLowerCase().startsWith("es")) return "es-419";
  } catch {
    // Storage/navigator unavailable — default below.
  }
  return "en";
}

// Deterministic initial value on server AND client (see header).
let activeLocale: Locale = "en";

export function setLocale(locale: string): void {
  if ((LOCALES as readonly string[]).includes(locale)) {
    activeLocale = locale as Locale;
  }
}

export function getLocale(): Locale {
  return activeLocale;
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
