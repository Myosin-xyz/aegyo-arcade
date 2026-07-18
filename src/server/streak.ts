/**
 * Portal-wide streak transaction (§9.3, META-1): advances ONLY inside a
 * successful counted-submission transaction, keyed by the slot's local
 * dayKey. Consecutive-day math runs on calendar labels (DST-immune).
 */

import { eq } from "drizzle-orm";
import { streaks } from "@/db/schema";
import type { Tx } from "./daily-window";
import { dayKeyFor } from "./identity";

/**
 * EFFECTIVE streak for display (M2 review P1): after a missed player-local
 * day the stored value is stale — show zero without mutating anything
 * outside the submission transaction. `current` stands only if the last
 * counted day is today (done) or yesterday (still continuable).
 */
export function effectiveStreak(
  row: { current: number; best: number; lastDayKey: string | null } | null,
  timeZone: string,
  now: Date = new Date(),
): StreakResult {
  if (!row || !row.lastDayKey) return { current: 0, best: row?.best ?? 0 };
  const today = dayKeyFor(timeZone, now);
  const alive =
    row.lastDayKey === today || row.lastDayKey === prevDayKey(today);
  return { current: alive ? row.current : 0, best: row.best };
}

/** Previous calendar date label for a YYYY-MM-DD dayKey. */
export function prevDayKey(dayKey: string): string {
  const [y, m, d] = dayKey.split("-").map(Number);
  const prev = new Date(Date.UTC(y, m - 1, d - 1));
  const mm = String(prev.getUTCMonth() + 1).padStart(2, "0");
  const dd = String(prev.getUTCDate()).padStart(2, "0");
  return `${prev.getUTCFullYear()}-${mm}-${dd}`;
}

export interface StreakResult {
  current: number;
  best: number;
}

/** Caller must hold the device advisory lock (same class as gameplay). */
export async function advanceStreakTx(
  tx: Tx,
  deviceId: string,
  dayKey: string,
): Promise<StreakResult> {
  const existing = await tx
    .select()
    .from(streaks)
    .where(eq(streaks.deviceId, deviceId))
    .for("update");
  const row = existing[0];

  if (!row) {
    await tx
      .insert(streaks)
      .values({ deviceId, current: 1, best: 1, lastDayKey: dayKey });
    return { current: 1, best: 1 };
  }
  if (row.lastDayKey === dayKey) {
    // Already advanced for this player-day (idempotent under OD-1).
    return { current: row.current, best: row.best };
  }
  const current = row.lastDayKey === prevDayKey(dayKey) ? row.current + 1 : 1;
  const best = Math.max(row.best, current);
  await tx
    .update(streaks)
    .set({ current, best, lastDayKey: dayKey, updatedAt: new Date() })
    .where(eq(streaks.deviceId, deviceId));
  return { current, best };
}
