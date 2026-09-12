// @vitest-environment node
import { afterAll, beforeAll, describe, expect, it } from "vitest";
import { drizzle } from "drizzle-orm/node-postgres";
import { sql } from "drizzle-orm";
import { Pool } from "pg";
import type { Db } from "@/db/client";
import {
  claimAward,
  closeRound,
  disqualifyAttempt,
  finalizeRound,
  fulfillAward,
} from "@/competition/operations-store";
import { memberRound, publicRound } from "@/competition/read";

const TEST_URL = process.env.TEST_DATABASE_URL;
const integration = TEST_URL ? describe : describe.skip;

integration("competition closure operations", () => {
  let pool: Pool;
  let db: Db;
  const roundId = "10000000-0000-4000-8000-000000000001";
  const openRoundId = "10000000-0000-4000-8000-000000000002";
  const alice = "20000000-0000-4000-8000-000000000001";
  const bob = "20000000-0000-4000-8000-000000000002";
  const attemptA = "30000000-0000-4000-8000-000000000001";
  const attemptB = "30000000-0000-4000-8000-000000000002";
  const pendingAttempt = "30000000-0000-4000-8000-000000000003";
  const dqAttempt = "30000000-0000-4000-8000-000000000004";
  const rules = {
    version: 1,
    mode: "synthetic",
    dailyAttempts: 3,
    attemptTtlSeconds: 300,
    games: [
      {
        gameId: "snake",
        calibration: [
          { score: 0, points: 0 },
          { score: 10, points: 1000 },
        ],
      },
    ],
  };

  beforeAll(async () => {
    process.env.ARCADE_COMPETITION_ENABLED = "true";
    pool = new Pool({ connectionString: TEST_URL, max: 2 });
    db = drizzle(pool) as unknown as Db;
    await db.execute(sql`INSERT INTO account_members(id,issuer,subject) VALUES
      (${alice}::uuid,'test','alice'),(${bob}::uuid,'test','bob')`);
    await db.execute(sql`INSERT INTO competition_profiles(member_id,username) VALUES
      (${alice}::uuid,'alice'),(${bob}::uuid,'bob')`);
    await db.execute(sql`INSERT INTO competition_rounds(id,slug,rules,status,opens_at,closes_at) VALUES
      (${roundId}::uuid,'closed-rehearsal',${JSON.stringify(rules)}::jsonb,'open',now()-interval '2 days',now()-interval '1 day'),
      (${openRoundId}::uuid,'dq-rehearsal',${JSON.stringify(rules)}::jsonb,'open',now()-interval '1 day',now()+interval '1 day')`);
    await db.execute(sql`INSERT INTO competition_enrollments(round_id,member_id,rules_digest) VALUES
      (${roundId}::uuid,${alice}::uuid,${"a".repeat(64)}),
      (${roundId}::uuid,${bob}::uuid,${"a".repeat(64)})`);
    await db.execute(sql`INSERT INTO competition_attempts
      (id,round_id,member_id,provider_session_id,game_id,day_key,ordinal,idempotency_key,seed,status,issued_at,expires_at,received_at,security_confirmed,score,points)
      VALUES
      (${attemptA}::uuid,${roundId}::uuid,${alice}::uuid,'a','snake','2026-09-01',1,'attempt-alice-0001','s','verified',now()-interval '2 days',now()-interval '1 day',now()-interval '30 hours',true,1,10),
      (${attemptB}::uuid,${roundId}::uuid,${bob}::uuid,'b','snake','2026-09-01',1,'attempt-bob-000001','s','verified',now()-interval '2 days',now()-interval '1 day',now()-interval '30 hours',true,1,10),
      (${pendingAttempt}::uuid,${roundId}::uuid,${alice}::uuid,'a','snake','2026-09-01',2,'attempt-pending-01','s','pending',now()-interval '2 days',now()-interval '1 day',now()-interval '30 hours',false,null,null),
      (${dqAttempt}::uuid,${openRoundId}::uuid,${alice}::uuid,'a','snake','2026-09-02',1,'attempt-dq-0000001','s','verified',now()-interval '2 hours',now()+interval '1 hour',now()-interval '1 hour',true,2,20)`);
    await db.execute(sql`INSERT INTO competition_daily_best(round_id,member_id,game_id,day_key,attempt_id,points,received_at) VALUES
      (${roundId}::uuid,${alice}::uuid,'snake','2026-09-01',${attemptA}::uuid,10,now()-interval '30 hours'),
      (${roundId}::uuid,${bob}::uuid,'snake','2026-09-01',${attemptB}::uuid,10,now()-interval '30 hours'),
      (${openRoundId}::uuid,${alice}::uuid,'snake','2026-09-02',${dqAttempt}::uuid,20,now()-interval '1 hour')`);
  });

  afterAll(async () => pool?.end());

  it("settles pending work, freezes a candidate, reviews shared ties, and fulfills once", async () => {
    expect(
      await closeRound(db, {
        roundId,
        actor: "operator",
        idempotencyKey: "close-1",
      }),
    ).toEqual({
      kind: "awaiting_pending",
      pendingCount: 1,
    });
    await db.execute(
      sql`UPDATE competition_attempts SET status='rejected' WHERE id=${pendingAttempt}::uuid`,
    );
    const closed = await closeRound(db, {
      roundId,
      actor: "operator",
      idempotencyKey: "close-2",
    });
    expect(closed.kind).toBe("snapshot");
    if (closed.kind !== "snapshot") throw new Error("snapshot expected");
    expect(closed.snapshot.standings.map((row) => row.provisionalRank)).toEqual(
      [1, 1],
    );
    expect(
      (
        await closeRound(db, {
          roundId,
          actor: "operator",
          idempotencyKey: "close-2",
        })
      ).kind,
    ).toBe("snapshot");

    const tieKey = closed.snapshot.standings[0].exactTieKey!;
    const finalized = await finalizeRound(db, {
      roundId,
      approvedBy: "operator",
      idempotencyKey: "final-1",
      tieDecisions: [
        {
          exactTieKey: tieKey,
          resolution: "shared_rank",
          memberIds: [alice, bob],
          rationale: "Published rehearsal rule",
        },
      ],
      awards: [
        {
          memberId: alice,
          awardKey: "synthetic-slot-a",
          allocationRationale: "Published rehearsal allocation",
        },
        {
          memberId: bob,
          awardKey: "synthetic-slot-b",
          allocationRationale: "Published rehearsal allocation",
        },
      ],
    });
    expect(finalized.standings.map((row) => row.finalRank)).toEqual([1, 1]);
    const published = await publicRound(db, "closed-rehearsal");
    expect(published.provisional).toBe(false);
    expect(published.standings.map((row) => row.rank)).toEqual([1, 1]);
    expect(published.gameHighScores).toEqual([
      { gameId: "snake", username: "alice", score: 1 },
      { gameId: "snake", username: "bob", score: 1 },
    ]);
    const award = (
      await db.execute(
        sql`SELECT id FROM competition_award_claims WHERE member_id=${alice}::uuid`,
      )
    ).rows[0];
    expect((await memberRound(db, alice, true, roundId)).awards).toEqual([
      expect.objectContaining({
        id: award.id,
        awardKey: "synthetic-slot-a",
        status: "unclaimed",
        rank: 1,
      }),
    ]);
    await expect(
      claimAward(db, {
        awardId: award.id as string,
        memberId: bob,
        proof: { acceptedInstructions: true },
        idempotencyKey: "claim-1",
      }),
    ).rejects.toMatchObject({ code: "award_not_found", status: 404 });
    expect(
      await claimAward(db, {
        awardId: award.id as string,
        memberId: alice,
        proof: { acceptedInstructions: true },
        idempotencyKey: "claim-1",
      }),
    ).toEqual({ status: "claimed", repeated: false });
    expect(
      await claimAward(db, {
        awardId: award.id as string,
        memberId: alice,
        proof: { acceptedInstructions: true },
        idempotencyKey: "claim-1",
      }),
    ).toEqual({ status: "claimed", repeated: true });
    await expect(
      claimAward(db, {
        awardId: award.id as string,
        memberId: alice,
        proof: { acceptedInstructions: true },
        idempotencyKey: "claim-changed-0001",
      }),
    ).rejects.toMatchObject({ code: "award_claim_conflict", status: 409 });
    expect(
      await fulfillAward(db, {
        awardId: award.id as string,
        actor: "operator",
        fulfillmentKey: "manual-rehearsal-1",
        reason: "Synthetic rehearsal completion",
        idempotencyKey: "fulfill-1",
      }),
    ).toEqual({ status: "fulfilled", repeated: false });
    expect(
      await fulfillAward(db, {
        awardId: award.id as string,
        actor: "operator",
        fulfillmentKey: "manual-rehearsal-1",
        reason: "Synthetic rehearsal completion",
        idempotencyKey: "fulfill-1",
      }),
    ).toEqual({ status: "fulfilled", repeated: true });
    const bobAward = (
      await db.execute(
        sql`SELECT id FROM competition_award_claims WHERE member_id=${bob}::uuid`,
      )
    ).rows[0];
    await claimAward(db, {
      awardId: bobAward.id as string,
      memberId: bob,
      proof: { acceptedInstructions: true },
      idempotencyKey: "claim-bob-000001",
    });
    await expect(
      fulfillAward(db, {
        awardId: bobAward.id as string,
        actor: "operator",
        fulfillmentKey: "manual-rehearsal-2",
        reason: "Synthetic rehearsal completion",
        idempotencyKey: "fulfill-1",
      }),
    ).rejects.toThrow();
    expect(
      (
        await db.execute(
          sql`SELECT status FROM competition_award_claims WHERE id=${bobAward.id as string}::uuid`,
        )
      ).rows[0].status,
    ).toBe("claimed");
    await expect(
      db.execute(
        sql`UPDATE competition_operation_audit SET actor='tampered' WHERE round_id=${roundId}::uuid`,
      ),
    ).rejects.toThrow();
    expect(
      await claimAward(db, {
        awardId: award.id as string,
        memberId: alice,
        proof: { acceptedInstructions: true },
        idempotencyKey: "claim-1",
      }),
    ).toEqual({ status: "fulfilled", repeated: true });
  });

  it("audits disqualification and recomputes the daily best", async () => {
    expect(
      await disqualifyAttempt(db, {
        roundId: openRoundId,
        attemptId: dqAttempt,
        actor: "operator",
        reason: "synthetic_rehearsal",
        idempotencyKey: "dq-1",
      }),
    ).toEqual({ repeated: false });
    expect(
      (
        await db.execute(
          sql`SELECT * FROM competition_daily_best WHERE round_id=${openRoundId}::uuid`,
        )
      ).rows,
    ).toHaveLength(0);
    expect(
      (
        await db.execute(
          sql`SELECT delta FROM competition_ledger WHERE round_id=${openRoundId}::uuid`,
        )
      ).rows[0].delta,
    ).toBe(-20);
  });
});
