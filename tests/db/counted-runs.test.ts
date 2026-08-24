// @vitest-environment node
/**
 * Counted-run issuance/submission invariants vs real Postgres
 * (TECH_SPEC §9.2/§9.3, adopted OD-1): entitlement lifecycle, idempotent
 * issuance and replay, expired-attempt replacement, streak transitions,
 * season keys, and the claw path advancing the same streak.
 */

import { afterAll, beforeAll, beforeEach, describe, expect, it } from "vitest";
import { drizzle, type NodePgDatabase } from "drizzle-orm/node-postgres";
import { Pool } from "pg";
import { eq } from "drizzle-orm";
import * as schema from "@/db/schema";
import {
  analyticsOutbox,
  dailySlots,
  leaderboardScores,
  promotions,
  runAttempts,
  streaks,
  devices,
} from "@/db/schema";
import {
  issueCountedAttempt,
  submitCountedResult,
  PORTAL_SCOPE,
} from "@/server/runs";
import { buildDailySeed } from "@/server/games-config";
import { getSeasonBoard, rankForScore } from "@/server/leaderboard";
import { effectiveStreak } from "@/server/streak";
import { recordClawPlay } from "@/server/claw-play";
import { createDeviceSession, touchSession } from "@/server/identity";
import { prevDayKey } from "@/server/streak";
import { seasonKeyFor } from "@/server/season";

const TEST_URL =
  process.env.TEST_DATABASE_URL ??
  "postgres://localhost:5432/aegyo_arcade_test";

type Db = NodePgDatabase<typeof schema>;

let pool: Pool;
let db: Db;

beforeAll(async () => {
  pool = new Pool({ connectionString: TEST_URL, max: 10 });
  db = drizzle(pool, { schema });
  await pool.query("SELECT 1");
});

afterAll(async () => {
  await pool.end();
});

beforeEach(async () => {
  await pool.query(
    `TRUNCATE claw_plays, prize_claims, prize_inventory, promotions,
              leaderboard_scores, run_attempts, daily_slots, streaks,
              device_sessions, devices, ops_audit, analytics_outbox CASCADE`,
  );
});

async function seedDevice(timeZone = "America/Mexico_City") {
  const created = await createDeviceSession(db, { timeZone });
  return created.device;
}

describe("issuance (§9.2, OD-1 portal-wide)", () => {
  it("issues one attempt; re-request returns it idempotently", async () => {
    const device = await seedDevice();
    const first = await issueCountedAttempt(db, {
      deviceId: device.deviceId,
      timeZone: device.timeZone,
      gameId: "snake",
    });
    expect(first.kind).toBe("issued");
    const second = await issueCountedAttempt(db, {
      deviceId: device.deviceId,
      timeZone: device.timeZone,
      gameId: "snake",
    });
    expect(second.kind).toBe("issued");
    if (first.kind === "issued" && second.kind === "issued") {
      expect(second.attemptId).toBe(first.attemptId);
      expect(second.seed).toBe(first.seed); // same seed — same run
      expect(second.reissued).toBe(true);
    }
    expect(await db.select().from(runAttempts)).toHaveLength(1);
  });

  it("switching games replaces the issued attempt (attempt_no + 1), never burns the day", async () => {
    const device = await seedDevice();
    const snake = await issueCountedAttempt(db, {
      deviceId: device.deviceId,
      timeZone: device.timeZone,
      gameId: "snake",
    });
    const claw = await issueCountedAttempt(db, {
      deviceId: device.deviceId,
      timeZone: device.timeZone,
      gameId: "claw",
    });
    expect(claw.kind).toBe("issued");
    if (snake.kind === "issued" && claw.kind === "issued") {
      expect(claw.attemptId).not.toBe(snake.attemptId);
      const [old] = await db
        .select()
        .from(runAttempts)
        .where(eq(runAttempts.id, snake.attemptId));
      expect(old.status).toBe("expired");
      const [fresh] = await db
        .select()
        .from(runAttempts)
        .where(eq(runAttempts.id, claw.attemptId));
      expect(fresh.attemptNo).toBe(2);
    }
    // Still ONE portal slot.
    const slots = await db
      .select()
      .from(dailySlots)
      .where(eq(dailySlots.scopeKey, PORTAL_SCOPE));
    expect(slots).toHaveLength(1);
  });

  it("hangman issuance is DAILY-SEEDED: same day → same seed for everyone", async () => {
    const alice = await seedDevice();
    const bob = await seedDevice();
    const a = await issueCountedAttempt(db, {
      deviceId: alice.deviceId,
      timeZone: alice.timeZone,
      gameId: "hangman",
    });
    const b = await issueCountedAttempt(db, {
      deviceId: bob.deviceId,
      timeZone: bob.timeZone,
      gameId: "hangman",
    });
    expect(a.kind).toBe("issued");
    expect(b.kind).toBe("issued");
    if (a.kind === "issued" && b.kind === "issued") {
      expect(a.seed).toBe(b.seed); // server-selected daily term
      expect(a.seed).toMatch(/^daily:hangman:v1:\d{4}-\d{2}-\d{2}$/);
    }
    // Non-daily games still get unique random seeds.
    const s1 = await issueCountedAttempt(db, {
      deviceId: (await seedDevice()).deviceId,
      timeZone: alice.timeZone,
      gameId: "snake",
    });
    const s2 = await issueCountedAttempt(db, {
      deviceId: (await seedDevice()).deviceId,
      timeZone: alice.timeZone,
      gameId: "snake",
    });
    if (s1.kind === "issued" && s2.kind === "issued") {
      expect(s1.seed).not.toBe(s2.seed);
    }
  });

  it("daily seed embeds the CONTENT VERSION (version-change vector)", () => {
    const day = "2026-07-18";
    expect(buildDailySeed("hangman", "v1", day)).toBe(
      "daily:hangman:v1:2026-07-18",
    );
    // A dictionary deployment bumps the version → different seed → the
    // day's term re-derives deliberately, never silently.
    expect(buildDailySeed("hangman", "v2", day)).not.toBe(
      buildDailySeed("hangman", "v1", day),
    );
    // Same version + same day stays stable.
    expect(buildDailySeed("hangman", "v1", day)).toBe(
      buildDailySeed("hangman", "v1", day),
    );
  });

  it("unknown game is rejected — including prototype keys", async () => {
    const device = await seedDevice();
    for (const gameId of [
      "tetris",
      "constructor",
      "hasOwnProperty",
      "__proto__",
    ]) {
      expect(
        (
          await issueCountedAttempt(db, {
            deviceId: device.deviceId,
            timeZone: device.timeZone,
            gameId,
          })
        ).kind,
        gameId,
      ).toBe("unknown_game");
    }
  });
});

describe("submission (§9.2/§9.3)", () => {
  async function issueSnake(device: { deviceId: string; timeZone: string }) {
    const result = await issueCountedAttempt(db, {
      deviceId: device.deviceId,
      timeZone: device.timeZone,
      gameId: "snake",
    });
    if (result.kind !== "issued")
      throw new Error(`issue failed: ${result.kind}`);
    return result;
  }

  it("accepts, completes the slot, writes board + streak + outbox atomically", async () => {
    const device = await seedDevice();
    const issued = await issueSnake(device);
    const result = await submitCountedResult(db, {
      deviceId: device.deviceId,
      attemptId: issued.attemptId,
      score: 12,
      clientDurationMs: 45_000,
    });
    expect(result.kind).toBe("accepted");
    if (result.kind === "accepted") {
      expect(result.score).toBe(12);
      expect(result.rank).toBe(1);
      expect(result.streak).toEqual({ current: 1, best: 1 });
      expect(result.seasonKey).toBe(seasonKeyFor(new Date()));
      expect(result.replay).toBe(false);
    }

    const [slot] = await db
      .select()
      .from(dailySlots)
      .where(eq(dailySlots.scopeKey, PORTAL_SCOPE));
    expect(slot.completedRunId).toBe(issued.attemptId);
    expect(await db.select().from(leaderboardScores)).toHaveLength(1);
    expect(
      await db
        .select()
        .from(analyticsOutbox)
        .where(eq(analyticsOutbox.aggregateId, issued.attemptId)),
    ).toHaveLength(1);

    // Day is spent: further issuance returns slot_used.
    const again = await issueCountedAttempt(db, {
      deviceId: device.deviceId,
      timeZone: device.timeZone,
      gameId: "snake",
    });
    expect(again.kind).toBe("slot_used");
  });

  it("submission replay returns the ORIGINAL result and writes nothing twice", async () => {
    const device = await seedDevice();
    const issued = await issueSnake(device);
    const first = await submitCountedResult(db, {
      deviceId: device.deviceId,
      attemptId: issued.attemptId,
      score: 7,
    });
    const replay = await submitCountedResult(db, {
      deviceId: device.deviceId,
      attemptId: issued.attemptId,
      score: 999, // hostile: replay must NOT overwrite
    });
    expect(replay.kind).toBe("accepted");
    if (first.kind === "accepted" && replay.kind === "accepted") {
      expect(replay.score).toBe(7);
      expect(replay.replay).toBe(true);
      expect(replay.streak).toEqual(first.streak);
    }
    expect(await db.select().from(leaderboardScores)).toHaveLength(1);
    const [row] = await db.select().from(streaks);
    expect(row.current).toBe(1); // not advanced twice
  });

  it("rejects out-of-envelope and non-integer scores", async () => {
    const device = await seedDevice();
    const issued = await issueSnake(device);
    expect(
      (
        await submitCountedResult(db, {
          deviceId: device.deviceId,
          attemptId: issued.attemptId,
          score: 1951, // snake envelope is the 1950 perfect run
          // (docs/games/snake-freebies.md)
        })
      ).kind,
    ).toBe("bad_score");
    expect(
      (
        await submitCountedResult(db, {
          deviceId: device.deviceId,
          attemptId: issued.attemptId,
          score: 3.5,
        })
      ).kind,
    ).toBe("bad_score");
    // Envelope rejection did not consume the attempt.
    const ok = await submitCountedResult(db, {
      deviceId: device.deviceId,
      attemptId: issued.attemptId,
      score: 42,
    });
    expect(ok.kind).toBe("accepted");
  });

  it("snake envelope: the perfect-run 1950 is accepted, 1951 is rejected (M2.5 review P2)", async () => {
    const device = await seedDevice();
    const issued = await issueSnake(device);
    expect(
      (
        await submitCountedResult(db, {
          deviceId: device.deviceId,
          attemptId: issued.attemptId,
          score: 1951, // one past the documented maximum
        })
      ).kind,
    ).toBe("bad_score");
    const max = await submitCountedResult(db, {
      deviceId: device.deviceId,
      attemptId: issued.attemptId,
      score: 1950, // docs/games/snake-freebies.md max-score vector
    });
    expect(max.kind).toBe("accepted");
  });

  it("flappy envelope: the perfect-run 1700 is accepted, 1701 is rejected (Bias Flap port)", async () => {
    const device = await seedDevice();
    const issued = await issueCountedAttempt(db, {
      deviceId: device.deviceId,
      timeZone: device.timeZone,
      gameId: "flappy",
    });
    if (issued.kind !== "issued")
      throw new Error(`issue failed: ${issued.kind}`);
    expect(
      (
        await submitCountedResult(db, {
          deviceId: device.deviceId,
          attemptId: issued.attemptId,
          score: 1701, // one past the 5-level perfect run
        })
      ).kind,
    ).toBe("bad_score");
    const max = await submitCountedResult(db, {
      deviceId: device.deviceId,
      attemptId: issued.attemptId,
      score: 1700, // docs/games/bias-flap.md max-score vector
    });
    expect(max.kind).toBe("accepted");
  });

  it("jumper envelope: 2490 is accepted and 2491 is rejected (Comeback Climb port)", async () => {
    const device = await seedDevice();
    const issued = await issueCountedAttempt(db, {
      deviceId: device.deviceId,
      timeZone: device.timeZone,
      gameId: "jumper",
    });
    if (issued.kind !== "issued")
      throw new Error(`issue failed: ${issued.kind}`);
    expect(
      (
        await submitCountedResult(db, {
          deviceId: device.deviceId,
          attemptId: issued.attemptId,
          score: 2491,
        })
      ).kind,
    ).toBe("bad_score");
    const max = await submitCountedResult(db, {
      deviceId: device.deviceId,
      attemptId: issued.attemptId,
      score: 2490,
    });
    expect(max.kind).toBe("accepted");
  });

  it("frogger envelope: the perfect-run 30 is accepted, 31 is rejected (5 levels, 2026-07-27)", async () => {
    const device = await seedDevice();
    const issued = await issueCountedAttempt(db, {
      deviceId: device.deviceId,
      timeZone: device.timeZone,
      gameId: "frogger",
    });
    if (issued.kind !== "issued")
      throw new Error(`issue failed: ${issued.kind}`);
    expect(
      (
        await submitCountedResult(db, {
          deviceId: device.deviceId,
          attemptId: issued.attemptId,
          score: 31, // one past the 5-level maximum (was 60 at 10 levels)
        })
      ).kind,
    ).toBe("bad_score");
    const max = await submitCountedResult(db, {
      deviceId: device.deviceId,
      attemptId: issued.attemptId,
      score: 30, // docs/games/frogger.md max-score vector
    });
    expect(max.kind).toBe("accepted");
  });

  it("freebie envelope: the perfect-run 2277 is accepted, 2278 is rejected (M2.5 review P1)", async () => {
    const device = await seedDevice();
    const issued = await issueCountedAttempt(db, {
      deviceId: device.deviceId,
      timeZone: device.timeZone,
      gameId: "freebie",
    });
    if (issued.kind !== "issued")
      throw new Error(`issue failed: ${issued.kind}`);
    expect(
      (
        await submitCountedResult(db, {
          deviceId: device.deviceId,
          attemptId: issued.attemptId,
          score: 2278, // one past the documented maximum
        })
      ).kind,
    ).toBe("bad_score");
    const max = await submitCountedResult(db, {
      deviceId: device.deviceId,
      attemptId: issued.attemptId,
      score: 2277, // docs/games/freebie.md max-score vector
    });
    expect(max.kind).toBe("accepted");
  });

  it.each([
    { gameId: "photocard-stack", maxScore: 1_016_000 },
    { gameId: "fanchant-hero", maxScore: 24_840 },
    { gameId: "bias-match", maxScore: 3450 },
    { gameId: "aegyo-pop", maxScore: 99_999 },
  ])(
    "$gameId envelope: the documented maximum is accepted and max + 1 is rejected",
    async ({ gameId, maxScore }) => {
      const device = await seedDevice();
      const issued = await issueCountedAttempt(db, {
        deviceId: device.deviceId,
        timeZone: device.timeZone,
        gameId,
      });
      if (issued.kind !== "issued")
        throw new Error(`issue failed: ${issued.kind}`);
      expect(
        (
          await submitCountedResult(db, {
            deviceId: device.deviceId,
            attemptId: issued.attemptId,
            score: maxScore + 1,
          })
        ).kind,
      ).toBe("bad_score");
      const max = await submitCountedResult(db, {
        deviceId: device.deviceId,
        attemptId: issued.attemptId,
        score: maxScore,
      });
      expect(max.kind).toBe("accepted");
    },
  );

  it("expired attempts are rejected and replaceable (OD-1: never burned)", async () => {
    const device = await seedDevice();
    const issued = await issueSnake(device);
    await db
      .update(runAttempts)
      .set({ expiresAt: new Date(Date.now() - 1000) })
      .where(eq(runAttempts.id, issued.attemptId));
    expect(
      (
        await submitCountedResult(db, {
          deviceId: device.deviceId,
          attemptId: issued.attemptId,
          score: 5,
        })
      ).kind,
    ).toBe("expired_attempt");

    // Re-issue replaces the expired attempt on the SAME slot.
    const reissued = await issueSnake(device);
    expect(reissued.attemptId).not.toBe(issued.attemptId);
    const submit = await submitCountedResult(db, {
      deviceId: device.deviceId,
      attemptId: reissued.attemptId,
      score: 5,
    });
    expect(submit.kind).toBe("accepted");
  });
});

describe("streak transitions (§9.3)", () => {
  it("consecutive days increment; a gap resets; best is retained", async () => {
    const device = await seedDevice();
    const today = "2026-07-17";
    // Seed an existing streak ending yesterday.
    await db.insert(streaks).values({
      deviceId: device.deviceId,
      current: 3,
      best: 5,
      lastDayKey: prevDayKey(today),
    });
    const issued = await issueCountedAttempt(db, {
      deviceId: device.deviceId,
      timeZone: device.timeZone,
      gameId: "snake",
    });
    if (issued.kind !== "issued") throw new Error("issue failed");
    // Force the slot's dayKey to the vector date for determinism.
    await db
      .update(dailySlots)
      .set({ dayKey: today })
      .where(eq(dailySlots.scopeKey, PORTAL_SCOPE));
    const result = await submitCountedResult(db, {
      deviceId: device.deviceId,
      attemptId: issued.attemptId,
      score: 1,
    });
    expect(result.kind).toBe("accepted");
    if (result.kind === "accepted") {
      expect(result.streak).toEqual({ current: 4, best: 5 });
    }
  });

  it("prevDayKey handles month/year boundaries", () => {
    expect(prevDayKey("2026-07-17")).toBe("2026-07-16");
    expect(prevDayKey("2026-03-01")).toBe("2026-02-28");
    expect(prevDayKey("2026-01-01")).toBe("2025-12-31");
  });

  it("seasonKeyFor matches ISO weeks (Monday 00:00 UTC reset)", () => {
    expect(seasonKeyFor(new Date("2026-07-17T12:00:00Z"))).toBe("2026-W29");
    expect(seasonKeyFor(new Date("2026-07-19T23:59:59Z"))).toBe("2026-W29"); // Sunday
    expect(seasonKeyFor(new Date("2026-07-20T00:00:00Z"))).toBe("2026-W30"); // Monday
    expect(seasonKeyFor(new Date("2026-01-01T00:00:00Z"))).toBe("2026-W01");
    expect(seasonKeyFor(new Date("2027-01-01T00:00:00Z"))).toBe("2026-W53");
  });

  it("a counted CLAW play advances the same portal streak", async () => {
    await db.insert(promotions).values({
      channel: "claw",
      kind: "demo",
      status: "active",
      rulesVersion: "demo-1",
      eligibilityVersion: "none",
      oddsVersion: "demo-45-35-20-v1",
      config: { weights: { win: 0.45, miss: 0.35, drop: 0.2 }, dailyCap: null },
    });
    const device = await seedDevice();
    const issued = await issueCountedAttempt(db, {
      deviceId: device.deviceId,
      timeZone: device.timeZone,
      gameId: "claw",
    });
    if (issued.kind !== "issued") throw new Error("issue failed");
    const play = await recordClawPlay(db, {
      deviceId: device.deviceId,
      timeZone: device.timeZone,
      idempotencyKey: "claw-streak-0001",
      attemptId: issued.attemptId,
    });
    expect(play.kind).toBe("played");
    const [row] = await db.select().from(streaks);
    expect(row.current).toBe(1);
    // And the portal day is spent.
    expect(
      (
        await issueCountedAttempt(db, {
          deviceId: device.deviceId,
          timeZone: device.timeZone,
          gameId: "snake",
        })
      ).kind,
    ).toBe("slot_used");
  });
});

describe("ranking policy (M2 review P1: one policy, flagged invisible)", () => {
  async function submitFor(score: number, timeZone = "America/Mexico_City") {
    const device = await seedDevice(timeZone);
    const issued = await issueCountedAttempt(db, {
      deviceId: device.deviceId,
      timeZone: device.timeZone,
      gameId: "snake",
    });
    if (issued.kind !== "issued") throw new Error("issue failed");
    const result = await submitCountedResult(db, {
      deviceId: device.deviceId,
      attemptId: issued.attemptId,
      score,
    });
    if (result.kind !== "accepted") throw new Error("submit failed");
    return { device, attemptId: issued.attemptId, result };
  }

  it("flagged scores vanish from top, me, AND rank counting", async () => {
    const a = await submitFor(30); // will be flagged
    const b = await submitFor(20);
    const c = await submitFor(10);
    await db
      .update(leaderboardScores)
      .set({ flagged: true })
      .where(eq(leaderboardScores.runId, a.attemptId));

    const seasonKey = seasonKeyFor(new Date());
    const board = await getSeasonBoard(
      db,
      "snake",
      seasonKey,
      b.device.deviceId,
    );
    // Top excludes the flagged 30 entirely.
    expect(board.top.map((r) => r.score)).toEqual([20, 10]);
    expect(board.top[0].rank).toBe(1); // not pushed down by the flagged row
    // me for the flagged device: no unflagged score → null.
    const flaggedBoard = await getSeasonBoard(
      db,
      "snake",
      seasonKey,
      a.device.deviceId,
    );
    expect(flaggedBoard.me).toBeNull();
    // rankForScore ignores flagged rows too.
    expect(await rankForScore(db, "snake", seasonKey, 10)).toBe(2);
    expect(c.device).toBeTruthy();
  });

  it("zero scores never place: hidden from top, me, rank, and receipt (pre-launch pass)", async () => {
    // The production symptom: two 0-point runs tied at #1 on an otherwise
    // empty board. Policy (MIN_PLACING_SCORE): a scoreless run is still a
    // real run — accepted, slot consumed, streak advanced — but it does
    // not PLACE anywhere.
    const zero = await submitFor(0);
    expect(zero.result.kind).toBe("accepted");
    if (zero.result.kind === "accepted") {
      expect(zero.result.rank).toBeNull(); // receipt says unplaced, not "#1"
      expect(zero.result.streak.current).toBe(1); // run still counted
    }

    const seasonKey = seasonKeyFor(new Date());
    let board = await getSeasonBoard(
      db,
      "snake",
      seasonKey,
      zero.device.deviceId,
    );
    expect(board.top).toEqual([]); // empty board, not "#1 — 0"
    expect(board.me).toBeNull(); // no personal placement either
    expect(await rankForScore(db, "snake", seasonKey, 0)).toBeNull();

    // A real score is unaffected — and is #1, not #2 behind a zero row.
    const placed = await submitFor(10);
    if (placed.result.kind === "accepted") {
      expect(placed.result.rank).toBe(1);
    }
    board = await getSeasonBoard(db, "snake", seasonKey, zero.device.deviceId);
    expect(board.top.map((r) => [r.rank, r.score])).toEqual([[1, 10]]);
    expect(board.me).toBeNull(); // the zero device still has no placement

    // Replay of the zero submission returns the same UNPLACED receipt.
    const replay = await submitCountedResult(db, {
      deviceId: zero.device.deviceId,
      attemptId: zero.attemptId,
      score: 999, // hostile rewrite attempt — replay must ignore it
    });
    expect(replay.kind).toBe("accepted");
    if (replay.kind === "accepted") {
      expect(replay.replay).toBe(true);
      expect(replay.score).toBe(0);
      expect(replay.rank).toBeNull();
    }
  });

  it("ties share a rank everywhere (competition ranking)", async () => {
    const a = await submitFor(15);
    const b = await submitFor(15);
    const c = await submitFor(9);
    const seasonKey = seasonKeyFor(new Date());
    const board = await getSeasonBoard(
      db,
      "snake",
      seasonKey,
      c.device.deviceId,
    );
    expect(board.top.map((r) => [r.rank, r.score])).toEqual([
      [1, 15],
      [1, 15],
      [3, 9],
    ]);
    expect(board.me).toEqual({ rank: 3, score: 9 });
    // Submission-time ranks agree with the board.
    expect(a.result.rank).toBe(1);
    expect(b.result.rank).toBe(1);
    expect(c.result.rank).toBe(3);
  });
});

describe("replay immutability (M2 review P1)", () => {
  it("replay returns the ACCEPTANCE receipt even after ranks/streaks move", async () => {
    const alice = await seedDevice();
    const issuedA = await issueCountedAttempt(db, {
      deviceId: alice.deviceId,
      timeZone: alice.timeZone,
      gameId: "snake",
    });
    if (issuedA.kind !== "issued") throw new Error("issue failed");
    const first = await submitCountedResult(db, {
      deviceId: alice.deviceId,
      attemptId: issuedA.attemptId,
      score: 10,
    });
    expect(first.kind).toBe("accepted");
    if (first.kind !== "accepted") return;
    expect(first.rank).toBe(1);

    // A competitor lands a higher score AND alice's stored streak changes.
    const bob = await seedDevice();
    const issuedB = await issueCountedAttempt(db, {
      deviceId: bob.deviceId,
      timeZone: bob.timeZone,
      gameId: "snake",
    });
    if (issuedB.kind !== "issued") throw new Error("issue failed");
    await submitCountedResult(db, {
      deviceId: bob.deviceId,
      attemptId: issuedB.attemptId,
      score: 99,
    });
    await db
      .update(streaks)
      .set({ current: 7, best: 9 })
      .where(eq(streaks.deviceId, alice.deviceId));

    const replay = await submitCountedResult(db, {
      deviceId: alice.deviceId,
      attemptId: issuedA.attemptId,
      score: 500, // hostile
    });
    expect(replay.kind).toBe("accepted");
    if (replay.kind === "accepted") {
      expect(replay.replay).toBe(true);
      expect(replay.score).toBe(10);
      expect(replay.rank).toBe(1); // rank AT ACCEPTANCE, not recomputed (2)
      expect(replay.streak).toEqual({ current: 1, best: 1 }); // receipt values
      expect(replay.seasonKey).toBe(first.seasonKey);
    }
  });
});

describe("cross-endpoint replay (M2 re-review P2)", () => {
  it("a counted CLAW attempt replayed via the GENERIC endpoint fails closed", async () => {
    await db.insert(promotions).values({
      channel: "claw",
      kind: "demo",
      status: "active",
      rulesVersion: "demo-1",
      eligibilityVersion: "none",
      oddsVersion: "demo-45-35-20-v1",
      config: { weights: { win: 0.45, miss: 0.35, drop: 0.2 }, dailyCap: null },
    });
    const device = await seedDevice();
    const issued = await issueCountedAttempt(db, {
      deviceId: device.deviceId,
      timeZone: device.timeZone,
      gameId: "claw",
    });
    if (issued.kind !== "issued") throw new Error("issue failed");
    const play = await recordClawPlay(db, {
      deviceId: device.deviceId,
      timeZone: device.timeZone,
      idempotencyKey: "cross-endpoint-01",
      attemptId: issued.attemptId,
    });
    expect(play.kind).toBe("played");

    // The attempt is submitted but has NO result_snapshot — the generic
    // endpoint must fail closed, never fabricate score/rank/streak zeros.
    const generic = await submitCountedResult(db, {
      deviceId: device.deviceId,
      attemptId: issued.attemptId,
      score: 0,
    });
    expect(generic.kind).toBe("invalid_attempt");

    // The claw endpoint still replays its own outcome.
    const clawReplay = await recordClawPlay(db, {
      deviceId: device.deviceId,
      timeZone: device.timeZone,
      idempotencyKey: "cross-endpoint-01",
      attemptId: issued.attemptId,
    });
    expect(clawReplay.kind).toBe("played");
    if (play.kind === "played" && clawReplay.kind === "played") {
      expect(clawReplay.outcome).toBe(play.outcome);
      expect(clawReplay.replay).toBe(true);
    }
  });
});

describe("effective streak (M2 review P1)", () => {
  it("today/yesterday keep current; a missed day reads zero; best survives", () => {
    const tz = "America/Mexico_City";
    const now = new Date("2026-07-17T20:00:00Z"); // local Jul 17
    expect(
      effectiveStreak(
        { current: 4, best: 6, lastDayKey: "2026-07-17" },
        tz,
        now,
      ),
    ).toEqual({ current: 4, best: 6 });
    expect(
      effectiveStreak(
        { current: 4, best: 6, lastDayKey: "2026-07-16" },
        tz,
        now,
      ),
    ).toEqual({ current: 4, best: 6 });
    expect(
      effectiveStreak(
        { current: 4, best: 6, lastDayKey: "2026-07-15" },
        tz,
        now,
      ),
    ).toEqual({ current: 0, best: 6 });
    expect(effectiveStreak(null, tz, now)).toEqual({ current: 0, best: 0 });
    // The stored row is untouched by display math — pure function only.
  });
});

describe("device locale (§12.1; M4 review P1/P2)", () => {
  it("creates the device with the resolved locale; touch persists changes and no-locale touches leave it alone", async () => {
    const created = await createDeviceSession(db, {
      timeZone: "America/Mexico_City",
      locale: "es-419",
    });
    // First-visit Spanish device: record is es-419 from the START.
    expect(created.device.locale).toBe("es-419");
    const rowAfterCreate = await db
      .select({ locale: devices.locale })
      .from(devices)
      .where(eq(devices.id, created.device.deviceId));
    expect(rowAfterCreate[0].locale).toBe("es-419");

    // Toggle to EN: touch persists the allowlisted change.
    await touchSession(db, created.token, created.device, undefined, "en");
    const rowAfterToggle = await db
      .select({ locale: devices.locale })
      .from(devices)
      .where(eq(devices.id, created.device.deviceId));
    expect(rowAfterToggle[0].locale).toBe("en");

    // A plain activity touch (no locale) never clobbers the record.
    await touchSession(
      db,
      created.token,
      { ...created.device, locale: "en" },
      undefined,
      undefined,
    );
    const rowAfterPlain = await db
      .select({ locale: devices.locale })
      .from(devices)
      .where(eq(devices.id, created.device.deviceId));
    expect(rowAfterPlain[0].locale).toBe("en");
  });
});
