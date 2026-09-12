import { randomUUID } from "node:crypto";
import { sql } from "drizzle-orm";
import type { Db } from "@/db/client";
import { digest, lockRound, recomputeDailyBestTx } from "@/competition/store";
import {
  applyTieReview,
  rankCandidateStandings,
  type CandidateStanding,
  type FinalStanding,
  type TieReviewDecision,
} from "./operations";
import {
  assertRoundAvailable,
  competitionEnabled,
  type RoundRules,
} from "./rules";

type SqlRows<T> = { rows: T[] };
type RoundRow = {
  id: string;
  status: string;
  closes_at: Date;
  rules: RoundRules;
};
type SnapshotRow = {
  id: string;
  standings: CandidateStanding[];
  source_digest: string;
  created_at: Date;
};

export type CloseRoundResult =
  | { kind: "awaiting_pending"; pendingCount: number }
  | { kind: "snapshot"; snapshot: SnapshotRow; repeated: boolean };

export type FinalAward = {
  memberId: string;
  awardKey: string;
  allocationRationale: string;
};

function rows<T>(result: unknown): T[] {
  return (result as SqlRows<T>).rows;
}

function asDate(value: Date | string): Date {
  return value instanceof Date ? value : new Date(value);
}

function requireText(value: string, label: string): void {
  if (!value.trim()) throw new Error(`${label} is required`);
}

function requireOperationsEnabled(): void {
  if (!competitionEnabled()) throw new Error("Arcade competition is disabled");
}

export async function closeRound(
  db: Db,
  input: { roundId: string; actor: string; idempotencyKey: string },
): Promise<CloseRoundResult> {
  requireOperationsEnabled();
  requireText(input.actor, "actor");
  requireText(input.idempotencyKey, "idempotencyKey");
  return db.transaction(async (tx) => {
    const lockedRound = await lockRound(tx, input.roundId);
    assertRoundAvailable(lockedRound.rules);
    const existing = rows<SnapshotRow>(
      await tx.execute(sql`
        SELECT id, standings, source_digest, created_at
          FROM competition_candidate_snapshots
         WHERE round_id = ${input.roundId}
      `),
    )[0];
    if (existing)
      return {
        kind: "snapshot",
        snapshot: { ...existing, created_at: asDate(existing.created_at) },
        repeated: true,
      };

    const round = rows<RoundRow>(
      await tx.execute(sql`
        SELECT id, status, closes_at, rules FROM competition_rounds
         WHERE id = ${input.roundId} FOR UPDATE
      `),
    )[0];
    if (!round) throw new Error("Competition round not found");
    if (!["open", "closing"].includes(round.status)) {
      throw new Error(`Round cannot close from ${round.status}`);
    }
    const clock = asDate(
      rows<{ now: Date | string }>(
        await tx.execute(sql`SELECT now() AS now`),
      )[0].now,
    );
    const closesAt = asDate(round.closes_at);
    if (clock < closesAt)
      throw new Error("Competition round has not reached its close time");
    if (round.status === "open") {
      await tx.execute(
        sql`UPDATE competition_rounds SET status = 'closing' WHERE id = ${input.roundId}`,
      );
    }

    const pending = rows<{ count: string }>(
      await tx.execute(sql`
        SELECT count(*)::text AS count FROM competition_attempts
         WHERE round_id = ${input.roundId}
           AND status = 'pending'
           AND received_at < ${closesAt}
      `),
    );
    const pendingCount = Number(pending[0]?.count ?? 0);
    if (pendingCount > 0) return { kind: "awaiting_pending", pendingCount };

    const source = rows<{
      member_id: string;
      day_key: string;
      points: number;
      received_at: Date;
      attempt_id: string;
    }>(
      await tx.execute(sql`
        SELECT b.member_id, b.day_key, b.points, b.received_at, b.attempt_id
          FROM competition_daily_best b
          JOIN competition_attempts a ON a.id = b.attempt_id
         WHERE b.round_id = ${input.roundId}
           AND b.points > 0 AND a.status = 'verified'
         ORDER BY b.member_id, b.day_key, b.game_id, b.attempt_id
      `),
    );
    const standings = rankCandidateStandings(
      source.map((item) => ({
        memberId: item.member_id,
        dayKey: item.day_key,
        points: item.points,
        receivedAt: asDate(item.received_at),
      })),
    );
    const snapshot: SnapshotRow = {
      id: randomUUID(),
      standings,
      source_digest: digest(
        source.map((item) => ({
          ...item,
          received_at: asDate(item.received_at).toISOString(),
        })),
      ),
      created_at: clock,
    };
    await tx.execute(sql`
      INSERT INTO competition_candidate_snapshots
        (id, round_id, standings, source_digest, created_at)
      VALUES (${snapshot.id}, ${input.roundId}, ${JSON.stringify(standings)}::jsonb,
              ${snapshot.source_digest}, ${clock})
    `);
    await tx.execute(sql`
      INSERT INTO competition_operation_audit
        (id, round_id, operation, actor, idempotency_key, payload, created_at)
      VALUES (${randomUUID()}, ${input.roundId}, 'close', ${input.actor},
              ${input.idempotencyKey}, ${JSON.stringify({ snapshotId: snapshot.id, sourceDigest: snapshot.source_digest })}::jsonb, ${clock})
      ON CONFLICT (round_id, operation, idempotency_key) DO NOTHING
    `);
    await tx.execute(
      sql`UPDATE competition_rounds SET status = 'review' WHERE id = ${input.roundId}`,
    );
    return { kind: "snapshot", snapshot, repeated: false };
  });
}

export async function finalizeRound(
  db: Db,
  input: {
    roundId: string;
    approvedBy: string;
    idempotencyKey: string;
    tieDecisions: TieReviewDecision[];
    awards: FinalAward[];
  },
): Promise<{
  finalResultId: string;
  standings: FinalStanding[];
  repeated: boolean;
}> {
  requireOperationsEnabled();
  requireText(input.approvedBy, "approvedBy");
  requireText(input.idempotencyKey, "idempotencyKey");
  return db.transaction(async (tx) => {
    const lockedRound = await lockRound(tx, input.roundId);
    assertRoundAvailable(lockedRound.rules);
    const existing = rows<{ id: string; standings: FinalStanding[] }>(
      await tx.execute(
        sql`SELECT id, standings FROM competition_final_results WHERE round_id = ${input.roundId}`,
      ),
    )[0];
    if (existing)
      return {
        finalResultId: existing.id,
        standings: existing.standings,
        repeated: true,
      };
    const round = rows<{ status: string }>(
      await tx.execute(
        sql`SELECT status,rules FROM competition_rounds WHERE id = ${input.roundId} FOR UPDATE`,
      ),
    )[0];
    if (!round) throw new Error("Competition round not found");
    if (round.status !== "review")
      throw new Error(`Round cannot finalize from ${round.status}`);
    const snapshot = rows<{ id: string; standings: CandidateStanding[] }>(
      await tx.execute(
        sql`SELECT id, standings FROM competition_candidate_snapshots WHERE round_id = ${input.roundId}`,
      ),
    )[0];
    if (!snapshot) throw new Error("Candidate snapshot not found");
    const standings = applyTieReview(snapshot.standings, input.tieDecisions);
    const byMember = new Map(standings.map((item) => [item.memberId, item]));
    const awardPairs = new Set<string>();
    for (const award of input.awards) {
      requireText(award.awardKey, "awardKey");
      requireText(award.allocationRationale, "allocationRationale");
      if (!byMember.has(award.memberId))
        throw new Error(`Award member ${award.memberId} is not a finalist`);
      const pair = `${award.memberId}\0${award.awardKey}`;
      if (awardPairs.has(pair)) throw new Error("Duplicate award allocation");
      awardPairs.add(pair);
    }
    const now = asDate(
      rows<{ now: Date | string }>(
        await tx.execute(sql`SELECT now() AS now`),
      )[0].now,
    );
    const finalResultId = randomUUID();
    await tx.execute(sql`
      INSERT INTO competition_final_results
        (id, round_id, candidate_snapshot_id, standings, review, approved_by, approved_at)
      VALUES (${finalResultId}, ${input.roundId}, ${snapshot.id}, ${JSON.stringify(standings)}::jsonb,
              ${JSON.stringify({ tieDecisions: input.tieDecisions, awards: input.awards })}::jsonb,
              ${input.approvedBy}, ${now})
    `);
    for (const award of input.awards) {
      await tx.execute(sql`
        INSERT INTO competition_award_claims
          (id, final_result_id, round_id, member_id, final_rank, award_key, status, created_at)
        VALUES (${randomUUID()}, ${finalResultId}, ${input.roundId}, ${award.memberId},
                ${byMember.get(award.memberId)!.finalRank}, ${award.awardKey}, 'unclaimed', ${now})
      `);
    }
    await tx.execute(sql`
      INSERT INTO competition_operation_audit
        (id, round_id, operation, actor, idempotency_key, payload, created_at)
      VALUES (${randomUUID()}, ${input.roundId}, 'finalize', ${input.approvedBy}, ${input.idempotencyKey},
              ${JSON.stringify({ finalResultId, awardCount: input.awards.length })}::jsonb, ${now})
    `);
    await tx.execute(
      sql`UPDATE competition_rounds SET status = 'final' WHERE id = ${input.roundId}`,
    );
    return { finalResultId, standings, repeated: false };
  });
}

export async function disqualifyAttempt(
  db: Db,
  input: {
    roundId: string;
    attemptId: string;
    actor: string;
    reason: string;
    idempotencyKey: string;
  },
): Promise<{ repeated: boolean }> {
  requireOperationsEnabled();
  requireText(input.actor, "actor");
  requireText(input.reason, "reason");
  requireText(input.idempotencyKey, "idempotencyKey");
  return db.transaction(async (tx) => {
    const lockedRound = await lockRound(tx, input.roundId);
    assertRoundAvailable(lockedRound.rules);
    const prior = rows<{ id: string }>(
      await tx.execute(sql`
      SELECT id FROM competition_operation_audit
       WHERE round_id=${input.roundId} AND operation='disqualify' AND idempotency_key=${input.idempotencyKey}
    `),
    )[0];
    if (prior) return { repeated: true };
    const round = rows<{ status: string }>(
      await tx.execute(sql`
      SELECT status,rules FROM competition_rounds WHERE id=${input.roundId} FOR UPDATE
    `),
    )[0];
    if (!round) throw new Error("Competition round not found");
    if (!["open", "closing"].includes(round.status)) {
      throw new Error(
        "Disqualification after candidate snapshot requires a future correction workflow",
      );
    }
    const attempt = rows<{
      member_id: string;
      game_id: string;
      day_key: string;
      status: string;
    }>(
      await tx.execute(sql`
      SELECT member_id, game_id, day_key, status FROM competition_attempts
       WHERE id=${input.attemptId} AND round_id=${input.roundId} FOR UPDATE
    `),
    )[0];
    if (!attempt) throw new Error("Competition attempt not found");
    if (attempt.status !== "verified" && attempt.status !== "void") {
      throw new Error(`Attempt cannot be disqualified from ${attempt.status}`);
    }
    if (attempt.status === "void") return { repeated: true };
    await tx.execute(sql`
      UPDATE competition_attempts SET status='void', rejection_code=${input.reason}
       WHERE id=${input.attemptId}
    `);
    await recomputeDailyBestTx(tx, {
      roundId: input.roundId,
      memberId: attempt.member_id,
      gameId: attempt.game_id,
      dayKey: attempt.day_key,
      reason: `disqualification:${input.reason}`,
      actor: input.actor,
    });
    await tx.execute(sql`
      INSERT INTO competition_operation_audit
        (id,round_id,operation,actor,idempotency_key,payload)
      VALUES (${randomUUID()},${input.roundId},'disqualify',${input.actor},${input.idempotencyKey},
              ${JSON.stringify({ attemptId: input.attemptId, reason: input.reason })}::jsonb)
    `);
    return { repeated: false };
  });
}

export async function claimAward(
  db: Db,
  input: {
    awardId: string;
    memberId: string;
    proof: Record<string, unknown>;
    idempotencyKey: string;
  },
): Promise<{ status: "claimed"; repeated: boolean }> {
  requireOperationsEnabled();
  requireText(input.idempotencyKey, "idempotencyKey");
  if (!input.proof || Object.keys(input.proof).length === 0)
    throw new Error("Claim proof is required");
  if (JSON.stringify(input.proof).length > 8_192)
    throw new Error("Claim proof is too large");
  return db.transaction(async (tx) => {
    const award = rows<{
      status: string;
      member_id: string;
      claim_idempotency_key: string | null;
      claim_proof_digest: string | null;
      rules: RoundRules;
    }>(
      await tx.execute(sql`
      SELECT c.status,c.member_id,c.claim_idempotency_key,c.claim_proof_digest,r.rules
        FROM competition_award_claims c JOIN competition_rounds r ON r.id=c.round_id
       WHERE c.id=${input.awardId} FOR UPDATE OF c
    `),
    )[0];
    if (!award || award.member_id !== input.memberId)
      throw new Error("Award claim not found");
    assertRoundAvailable(award.rules);
    const proofDigest = digest(input.proof);
    if (
      award.status === "claimed" &&
      award.claim_idempotency_key === input.idempotencyKey &&
      award.claim_proof_digest === proofDigest
    ) {
      return { status: "claimed", repeated: true };
    }
    if (award.status !== "unclaimed")
      throw new Error(`Award cannot be claimed from ${award.status}`);
    await tx.execute(sql`
      UPDATE competition_award_claims
         SET status='claimed', private_proof=${JSON.stringify(input.proof)}::jsonb,
             claim_proof_digest=${proofDigest}, claim_idempotency_key=${input.idempotencyKey}, claimed_at=now()
       WHERE id=${input.awardId} AND member_id=${input.memberId}
    `);
    return { status: "claimed", repeated: false };
  });
}

export async function fulfillAward(
  db: Db,
  input: {
    awardId: string;
    actor: string;
    fulfillmentKey: string;
    idempotencyKey: string;
  },
): Promise<{ status: "fulfilled"; repeated: boolean }> {
  requireOperationsEnabled();
  requireText(input.actor, "actor");
  requireText(input.fulfillmentKey, "fulfillmentKey");
  requireText(input.idempotencyKey, "idempotencyKey");
  return db.transaction(async (tx) => {
    const identity = rows<{ round_id: string; rules: RoundRules }>(
      await tx.execute(sql`
      SELECT c.round_id,r.rules FROM competition_award_claims c
        JOIN competition_rounds r ON r.id=c.round_id WHERE c.id=${input.awardId}
    `),
    )[0];
    if (!identity) throw new Error("Award not found");
    assertRoundAvailable(identity.rules);
    await lockRound(tx, identity.round_id);
    const award = rows<{
      round_id: string;
      status: string;
      fulfillment_key: string | null;
    }>(
      await tx.execute(sql`
      SELECT round_id,status,fulfillment_key FROM competition_award_claims
       WHERE id=${input.awardId} FOR UPDATE
    `),
    )[0];
    if (
      award.status === "fulfilled" &&
      award.fulfillment_key === input.fulfillmentKey
    ) {
      return { status: "fulfilled", repeated: true };
    }
    if (award.status !== "claimed")
      throw new Error(`Award cannot be fulfilled from ${award.status}`);
    await tx.execute(sql`
      UPDATE competition_award_claims SET status='fulfilled',
             fulfillment_key=${input.fulfillmentKey},fulfilled_at=now()
       WHERE id=${input.awardId}
    `);
    await tx.execute(sql`
      INSERT INTO competition_operation_audit
        (id,round_id,operation,actor,idempotency_key,payload)
      VALUES (${randomUUID()},${award.round_id},'fulfill',${input.actor},${input.idempotencyKey},
              ${JSON.stringify({ awardId: input.awardId, fulfillmentKey: input.fulfillmentKey })}::jsonb)
    `);
    return { status: "fulfilled", repeated: false };
  });
}
