"use client";

/**
 * Deterministic-hydration locale boundary (M4 review P1). The first
 * client render matches the server (`en`, not ready), so React hydrates
 * cleanly. After hydration this resolves the device preference, sets
 * <html lang>, flips the module locale, and REMOUNTS the localized
 * subtree via a key change so every t() output re-renders localized.
 *
 * It also publishes LOCALE READINESS: mount-time session bootstraps
 * (StreakStrip, leaderboard) must wait for it, or the initial English
 * pass fires a cookie-less `locale:"en"` create milliseconds before the
 * Spanish remount fires a second one — two device identities from one
 * first visit (M4 review P1 follow-up).
 */

import { createContext, useContext, useEffect, useState } from "react";
import { resolveClientLocale, setLocale, type Locale } from "@/i18n/t";

/** Default TRUE so components mounted outside the boundary (tests,
 * future embeds) keep the old immediate behavior. */
const LocaleReadyContext = createContext(true);

/** Session-owning mount effects gate on this (see header). */
export function useLocaleReady(): boolean {
  return useContext(LocaleReadyContext);
}

export function LocaleBoundary({ children }: { children: React.ReactNode }) {
  const [state, setState] = useState<{ locale: Locale; ready: boolean }>({
    locale: "en",
    ready: false,
  });

  useEffect(() => {
    const resolved = resolveClientLocale();
    document.documentElement.lang = resolved === "es-419" ? "es-419" : "en";
    setLocale(resolved);
    // Intentional one-shot post-hydration state set: this is the
    // deterministic-then-switch pattern (M4 review P1) — it runs once.
    // eslint-disable-next-line react-hooks/set-state-in-effect
    setState({ locale: resolved, ready: true }); // es → key remount
  }, []);

  return (
    <LocaleReadyContext.Provider value={state.ready}>
      <div key={state.locale} className="flex min-h-full flex-1 flex-col">
        {children}
      </div>
    </LocaleReadyContext.Provider>
  );
}
