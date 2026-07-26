/**
 * Counted-run issuance + submission transactions — TECH_SPEC §9.2, under
 * the adopted OD-1 policy: ONE completed counted run per device per
 * player-local day, portal-wide (scope "portal"), unlimited practice,
 * abandoned/expired attempts never burn the entitlement.
 *
 * Correctness lives in constraints + transactions: per-device advisory
 * lock, slot row locks, partial unique indexes (one issued / one submitted
 * attempt per slot), idempotent submission replay, streak + leaderboard +
 * outbox written in the SAME transaction as the submission.
 */

import { and, eq, sql } from "drizzle-orm";
import { randomBytes } from "node:crypto";
import type { Db } from "@/db/client";
import {
  analyticsOutbox,
  dailySlots,
  devices,
  leaderboardScores,
  runAttempts,
} from "@/db/schema";
import { deviceLockKey } from "./identity";
import { resolveDailyWindow } from "./daily-window";
import { advanceStreakTx, type StreakResult } from "./streak";
import { MIN_PLACING_SCORE, rankForScore } from "./leaderboard";
import { seasonKeyFor } from "./season";
import {
  buildDailySeed,
  countedGameConfig,
  isCountedGame,
} from "./games-config";

export const PORTAL_SCOPE = "portal";
export const ATTEMPT_TTL_MS = 15 * 60 * 1000; // generous bound for a run

export interface IssueInput {
  deviceId: string;
  timeZone: string;
  gameId: string;
}

export type IssueResult =
  | {
      kind: "issued";
      attemptId: string;
      gameId: string;
      seed: string;
      expiresAt: Date;
      dayKey: string;
      reissued: boolean;
    }
  | { kind: "slot_used"; nextEligibleAt: Date }
  | { kind: "unknown_game" }
  | { kind: "device_gone" };

export async function issueCountedAttempt(
  db: Db,
  input: IssueInput,
): Promise<IssueResult> {
  if (!isCountedGame(input.gameId)) return { kind: "unknown_game" };

  return db.transaction(async (tx) => {
    await tx.execute(
      sql`SELECT pg_advisory_xact_lock(hashtextextended(${deviceLockKey(input.deviceId)}, 0))`,
    );
    const live = await tx
      .select({ privacyState: devices.privacyState })
      .from(devices)
      .where(eq(devices.id, input.deviceId))
      .for("update");
    if (!live[0] || live[0].privacyState !== "active") {
      return { kind: "device_gone" as const };
    }

    const window = await resolveDailyWindow(tx, {
      deviceId: input.deviceId,
      scopeKey: PORTAL_SCOPE,
      timeZone: input.timeZone,
    });
    if (window.completedRunId !== null) {
      return {
        kind: "slot_used" as const,
        nextEligibleAt: window.eligibleAfterAt,
      };
    }

    const now = new Date();
    // §9.2.3: an unexpired issued attempt is returned idempotently (same
    // game) or replaced (different game / expired) — never burned (OD-1).
    const issued = await tx
      .select()
      .from(runAttempts)
      .where(
        and(
          eq(runAttempts.slotId, window.id),
          eq(runAttempts.status, "issued"),
        ),
      )
      .for("update");
    const existing = issued[0];
    let attemptNo = 1;
    if (existing) {
      const unexpired = existing.expiresAt.getTime() > now.getTime();
      if (unexpired && existing.gameId === input.gameId) {
        return {
          kind: "issued" as const,
          attemptId: existing.id,
          gameId: existing.gameId,
          seed: existing.seed,
          expiresAt: existing.expiresAt,
          dayKey: window.dayKey,
          reissued: true,
        };
      }
      // Expired, or the player switched games: replace (attempt_no + 1).
      await tx
        .update(runAttempts)
        .set({ status: "expired" })
        .where(eq(runAttempts.id, existing.id));
      attemptNo = existing.attemptNo + 1;
    }

    // Daily-seed games (hangman): every device gets the SAME seed for the
    // same player-day AND content version, so the daily term is
    // server-selected and survives dictionary deployments (§ docs).
    const config = countedGameConfig(input.gameId);
    const seed = config?.dailySeedVersion
      ? buildDailySeed(input.gameId, config.dailySeedVersion, window.dayKey)
      : randomBytes(16).toString("hex");
    const [created] = await tx
      .insert(runAttempts)
      .values({
        slotId: window.id,
        deviceId: input.deviceId,
        gameId: input.gameId,
        mode: "counted",
        attemptNo,
        seed,
        expiresAt: new Date(now.getTime() + ATTEMPT_TTL_MS),
        idempotencyKey: `issue-${randomBytes(16).toString("hex")}`,
      })
      .returning({ id: runAttempts.id, expiresAt: runAttempts.expiresAt });
    return {
      kind: "issued" as const,
      attemptId: created.id,
      gameId: input.gameId,
      seed,
      expiresAt: created.expiresAt,
      dayKey: window.dayKey,
      reissued: false,
    };
  });
}

export interface SubmitInput {
  deviceId: string;
  attemptId: string;
  score: number;
  clientDurationMs?: number;
}

export type SubmitResult =
  | {
      kind: "accepted";
      score: number;
      seasonKey: string;
      /** null when the score does not place — see MIN_PLACING_SCORE. */
      rank: number | null;
      streak: StreakResult;
      replay: boolean;
    }
  | { kind: "invalid_attempt" }
  | { kind: "expired_attempt" }
  | { kind: "bad_score" }
  | { kind: "device_gone" };

export async function submitCountedResult(
  db: Db,
  input: SubmitInput,
): Promise<SubmitResult> {
  return db.transaction(async (tx) => {
    await tx.execute(
      sql`SELECT pg_advisory_xact_lock(hashtextextended(${deviceLockKey(input.deviceId)}, 0))`,
    );
    const live = await tx
      .select({ privacyState: devices.privacyState })
      .from(devices)
      .where(eq(devices.id, input.deviceId))
      .for("update");
    if (!live[0] || live[0].privacyState !== "active") {
      return { kind: "device_gone" as const };
    }

    const attempts = await tx
      .select()
      .from(runAttempts)
      .where(
        and(
          eq(runAttempts.id, input.attemptId),
          eq(runAttempts.deviceId, input.deviceId),
          eq(runAttempts.mode, "counted"),
        ),
      )
      .for("update");
    const attempt = attempts[0];
    if (!attempt || attempt.slotId === null) {
      return { kind: "invalid_attempt" as const };
    }

    // §9.2.2: an already-submitted attempt returns the ORIGINAL result —
    // the acceptance receipt persisted at submit time, never recomputed.
    // A submitted attempt WITHOUT a valid receipt was not completed through
    // this endpoint (e.g. a counted claw play) — fail closed rather than
    // fabricate a result; claw replays belong to /api/claw/plays
    // (M2 re-review P2).
    if (attempt.status === "submitted") {
      const snapshot = parseSnapshot(attempt.resultSnapshot);
      if (!snapshot) return { kind: "invalid_attempt" as const };
      return {
        kind: "accepted" as const,
        score: snapshot.score,
        seasonKey: snapshot.seasonKey,
        rank: snapshot.rank,
        streak: snapshot.streak,
        replay: true,
      };
    }

    const now = new Date();
    if (
      attempt.status !== "issued" ||
      attempt.expiresAt.getTime() <= now.getTime()
    ) {
      return { kind: "expired_attempt" as const };
    }

    const config = countedGameConfig(attempt.gameId);
    const score = input.score;
    if (
      !config ||
      !config.scored ||
      !Number.isInteger(score) ||
      score < 0 ||
      score > config.maxScore
    ) {
      return { kind: "bad_score" as const };
    }

    const slots = await tx
      .select()
      .from(dailySlots)
      .where(eq(dailySlots.id, attempt.slotId))
      .for("update");
    const slot = slots[0];
    if (!slot) return { kind: "invalid_attempt" as const };
    if (slot.completedRunId !== null) {
      // Slot raced to completion by another attempt: treat as expired.
      return { kind: "expired_attempt" as const };
    }

    const seasonKey = seasonKeyFor(now);
    const clientDurationMs =
      typeof input.clientDurationMs === "number" &&
      Number.isFinite(input.clientDurationMs) &&
      input.clientDurationMs >= 0
        ? Math.floor(input.clientDurationMs)
        : null;

    await tx
      .update(runAttempts)
      .set({
        status: "submitted",
        submittedAt: now,
        score,
        clientDurationMs,
        serverElapsedMs: now.getTime() - attempt.issuedAt.getTime(),
      })
      .where(eq(runAttempts.id, attempt.id));
    await tx
      .update(dailySlots)
      .set({ completedRunId: attempt.id })
      .where(eq(dailySlots.id, slot.id));
    await tx.insert(leaderboardScores).values({
      runId: attempt.id,
      deviceId: input.deviceId,
      gameId: attempt.gameId,
      seasonKey,
      score,
    });
    const streak = await advanceStreakTx(tx, input.deviceId, slot.dayKey);
    await tx
      .insert(analyticsOutbox)
      .values({
        aggregateType: "run_attempt",
        aggregateId: attempt.id,
        eventName: "counted_submit_result",
        payload: { gameId: attempt.gameId, accepted: true, reason: "scored" },
      })
      .onConflictDoNothing();

    const rank = await rankForScore(tx, attempt.gameId, seasonKey, score);
    // Persist the acceptance receipt for immutable replays.
    await tx
      .update(runAttempts)
      .set({ resultSnapshot: { score, seasonKey, rank, streak } })
      .where(eq(runAttempts.id, attempt.id));
    return {
      kind: "accepted" as const,
      score,
      seasonKey,
      rank,
      streak,
      replay: false,
    };
  });
}

interface ResultSnapshot {
  score: number;
  seasonKey: string;
  rank: number | null;
  streak: StreakResult;
}

function parseSnapshot(raw: unknown): ResultSnapshot | null {
  if (typeof raw !== "object" || raw === null) return null;
  const value = raw as Record<string, unknown>;
  const streak = value.streak as Record<string, unknown> | undefined;
  if (
    typeof value.score !== "number" ||
    typeof value.seasonKey !== "string" ||
    (value.rank !== null && typeof value.rank !== "number") ||
    !streak ||
    typeof streak.current !== "number" ||
    typeof streak.best !== "number"
  ) {
    return null;
  }
  return {
    score: value.score,
    seasonKey: value.seasonKey,
    // The stored receipt stays immutable, but the PLACEMENT policy is
    // applied at read time on every surface. Snapshots written before
    // MIN_PLACING_SCORE existed recorded a rank for scoreless runs; a
    // replay must not resurrect a "#1" the board no longer shows.
    rank: value.score < MIN_PLACING_SCORE ? null : (value.rank as number),
    streak: { current: streak.current, best: streak.best },
  };
}
