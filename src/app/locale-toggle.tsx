"use client";

/**
 * EN · ES locale toggle (§12.1, LOCALE-1). Persists the preference,
 * pushes it onto the device record via /api/session, syncs <html lang>,
 * and reloads — a full reload keeps every surface (including any
 * server-rendered text) consistent instead of mixing dictionaries
 * mid-session.
 */

import {
  LOCALES,
  LOCALE_STORAGE_KEY,
  getLocale,
  t,
  type Locale,
} from "@/i18n/t";
import { bootstrapSession } from "@/shell/session";

const LABELS: Record<Locale, string> = { en: "EN", "es-419": "ES" };

export function LocaleToggle() {
  const select = (locale: Locale): void => {
    if (locale === getLocale()) return;
    try {
      localStorage.setItem(LOCALE_STORAGE_KEY, locale);
    } catch {
      // Private mode — the toggle still works for this load via reload
      // (navigator fallback may override; acceptable degradation).
    }
    void bootstrapSession({ locale })
      .catch(() => undefined)
      .finally(() => window.location.reload());
  };

  return (
    <div
      className="flex items-center justify-center gap-1 text-xs"
      role="group"
      aria-label={t("portal.language")}
    >
      {LOCALES.map((locale, index) => (
        <span key={locale} className="flex items-center gap-1">
          {index > 0 && (
            <span className="text-muted" aria-hidden="true">
              ·
            </span>
          )}
          <button
            type="button"
            onClick={() => select(locale)}
            className={
              (getLocale() === locale
                ? "font-bold text-brand"
                : "text-muted underline-offset-4 hover:underline") +
              // Comfortable tap area without growing the footer visually.
              " inline-flex min-h-11 items-center px-2"
            }
            aria-pressed={getLocale() === locale}
          >
            {LABELS[locale]}
          </button>
        </span>
      ))}
    </div>
  );
}
