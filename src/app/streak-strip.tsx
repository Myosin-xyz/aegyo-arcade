"use client";

/**
 * Home streak strip (§8.2, META-1): visual status only. Bootstraps the
 * device session, then shows the EFFECTIVE streak. Silent on any failure —
 * the portal never blocks on the meta-layer.
 */

import { useEffect, useState } from "react";
import { t } from "@/i18n/t";
import { bootstrapSession } from "@/shell/session";
import { useLocaleReady } from "./locale-boundary";

export function StreakStrip() {
  const localeReady = useLocaleReady();
  const [streak, setStreak] = useState<{
    current: number;
    best: number;
  } | null>(null);

  useEffect(() => {
    // Session bootstrap waits for the resolved locale (M4 review P1):
    // firing during the initial English pass would create the device
    // record as `en` and race the Spanish remount's duplicate.
    if (!localeReady) return;
    let cancelled = false;
    (async () => {
      try {
        await bootstrapSession();
        const res = await fetch("/api/streak");
        if (!res.ok) return;
        const body = (await res.json()) as { current: number; best: number };
        if (!cancelled) setStreak(body);
      } catch {
        // Meta-layer unavailable — the strip simply doesn't render.
      }
    })();
    return () => {
      cancelled = true;
    };
  }, [localeReady]);

  if (!streak || (streak.current === 0 && streak.best === 0)) return null;
  return (
    <p
      className="mx-auto w-fit rounded-full border border-line bg-surface-2 px-4 py-1.5 text-center text-sm font-semibold text-gold shadow-[0_0_16px_rgba(255,209,102,0.12)]"
      data-testid="streak-strip"
    >
      {t("portal.streak", { current: streak.current, best: streak.best })}
    </p>
  );
}
