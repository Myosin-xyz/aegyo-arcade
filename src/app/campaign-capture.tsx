"use client";

/**
 * App-level campaign capture + session-activity wiring (OD-7, §17.2).
 *
 * The root layout persists across Next client navigation, so this
 * component mounts ONCE — capture alone would leave `lastActivityAt`
 * frozen and an actively playing user would lose attribution at
 * wall-clock 30 minutes (M3 review P1). Three touch sources keep a
 * LIVE session alive:
 *   1. initial load: capture allowlisted params + strip the URL;
 *   2. every client navigation — pathname OR query-only — re-runs the
 *      full capture/touch/strip flow;
 *   3. pointer/keyboard activity, throttled to one write per minute.
 * Renders nothing; never blocks.
 */

import { useEffect } from "react";
import { usePathname, useSearchParams } from "next/navigation";
import {
  parseCampaign,
  storeCampaign,
  stripCampaignParams,
  touchCampaignSession,
} from "@/shell/campaign";

/** One storage write per minute is plenty against a 30-minute window. */
export const ACTIVITY_THROTTLE_MS = 60_000;

export function CampaignCapture({
  onLocationSanitized,
}: {
  onLocationSanitized?: () => void;
} = {}) {
  const pathname = usePathname();
  // Query-only client transitions don't change pathname (M3 review P2)
  // — observe the search string too, so EVERY route change runs the
  // full capture/touch/strip flow. The layout wraps this component in
  // <Suspense> (useSearchParams requirement).
  const search = useSearchParams().toString();

  // Initial load AND every client navigation (pathname or query):
  // capture new allowlisted params (or touch a live session — inside a
  // session first touch still wins), then strip tracking residue that
  // client transitions would otherwise leave in the address bar.
  useEffect(() => {
    storeCampaign(parseCampaign(window.location.search));
    const cleaned = stripCampaignParams(new URL(window.location.href));
    if (cleaned !== null) {
      window.history.replaceState(window.history.state, "", cleaned);
    }
    onLocationSanitized?.();
  }, [pathname, search, onLocationSanitized]);

  // Raw input activity, throttled.
  useEffect(() => {
    let lastTouch = 0;
    const onActivity = () => {
      const now = Date.now();
      if (now - lastTouch < ACTIVITY_THROTTLE_MS) return;
      lastTouch = now;
      touchCampaignSession(now);
    };
    window.addEventListener("pointerdown", onActivity, { passive: true });
    window.addEventListener("keydown", onActivity, { passive: true });
    return () => {
      window.removeEventListener("pointerdown", onActivity);
      window.removeEventListener("keydown", onActivity);
    };
  }, []);

  return null;
}
