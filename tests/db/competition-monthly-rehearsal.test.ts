// @vitest-environment node
import { afterAll, beforeAll, describe, expect, it } from "vitest";
import { drizzle } from "drizzle-orm/node-postgres";
import { sql } from "drizzle-orm";
import { Pool } from "pg";
import type { Db } from "@/db/client";
import { closeRound, finalizeRound } from "@/competition/operations-store";
import { publicRound } from "@/competition/read";
import { recomputeDailyBestTx } from "@/competition/store";
import type { RoundRulesV2 } from "@/competition/rules";

const TEST_URL = process.env.TEST_DATABASE_URL;
const integration = TEST_URL ? describe : describe.skip;

const ROUND = "70000000-0000-4000-8000-000000000001";
const MEMBER = "71000000-0000-4000-8000-000000000001";
const WEEK_ONE = "2026-09-07";
const WEEK_TWO = "2026-09-14";

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
              'open',now()-interval '31 days',now()-interval '1 second')
    `);
    await db.execute(sql`
      INSERT INTO competition_enrollments(round_id,member_id,rules_digest)
      VALUES (${ROUND}::uuid,${MEMBER}::uuid,${"a".repeat(64)})
    `);
  });

  afterAll(async () => pool?.end());

  async function addVerifiedBest(input: {
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
        reason: "synthetic_monthly_rehearsal",
        rules,
      }),
    );
  }

  it("keeps weekly bests, awards dynamic Full Arena, then snapshots and finalizes with no prizes", async () => {
    await expect(
      addVerifiedBest({
        attemptId: "72000000-0000-4000-8000-000000000001",
        gameId: "snake",
        periodKey: WEEK_ONE,
        ordinal: 1,
        score: 50,
        points: 5,
        receivedAt: "2026-09-07T15:00:00.000Z",
      }),
    ).resolves.toMatchObject({ points: 5, delta: 5, bonus: { points: 0 } });
    await expect(
      addVerifiedBest({
        attemptId: "72000000-0000-4000-8000-000000000002",
        gameId: "snake",
        periodKey: WEEK_ONE,
        ordinal: 2,
        score: 300,
        points: 20,
        receivedAt: "2026-09-08T15:00:00.000Z",
      }),
    ).resolves.toMatchObject({ points: 20, delta: 15, bonus: { points: 0 } });
    await addVerifiedBest({
      attemptId: "72000000-0000-4000-8000-000000000003",
      gameId: "flappy",
      periodKey: WEEK_ONE,
      ordinal: 1,
      score: 5,
      points: 10,
      receivedAt: "2026-09-09T15:00:00.000Z",
    });
    await expect(
      addVerifiedBest({
        attemptId: "72000000-0000-4000-8000-000000000004",
        gameId: "perfect-toss",
        periodKey: WEEK_ONE,
        ordinal: 1,
        score: 1,
        points: 5,
        receivedAt: "2026-09-10T15:00:00.000Z",
      }),
    ).resolves.toMatchObject({
      points: 5,
      delta: 5,
      bonus: { points: 10, delta: 10 },
    });

    const rehearsalGames = rules.games.filter(
      (
        game,
      ): game is (typeof rules.games)[number] & {
        gameId: "snake" | "flappy" | "perfect-toss";
      } => game.gameId !== "hangman",
    );
    for (const [index, game] of rehearsalGames.entries()) {
      await addVerifiedBest({
        attemptId: `73000000-0000-4000-8000-${String(index + 1).padStart(12, "0")}`,
        gameId: game.gameId,
        periodKey: WEEK_TWO,
        ordinal: 1,
        score: game.calibration.at(-1)!.score,
        points: 20,
        receivedAt: `2026-09-${14 + index}T15:00:00.000Z`,
      });
    }

    const ledgerTotal = await db.execute(sql`
      SELECT coalesce(sum(delta),0)::int AS total
      FROM competition_ledger
      WHERE round_id=${ROUND}::uuid AND member_id=${MEMBER}::uuid
    `);
    // Week one: 20 + 10 + 5 + 10 bonus. Week two: 20 * 3 + 10 bonus.
    expect(ledgerTotal.rows[0]?.total).toBe(115);

    const bests = await db.execute(sql`
      SELECT period_key,game_id,points
      FROM competition_period_best
      WHERE round_id=${ROUND}::uuid
      ORDER BY period_key,game_id
    `);
    expect(bests.rows).toHaveLength(6);
    expect(
      bests.rows.find(
        (row) => row.period_key === WEEK_ONE && row.game_id === "snake",
      ),
    ).toMatchObject({ points: 20 });
    expect(
      bests.rows.filter((row) => row.game_id === "perfect-toss"),
    ).toHaveLength(2);

    const closed = await closeRound(db, {
      roundId: ROUND,
      actor: "synthetic-rehearsal-operator",
      idempotencyKey: "synthetic-rehearsal-close-01",
    });
    expect(closed.kind).toBe("snapshot");
    if (closed.kind !== "snapshot") throw new Error("snapshot expected");
    expect(closed.snapshot.source_digest).toMatch(/^[0-9a-f]{64}$/);
    expect(closed.snapshot.standings).toEqual([
      expect.objectContaining({
        memberId: MEMBER,
        totalPoints: 115,
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
    expect(
      await publicRound(db, "three-game-synthetic-rehearsal"),
    ).toMatchObject({
      provisional: false,
      standings: [{ username: "monthly_rehearsal", totalPoints: 115, rank: 1 }],
    });
  });
});
