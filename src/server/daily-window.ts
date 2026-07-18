/**
 * Shared per-device daily-window resolver (OD-1, §9.2/§9.4): the current
 * window for a scope is the latest slot whose ABSOLUTE boundary hasn't
 * passed. Boundaries are monotonic — a timezone change can never produce
 * an earlier one, and a repeated local dayKey after a boundary expires
 * upserts (extends) rather than violating the unique index.
 *
 * Callers MUST hold the per-device advisory lock (deviceLockKey) first.
 */

import { and, desc, eq, sql } from "drizzle-orm";
import type { Db } from "@/db/client";
import { dailySlots } from "@/db/schema";
import { dayKeyFor, nextLocalMidnight } from "./identity";

/** Drizzle transaction handle (structural). */
export type Tx = Parameters<Parameters<Db["transaction"]>[0]>[0];

export type DailySlotRow = typeof dailySlots.$inferSelect;

export async function resolveDailyWindow(
  tx: Tx,
  input: {
    deviceId: string;
    scopeKey: string;
    timeZone: string;
    now?: Date;
  },
): Promise<DailySlotRow> {
  const now = input.now ?? new Date();
  const latest = await tx
    .select()
    .from(dailySlots)
    .where(
      and(
        eq(dailySlots.deviceId, input.deviceId),
        eq(dailySlots.scopeKey, input.scopeKey),
      ),
    )
    .orderBy(desc(dailySlots.eligibleAfterAt))
    .limit(1)
    .for("update");

  const window = latest[0];
  if (window && window.eligibleAfterAt.getTime() > now.getTime()) {
    return window;
  }

  const boundaryFloor = window ? window.eligibleAfterAt.getTime() : 0;
  const computed = nextLocalMidnight(input.timeZone, now).getTime();
  const eligibleAfterAt = new Date(Math.max(computed, boundaryFloor + 1));
  const [upserted] = await tx
    .insert(dailySlots)
    .values({
      deviceId: input.deviceId,
      dayKey: dayKeyFor(input.timeZone, now),
      scopeKey: input.scopeKey,
      timeZone: input.timeZone,
      eligibleAfterAt,
    })
    .onConflictDoUpdate({
      target: [dailySlots.deviceId, dailySlots.dayKey, dailySlots.scopeKey],
      set: {
        eligibleAfterAt: sql`GREATEST(excluded.eligible_after_at, ${dailySlots.eligibleAfterAt})`,
        timeZone: input.timeZone,
      },
    })
    .returning();
  return upserted;
}
