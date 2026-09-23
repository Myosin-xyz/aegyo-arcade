// @vitest-environment node
import { afterAll, beforeAll, describe, expect, it } from "vitest";
import { drizzle } from "drizzle-orm/node-postgres";
import { sql } from "drizzle-orm";
import { Pool } from "pg";
import type { Db } from "@/db/client";
import { closeRound, finalizeRound } from "@/competition/operations-store";
import { memberRound, publicRound } from "@/competition/read";
import {
  digest,
  enroll,
  issueAttempt,
  receiveTrace,
  recomputeDailyBestTx,
  verifyAttempt,
} from "@/competition/store";
import {
  competitionScorePeriodKey,
  type RoundRulesV2,
} from "@/competition/rules";
import { positivePerfectTossTraceFixture } from "@/../tests/fixtures/competition-traces";

const TEST_URL = process.env.TEST_DATABASE_URL;
const integration = TEST_URL ? describe : describe.skip;

const ROUND = "70000000-0000-4000-8000-000000000001";
const MEMBER = "71000000-0000-4000-8000-000000000001";
const SECRET = "synthetic-monthly-rehearsal-secret-32-bytes";
const actor = {
  memberId: MEMBER,
  providerSessionId: "synthetic-monthly-rehearsal-session",
  emailVerified: true,
};

const rules: RoundRulesV2 = {
  version: 2,
  mode: "synthetic",
  dailyAttempts: 2,
  attemptTtlSeconds: 900,
  games: [
    {
      gameId: "snake",
      calibration: [
        { score: 0, points: 0 },
        { score: 50, points: 5 },
        { score: 100, points: 10 },
        { score: 300, points: 20 },
      ],
    },
    {
      gameId: "flappy",
      calibration: [
        { score: 0, points: 0 },
        { score: 1, points: 5 },
        { score: 5, points: 10 },
        { score: 10, points: 20 },
      ],
    },
    {
      gameId: "perfect-toss",
      calibration: [
        { score: 0, points: 0 },
        { score: 1, points: 5 },
        { score: 8, points: 10 },
        { score: 15, points: 20 },
      ],
    },
  ],
  cadence: "monthly",
  winnerCount: 3,
  scoring: {
    bestPerGame: "week",
    timeZone: "America/New_York",
    fullArenaBonusPoints: 10,
  },
};

integration("three-game prize-free monthly rehearsal", () => {
  let pool: Pool;
  let db: Db;

  beforeAll(async () => {
    process.env.ARCADE_COMPETITION_ENABLED = "true";
    process.env.ARCADE_SHARED_AUTH_ENABLED = "true";
    delete process.env.ARCADE_MATERIAL_COMPETITION_ENABLED;
    pool = new Pool({ connectionString: TEST_URL, max: 2 });
    db = drizzle(pool) as unknown as Db;
    await db.execute(sql`
      INSERT INTO account_members(id,issuer,subject)
      VALUES (${MEMBER}::uuid,'test','monthly-rehearsal-member')
    `);
    await db.execute(sql`
      INSERT INTO competition_profiles(member_id,username)
      VALUES (${MEMBER}::uuid,'monthly_rehearsal')
    `);
    await db.execute(sql`
      INSERT INTO competition_rounds(id,slug,rules,status,opens_at,closes_at)
      VALUES (${ROUND}::uuid,'three-game-synthetic-rehearsal',${JSON.stringify(rules)}::jsonb,
              'open',now()-interval '31 days',now()+interval '6 seconds')
    `);
  });

  afterAll(async () => pool?.end());

  /**
   * Historical setup only. The database clock cannot issue an attempt in an
   * already completed scoring week, so prior-week evidence is named and
   * isolated here. Every current-week attempt below uses the production API.
   */
  async function backfillHistoricalVerifiedBest(input: {
    attemptId: string;
    gameId: "snake" | "flappy" | "perfect-toss";
    periodKey: string;
    ordinal: 1 | 2;
    score: number;
    points: 0 | 5 | 10 | 20;
    receivedAt: string;
  }) {
    await db.execute(sql`
      INSERT INTO competition_attempts
        (id,round_id,member_id,provider_session_id,game_id,day_key,score_period_key,
         ordinal,idempotency_key,seed,status,issued_at,expires_at,received_at,
         security_confirmed,score,points)
      VALUES (${input.attemptId}::uuid,${ROUND}::uuid,${MEMBER}::uuid,'synthetic-session',
              ${input.gameId},${input.receivedAt.slice(0, 10)},${input.periodKey},${input.ordinal},
              ${`rehearsal-${input.attemptId}`},'synthetic-seed','verified',
              ${input.receivedAt}::timestamptz - interval '1 minute',
              ${input.receivedAt}::timestamptz + interval '14 minutes',
              ${input.receivedAt}::timestamptz,true,${input.score},${input.points})
    `);
    return db.transaction((tx) =>
      recomputeDailyBestTx(tx, {
        roundId: ROUND,
        memberId: MEMBER,
        gameId: input.gameId,
        scorePeriodKey: input.periodKey,
        reason: "synthetic_historical_rehearsal_backfill",
        rules,
      }),
    );
  }

  async function closeAfterDatabaseDeadline() {
    const deadline = Date.now() + 12_000;
    for (;;) {
      try {
        return await closeRound(db, {
          roundId: ROUND,
          actor: "synthetic-rehearsal-operator",
          idempotencyKey: "synthetic-rehearsal-close-01",
        });
      } catch (error) {
        if (
          !(error instanceof Error) ||
          !error.message.includes("has not reached its close time") ||
          Date.now() >= deadline
        )
          throw error;
        await new Promise((resolve) => setTimeout(resolve, 50));
      }
    }
  }

  it("uses production attempts for the active week, then snapshots and finalizes with no prizes", async () => {
    const currentWeek = competitionScorePeriodKey(rules, new Date());
    const priorWeekDate = new Date(`${currentWeek}T12:00:00.000Z`);
    priorWeekDate.setUTCDate(priorWeekDate.getUTCDate() - 7);
    const priorWeek = priorWeekDate.toISOString().slice(0, 10);
    const historicalTime = (dayOffset: number) => {
      const value = new Date(priorWeekDate);
      value.setUTCDate(value.getUTCDate() + dayOffset);
      return value.toISOString();
    };

    await expect(
      backfillHistoricalVerifiedBest({
        attemptId: "72000000-0000-4000-8000-000000000001",
        gameId: "snake",
        periodKey: priorWeek,
        ordinal: 1,
        score: 50,
        points: 5,
        receivedAt: historicalTime(0),
      }),
    ).resolves.toMatchObject({ points: 5, delta: 5, bonus: { points: 0 } });
    await expect(
      backfillHistoricalVerifiedBest({
        attemptId: "72000000-0000-4000-8000-000000000002",
        gameId: "snake",
        periodKey: priorWeek,
        ordinal: 1,
        score: 300,
        points: 20,
        receivedAt: historicalTime(1),
      }),
    ).resolves.toMatchObject({ points: 20, delta: 15, bonus: { points: 0 } });
    await backfillHistoricalVerifiedBest({
      attemptId: "72000000-0000-4000-8000-000000000003",
      gameId: "flappy",
      periodKey: priorWeek,
      ordinal: 1,
      score: 5,
      points: 10,
      receivedAt: historicalTime(2),
    });
    await expect(
      backfillHistoricalVerifiedBest({
        attemptId: "72000000-0000-4000-8000-000000000004",
        gameId: "perfect-toss",
        periodKey: priorWeek,
        ordinal: 1,
        score: 1,
        points: 5,
        receivedAt: historicalTime(3),
      }),
    ).resolves.toMatchObject({
      points: 5,
      delta: 5,
      bonus: { points: 10, delta: 10 },
    });

    await expect(enroll(db, actor, ROUND, digest(rules))).resolves.toEqual({
      enrolled: true,
    });
    const first = await issueAttempt(
      db,
      actor,
      {
        roundId: ROUND,
        gameId: "perfect-toss",
        idempotencyKey: "monthly_rehearsal_attempt_01",
      },
      SECRET,
    );
    const second = await issueAttempt(
      db,
      actor,
      {
        roundId: ROUND,
        gameId: "perfect-toss",
        idempotencyKey: "monthly_rehearsal_attempt_02",
      },
      SECRET,
    );
    expect(first).toMatchObject({ reissued: false, remaining: 1 });
    expect(second).toMatchObject({ reissued: false, remaining: 0 });
    expect(second.seed).toBe(first.seed);
    await expect(
      issueAttempt(
        db,
        actor,
        {
          roundId: ROUND,
          gameId: "perfect-toss",
          idempotencyKey: "monthly_rehearsal_attempt_03",
        },
        SECRET,
      ),
    ).rejects.toMatchObject({ code: "daily_limit_reached" });

    const fixture = positivePerfectTossTraceFixture(first.seed);
    await new Promise((resolve) =>
      setTimeout(resolve, Math.max(0, fixture.durationMs - 750)),
    );
    for (const issued of [first, second]) {
      await expect(
        receiveTrace(db, actor, issued.attemptId, fixture.trace, true),
      ).resolves.toMatchObject({ status: "pending", replayed: false });
      await expect(verifyAttempt(db, issued.attemptId)).resolves.toMatchObject({
        status: "verified",
        score: 1,
        points: 5,
        scorePeriodKey: currentWeek,
        scorePeriodPoints: 5,
      });
    }

    const ledgerTotal = await db.execute(sql`
      SELECT coalesce(sum(delta),0)::int AS total
      FROM competition_ledger
      WHERE round_id=${ROUND}::uuid AND member_id=${MEMBER}::uuid
    `);
    // Prior week: 20 + 10 + 5 + 10 bonus. Current week: one 5-point best.
    expect(ledgerTotal.rows[0]?.total).toBe(50);

    const bests = await db.execute(sql`
      SELECT period_key,game_id,points
      FROM competition_period_best
      WHERE round_id=${ROUND}::uuid
      ORDER BY period_key,game_id
    `);
    expect(bests.rows).toHaveLength(4);
    expect(
      bests.rows.find(
        (row) => row.period_key === priorWeek && row.game_id === "snake",
      ),
    ).toMatchObject({ points: 20 });
    expect(
      bests.rows.filter((row) => row.game_id === "perfect-toss"),
    ).toHaveLength(2);

    await expect(memberRound(db, MEMBER, true, ROUND)).resolves.toMatchObject({
      currentPeriod: {
        periodKey: currentWeek,
        completedGames: 1,
        eligibleGames: 3,
        games: expect.arrayContaining([
          { gameId: "snake", points: 0, completed: false },
          { gameId: "flappy", points: 0, completed: false },
          { gameId: "perfect-toss", points: 5, completed: true },
        ]),
        fullArena: {
          configuredPoints: 10,
          earned: false,
          earnedPoints: 0,
        },
      },
    });

    const closed = await closeAfterDatabaseDeadline();
    expect(closed.kind).toBe("snapshot");
    if (closed.kind !== "snapshot") throw new Error("snapshot expected");
    expect(closed.snapshot.source_digest).toMatch(/^[0-9a-f]{64}$/);
    expect(closed.snapshot.standings).toEqual([
      expect.objectContaining({
        memberId: MEMBER,
        totalPoints: 50,
        topTierResults: 1,
        provisionalRank: 1,
        requiresReview: false,
      }),
    ]);
    expect(
      closed.snapshot.game_high_scores.map((item) => item.gameId).sort(),
    ).toEqual(["flappy", "perfect-toss", "snake"]);
    await expect(
      closeRound(db, {
        roundId: ROUND,
        actor: "synthetic-rehearsal-operator",
        idempotencyKey: "synthetic-rehearsal-close-01",
      }),
    ).resolves.toMatchObject({ kind: "snapshot", repeated: true });

    const finalized = await finalizeRound(db, {
      roundId: ROUND,
      approvedBy: "synthetic-rehearsal-operator",
      idempotencyKey: "synthetic-rehearsal-finalize-01",
      tieDecisions: [],
      awards: [],
    });
    expect(finalized).toMatchObject({ repeated: false });
    expect(finalized.standings).toEqual([
      expect.objectContaining({ memberId: MEMBER, finalRank: 1 }),
    ]);
    await expect(
      finalizeRound(db, {
        roundId: ROUND,
        approvedBy: "synthetic-rehearsal-operator",
        idempotencyKey: "synthetic-rehearsal-finalize-01",
        tieDecisions: [],
        awards: [],
      }),
    ).resolves.toMatchObject({ repeated: true });

    const awards = await db.execute(sql`
      SELECT count(*)::int AS count
      FROM competition_award_claims
      WHERE round_id=${ROUND}::uuid
    `);
    expect(awards.rows[0]?.count).toBe(0);
    const published = await publicRound(db, "three-game-synthetic-rehearsal");
    expect(published).toMatchObject({
      provisional: false,
      standings: [{ username: "monthly_rehearsal", totalPoints: 50, rank: 1 }],
    });
    process.env.ARCADE_COMPETITION_ENABLED = "false";
    try {
      await expect(
        publicRound(db, "three-game-synthetic-rehearsal"),
      ).rejects.toMatchObject({ code: "not_found", status: 404 });
    } finally {
      process.env.ARCADE_COMPETITION_ENABLED = "true";
    }
    await expect(
      publicRound(db, "three-game-synthetic-rehearsal"),
    ).resolves.toMatchObject({
      round: { id: ROUND, status: "final" },
      standings: published.standings,
    });
    await expect(memberRound(db, MEMBER, false, ROUND)).resolves.toMatchObject({
      currentPeriod: null,
    });
  }, 20_000);
});
