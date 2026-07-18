"use client";

/**
 * Home streak strip (§8.2, META-1): visual status only. Bootstraps the
 * device session, then shows the EFFECTIVE streak. Silent on any failure —
 * the portal never blocks on the meta-layer.
 */

import { useEffect, useState } from "react";
import { t } from "@/i18n/t";

export function StreakStrip() {
  const [streak, setStreak] = useState<{
    current: number;
    best: number;
  } | null>(null);

  useEffect(() => {
    let cancelled = false;
    (async () => {
      try {
        await fetch("/api/session", {
          method: "POST",
          headers: { "content-type": "application/json" },
          body: JSON.stringify({
            timeZone: Intl.DateTimeFormat().resolvedOptions().timeZone,
          }),
        });
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
  }, []);

  if (!streak || (streak.current === 0 && streak.best === 0)) return null;
  return (
    <p className="text-center text-sm font-semibold" data-testid="streak-strip">
      {t("portal.streak", { current: streak.current, best: streak.best })}
    </p>
  );
}
