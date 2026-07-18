/**
 * Claw play/outcome transaction — TECH_SPEC §9.4. Demo promotions only in
 * M1; material_prize configs are refused outright until the §13.3 gate.
 *
 * Invariants enforced here, not by rate limits:
 * - Server outcomes exist ONLY for counted runs: a valid, device-owned,
 *   unexpired claw attempt is locked and consumed in the same transaction
 *   (M1 review B1). Practice never reaches this code path.
 * - Idempotent: the same (device, key) always returns the ORIGINAL outcome,
 *   including across promotion pauses and after the attempt was consumed.
 *   The idempotency check runs BOTH before and after the advisory lock —
 *   the post-lock recheck is what makes same-key races safe (M1 review B2).
 * - The insert uses ON CONFLICT DO NOTHING + re-read, never a query inside
 *   an aborted transaction (SQLSTATE 25P02 regression).
 * - The per-DEVICE advisory lock is shared with privacy deletion, and the
 *   device row is re-checked under it, so a play can never interleave with
 *   a delete (M1 review B5).
 * - Daily cap windows are monotonic absolute instants (daily_slots.
 *   eligible_after_at): a timezone change can never reset the cap early
 *   (OD-1; M1 review B4).
 */

import { and, eq, sql } from "drizzle-orm";
import { randomInt } from "node:crypto";
import type { Db } from "@/db/client";
import {
  analyticsOutbox,
  clawPlays,
  dailySlots,
  devices,
  promotions,
  runAttempts,
} from "@/db/schema";
import { deviceLockKey } from "./identity";
import { resolveDailyWindow } from "./daily-window";
import { advanceStreakTx } from "./streak";

export type ClawOutcome = "win" | "miss" | "drop";

export interface ClawPlayInput {
  deviceId: string;
  timeZone: string;
  idempotencyKey: string;
  /** Counted claw attempt (issued, owned, unexpired). REQUIRED (§9.4). */
  attemptId: string;
}

export type ClawPlayResult =
  | { kind: "played"; outcome: ClawOutcome; ordinal: number; replay: boolean }
  | { kind: "no_active_promotion" }
  | { kind: "material_prize_disabled" }
  | { kind: "invalid_attempt" }
  | { kind: "slot_used" }
  | { kind: "device_gone" }
  | { kind: "cap_reached"; cap: number };

interface PromotionConfig {
  weights: { win: number; miss: number; drop: number };
  /** null = unlimited; 0 = no plays allowed (distinct — M1 review B3). */
  dailyCap: number | null;
}

function drawOutcome(weights: PromotionConfig["weights"]): ClawOutcome {
  const total = weights.win + weights.miss + weights.drop;
  const r = (randomInt(1_000_000) / 1_000_000) * total;
  if (r < weights.win) return "win";
  if (r < weights.win + weights.miss) return "miss";
  return "drop";
}

export function parseConfig(raw: unknown): PromotionConfig | null {
  if (typeof raw !== "object" || raw === null) return null;
  const config = raw as Record<string, unknown>;
  const weights = config.weights as Record<string, unknown> | undefined;
  if (
    !weights ||
    typeof weights.win !== "number" ||
    typeof weights.miss !== "number" ||
    typeof weights.drop !== "number"
  ) {
    return null;
  }
  const { win, miss, drop } = weights as {
    win: number;
    miss: number;
    drop: number;
  };
  // Reject non-finite/negative weights and zero/negative totals.
  if (![win, miss, drop].every((w) => Number.isFinite(w) && w >= 0)) {
    return null;
  }
  if (win + miss + drop <= 0) return null;

  let dailyCap: number | null;
  const rawCap = config.dailyCap;
  if (rawCap === null || rawCap === undefined) {
    dailyCap = null; // unlimited
  } else if (
    typeof rawCap === "number" &&
    Number.isFinite(rawCap) &&
    rawCap >= 0
  ) {
    dailyCap = Math.floor(rawCap); // 0 is a real cap: no plays
  } else {
    return null;
  }
  return { weights: { win, miss, drop }, dailyCap };
}

export async function recordClawPlay(
  db: Db,
  input: ClawPlayInput,
): Promise<ClawPlayResult> {
  return db.transaction(async (tx) => {
    const replayLookup = () =>
      tx
        .select({ outcome: clawPlays.outcome, ordinal: clawPlays.ordinal })
        .from(clawPlays)
        .where(
          and(
            eq(clawPlays.deviceId, input.deviceId),
            eq(clawPlays.idempotencyKey, input.idempotencyKey),
          ),
        )
        .limit(1);

    // Fast-path replay BEFORE any locking — independent of promotion and
    // attempt state, so a lost-response retry always gets the original.
    const preLock = await replayLookup();
    if (preLock[0]) {
      return {
        kind: "played" as const,
        outcome: preLock[0].outcome as ClawOutcome,
        ordinal: preLock[0].ordinal,
        replay: true,
      };
    }

    // Serialize ALL mutations for this device (shared with privacy delete).
    await tx.execute(
      sql`SELECT pg_advisory_xact_lock(hashtextextended(${deviceLockKey(input.deviceId)}, 0))`,
    );

    // Post-lock recheck: a same-key race that lost the lock arrives here
    // AFTER the winner committed — this is the fix for the 25P02 defect.
    const postLock = await replayLookup();
    if (postLock[0]) {
      return {
        kind: "played" as const,
        outcome: postLock[0].outcome as ClawOutcome,
        ordinal: postLock[0].ordinal,
        replay: true,
      };
    }

    // Device must still be live (deletion holds the same advisory lock).
    const deviceRows = await tx
      .select({ privacyState: devices.privacyState })
      .from(devices)
      .where(eq(devices.id, input.deviceId))
      .for("update");
    if (!deviceRows[0] || deviceRows[0].privacyState !== "active") {
      return { kind: "device_gone" as const };
    }

    // Lock + validate the counted attempt this play consumes (B1).
    const attemptRows = await tx
      .select({
        id: runAttempts.id,
        slotId: runAttempts.slotId,
        status: runAttempts.status,
        expiresAt: runAttempts.expiresAt,
      })
      .from(runAttempts)
      .where(
        and(
          eq(runAttempts.id, input.attemptId),
          eq(runAttempts.deviceId, input.deviceId),
          eq(runAttempts.gameId, "claw"),
          eq(runAttempts.mode, "counted"),
        ),
      )
      .for("update");
    const attempt = attemptRows[0];
    if (
      !attempt ||
      attempt.status !== "issued" ||
      attempt.expiresAt.getTime() <= Date.now() ||
      // OD-1: a counted claw attempt MUST carry its entitlement slot — an
      // attempt row alone cannot bypass the daily entitlement (review P1).
      attempt.slotId === null
    ) {
      return { kind: "invalid_attempt" as const };
    }

    // Lock the entitlement slot and require it unused (§9.2 DAILY_SLOT_USED).
    const entitlementRows = await tx
      .select({
        id: dailySlots.id,
        dayKey: dailySlots.dayKey,
        completedRunId: dailySlots.completedRunId,
      })
      .from(dailySlots)
      .where(
        and(
          eq(dailySlots.id, attempt.slotId),
          eq(dailySlots.deviceId, input.deviceId),
        ),
      )
      .for("update");
    const entitlement = entitlementRows[0];
    if (!entitlement) return { kind: "invalid_attempt" as const };
    if (entitlement.completedRunId !== null) {
      return { kind: "slot_used" as const };
    }

    // §9.4 step 2: the configuration row participates in the lock — FOR
    // SHARE lets concurrent plays proceed while blocking a pause/odds
    // mutation from racing an in-flight outcome (review P2).
    const active = await tx
      .select()
      .from(promotions)
      .where(
        and(eq(promotions.channel, "claw"), eq(promotions.status, "active")),
      )
      .limit(1)
      .for("share");
    const promotion = active[0];
    if (!promotion) return { kind: "no_active_promotion" as const };
    if (promotion.kind !== "demo") {
      return { kind: "material_prize_disabled" as const };
    }
    const config = parseConfig(promotion.config);
    if (!config) return { kind: "no_active_promotion" as const };

    // Monotonic cap window (OD-1) via the shared resolver.
    const now = new Date();
    const scopeKey = `claw:${promotion.id}`;
    const window = await resolveDailyWindow(tx, {
      deviceId: input.deviceId,
      scopeKey,
      timeZone: input.timeZone,
      now,
    });

    const countRows = await tx
      .select({ count: sql<number>`count(*)::int` })
      .from(clawPlays)
      .where(
        and(
          eq(clawPlays.promotionId, promotion.id),
          eq(clawPlays.deviceId, input.deviceId),
          eq(clawPlays.dayKey, window.dayKey),
        ),
      );
    const played = countRows[0]?.count ?? 0;
    if (config.dailyCap !== null && played >= config.dailyCap) {
      return { kind: "cap_reached" as const, cap: config.dailyCap };
    }

    const outcome = drawOutcome(config.weights);
    const ordinal = played + 1;
    // ON CONFLICT DO NOTHING + re-read: never query an aborted transaction.
    const inserted = await tx
      .insert(clawPlays)
      .values({
        promotionId: promotion.id,
        attemptId: attempt.id,
        deviceId: input.deviceId,
        dayKey: window.dayKey,
        ordinal,
        outcome,
        oddsVersion: promotion.oddsVersion,
        idempotencyKey: input.idempotencyKey,
      })
      .onConflictDoNothing()
      .returning({ id: clawPlays.id });
    if (!inserted[0]) {
      const raced = await replayLookup();
      if (raced[0]) {
        return {
          kind: "played" as const,
          outcome: raced[0].outcome as ClawOutcome,
          ordinal: raced[0].ordinal,
          replay: true,
        };
      }
      throw new Error("claw play insert conflicted without idempotent row");
    }

    // Consume the attempt + complete its entitlement slot atomically.
    await tx
      .update(runAttempts)
      .set({ status: "submitted", submittedAt: now })
      .where(eq(runAttempts.id, attempt.id));
    await tx
      .update(dailySlots)
      .set({ completedRunId: attempt.id })
      .where(eq(dailySlots.id, entitlement.id));
    // §9.3: a counted claw run IS the device's counted completion for the
    // day under portal-wide OD-1 — it advances the streak like any game.
    await advanceStreakTx(tx, input.deviceId, entitlement.dayKey);

    // Committed-transaction outbox row (§9.2/§17); aggregate identity
    // dedups if a retry ever re-runs this section.
    await tx
      .insert(analyticsOutbox)
      .values({
        aggregateType: "run_attempt",
        aggregateId: attempt.id,
        eventName: "counted_submit_result",
        payload: { gameId: "claw", accepted: true, reason: "played" },
      })
      .onConflictDoNothing();

    return { kind: "played" as const, outcome, ordinal, replay: false };
  });
}
