import { randomUUID } from "node:crypto";
import { sql } from "drizzle-orm";
import type { Db } from "@/db/client";
import { digest, lockRound, recomputeDailyBestTx } from "@/competition/store";
import {
  applyTieReview,
  materialPrizeAllocationIssue,
  rankCandidateStandings,
  type CandidateStanding,
  type FinalStanding,
  type TieReviewDecision,
} from "./operations";
import { materialLaunchBlockers } from "./launch-readiness";
import {
  assertRoundAvailable,
  CompetitionError,
  competitionEnabled,
  isTopTierResult,
  parseRules,
  type RoundRules,
} from "./rules";
import { verifyAttempt } from "./store";

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
  game_high_scores: GameHighScore[];
  source_digest: string;
  created_at: Date;
};
export type GameHighScore = {
  memberId: string;
  gameId: string;
  score: number;
};

export type CloseRoundResult =
  | { kind: "awaiting_pending"; pendingCount: number }
  | { kind: "snapshot"; snapshot: SnapshotRow; repeated: boolean };

export type FinalAward = {
  memberId: string;
  awardKey: string;
  allocationRationale: string;
};
export type DraftRoundDefinition = {
  slug: string;
  opensAt: string;
  closesAt: string;
  rules: unknown;
};
export type ValidatedDraftRoundDefinition = {
  slug: string;
  opensAt: Date;
  closesAt: Date;
  rules: RoundRules;
};

type SettlementResult = Omit<
  Awaited<ReturnType<typeof verifyAttempt>>,
  "receipt"
> & { repeated: boolean };

function rows<T>(result: unknown): T[] {
  return (result as SqlRows<T>).rows;
}

function asDate(value: Date | string): Date {
  return value instanceof Date ? value : new Date(value);
}

function inputDate(value: unknown, label: string): Date {
  if (typeof value !== "string")
    throw new Error(`${label} must be an ISO date`);
  const parsed = new Date(value);
  if (!Number.isFinite(parsed.getTime()))
    throw new Error(`${label} must be a valid ISO date`);
  return parsed;
}

function requireText(value: string, label: string): void {
  if (!value.trim()) throw new Error(`${label} is required`);
}

function requireOperationsEnabled(): void {
  if (!competitionEnabled()) throw new Error("Arcade competition is disabled");
}

function requireAuthEnabled(): void {
  if (process.env.ARCADE_SHARED_AUTH_ENABLED !== "true")
    throw new Error("Shared authentication is disabled");
}

/** Validate and normalize a round file without connecting to a database. */
export function validateDraftRoundDefinition(
  definition: DraftRoundDefinition,
): ValidatedDraftRoundDefinition {
  if (!/^[a-z0-9][a-z0-9-]{2,63}$/.test(definition.slug))
    throw new Error("Round slug is invalid");
  const rules = parseRules(definition.rules);
  const opensAt = inputDate(definition.opensAt, "opensAt");
  const closesAt = inputDate(definition.closesAt, "closesAt");
  if (closesAt <= opensAt)
    throw new Error("Round close must follow its open time");
  return { slug: definition.slug, opensAt, closesAt, rules };
}

export async function createDraftRound(
  db: Db,
  input: {
    definition: DraftRoundDefinition;
    actor: string;
    idempotencyKey: string;
  },
): Promise<{ roundId: string; slug: string; repeated: boolean }> {
  requireText(input.actor, "actor");
  requireText(input.idempotencyKey, "idempotencyKey");
  const validated = validateDraftRoundDefinition(input.definition);
  const { rules, opensAt, closesAt } = validated;
  return db.transaction(async (tx) => {
    await tx.execute(
      sql`SELECT pg_advisory_xact_lock(hashtextextended(${`competition-round-slug:${validated.slug}`},0))`,
    );
    const existing = rows<{
      id: string;
      rules: RoundRules;
      opens_at: Date | string;
      closes_at: Date | string;
    }>(
      await tx.execute(
        sql`SELECT id,rules,opens_at,closes_at FROM competition_rounds WHERE slug=${validated.slug}`,
      ),
    )[0];
    const definitionDigest = digest({
      slug: validated.slug,
      opensAt: opensAt.toISOString(),
      closesAt: closesAt.toISOString(),
      rules,
    });
    if (existing) {
      const audit = rows<{ payload: { definitionDigest?: string } }>(
        await tx.execute(sql`
          SELECT payload FROM competition_operation_audit
           WHERE round_id=${existing.id} AND operation='create-draft'
             AND idempotency_key=${input.idempotencyKey}
        `),
      )[0];
      if (audit?.payload.definitionDigest === definitionDigest)
        return {
          roundId: existing.id,
          slug: validated.slug,
          repeated: true,
        };
      throw new Error("Round slug already exists with a different operation");
    }
    const now = asDate(
      rows<{ now: Date | string }>(
        await tx.execute(sql`SELECT now() AS now`),
      )[0].now,
    );
    if (opensAt <= now)
      throw new Error("A draft round cannot start retroactively");
    const roundId = randomUUID();
    await tx.execute(sql`
      INSERT INTO competition_rounds(id,slug,rules,status,opens_at,closes_at)
      VALUES(${roundId},${validated.slug},${JSON.stringify(rules)}::jsonb,'draft',${opensAt},${closesAt})
    `);
    await tx.execute(sql`
      INSERT INTO competition_operation_audit
        (id,round_id,operation,actor,idempotency_key,payload)
      VALUES(${randomUUID()},${roundId},'create-draft',${input.actor},${input.idempotencyKey},
             ${JSON.stringify({ definitionDigest, rulesDigest: digest(rules) })}::jsonb)
    `);
    return { roundId, slug: validated.slug, repeated: false };
  });
}

export async function openRound(
  db: Db,
  input: { roundId: string; actor: string; idempotencyKey: string },
): Promise<{ roundId: string; status: "open"; repeated: boolean }> {
  requireOperationsEnabled();
  requireAuthEnabled();
  requireText(input.actor, "actor");
  requireText(input.idempotencyKey, "idempotencyKey");
  return db.transaction(async (tx) => {
    // Every opening decision must observe the same serialized schedule. A
    // per-round lock alone allows two different overlapping drafts to pass.
    await tx.execute(
      sql`SELECT pg_advisory_xact_lock(hashtextextended('competition-schedule',0))`,
    );
    const round = await lockRound(tx, input.roundId);
    assertRoundAvailable(round.rules);
    if (materialLaunchBlockers(round.rules).length > 0)
      throw new CompetitionError("material_launch_not_ready", 409);
    const prior = rows<{ id: string }>(
      await tx.execute(sql`
      SELECT id FROM competition_operation_audit
       WHERE round_id=${input.roundId} AND operation='open' AND idempotency_key=${input.idempotencyKey}
    `),
    )[0];
    if (round.status === "open" && prior)
      return { roundId: round.id, status: "open", repeated: true };
    if (round.status !== "draft")
      throw new Error(`Round cannot open from ${round.status}`);
    const now = asDate(
      rows<{ now: Date | string }>(
        await tx.execute(sql`SELECT now() AS now`),
      )[0].now,
    );
    if (now >= round.opens_at)
      throw new Error("A round cannot be opened retroactively");
    const overlap = rows<{ id: string }>(
      await tx.execute(sql`
      SELECT id FROM competition_rounds
       WHERE id<>${round.id} AND status<>'draft'
         AND tstzrange(opens_at,closes_at,'[)') && tstzrange(${round.opens_at},${round.closes_at},'[)')
       LIMIT 1
    `),
    )[0];
    if (overlap)
      throw new Error("Round schedule overlaps another active round");
    await tx.execute(
      sql`UPDATE competition_rounds SET status='open' WHERE id=${round.id}`,
    );
    await tx.execute(sql`
      INSERT INTO competition_operation_audit(id,round_id,operation,actor,idempotency_key,payload)
      VALUES(${randomUUID()},${round.id},'open',${input.actor},${input.idempotencyKey},
             ${JSON.stringify({ rulesDigest: digest(round.rules) })}::jsonb)
    `);
    return { roundId: round.id, status: "open", repeated: false };
  });
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
        SELECT id, standings, game_high_scores, source_digest, created_at
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
      game_id: string | null;
      day_key: string;
      points: number;
      received_at: Date;
      attempt_id: string | null;
    }>(
      await tx.execute(sql`
        SELECT b.member_id, b.game_id, b.period_key AS day_key, b.points, b.received_at, b.attempt_id
          FROM competition_period_best b
          JOIN competition_attempts a ON a.id = b.attempt_id
         WHERE b.round_id = ${input.roundId}
           AND b.points > 0 AND a.status = 'verified'
        UNION ALL
        SELECT b.member_id, NULL::text AS game_id, b.period_key AS day_key, b.points, b.earned_at AS received_at,
               NULL::uuid AS attempt_id
          FROM competition_period_bonuses b
         WHERE b.round_id = ${input.roundId} AND b.points > 0
         ORDER BY member_id, day_key, attempt_id NULLS LAST
      `),
    );
    const standings = rankCandidateStandings(
      source.map((item) => ({
        memberId: item.member_id,
        dayKey: item.day_key,
        points: item.points,
        receivedAt: asDate(item.received_at),
        topTierResults:
          item.game_id &&
          isTopTierResult(round.rules, item.game_id, item.points)
            ? 1
            : 0,
      })),
      round.rules.version === 1 ? "legacy_daily" : "top_tier",
    );
    const gameHighScores = rows<{
      member_id: string;
      game_id: string;
      score: number;
    }>(
      await tx.execute(sql`
        SELECT DISTINCT ON (member_id,game_id) member_id,game_id,score
          FROM competition_attempts
         WHERE round_id=${input.roundId} AND status='verified' AND score IS NOT NULL
         ORDER BY member_id,game_id,score DESC,received_at ASC,id ASC
      `),
    ).map((row) => ({
      memberId: row.member_id,
      gameId: row.game_id,
      score: row.score,
    }));
    const snapshot: SnapshotRow = {
      id: randomUUID(),
      standings,
      game_high_scores: gameHighScores,
      source_digest: digest({
        contributions: source.map((item) => ({
          ...item,
          received_at: asDate(item.received_at).toISOString(),
        })),
        gameHighScores,
      }),
      created_at: clock,
    };
    await tx.execute(sql`
      INSERT INTO competition_candidate_snapshots
        (id, round_id, standings, game_high_scores, source_digest, created_at)
      VALUES (${snapshot.id}, ${input.roundId}, ${JSON.stringify(standings)}::jsonb,
              ${JSON.stringify(gameHighScores)}::jsonb,
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
    if (lockedRound.rules.mode === "community" && input.awards.length > 0)
      throw new CompetitionError("community_round_has_no_prizes", 409);
    if (materialLaunchBlockers(lockedRound.rules).length > 0)
      throw new CompetitionError("material_launch_not_ready", 409);
    const requestedReview = {
      tieDecisions: input.tieDecisions,
      awards: input.awards,
    };
    const existing = rows<{
      id: string;
      standings: FinalStanding[];
      review: unknown;
    }>(
      await tx.execute(
        sql`SELECT id,standings,review FROM competition_final_results WHERE round_id = ${input.roundId}`,
      ),
    )[0];
    if (existing) {
      if (digest(existing.review) !== digest(requestedReview))
        throw new Error("Final review conflicts with the immutable result");
      return {
        finalResultId: existing.id,
        standings: existing.standings,
        repeated: true,
      };
    }
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
    if (
      lockedRound.rules.mode === "material_prize" &&
      lockedRound.rules.version === 2
    ) {
      const allocationIssue = materialPrizeAllocationIssue(
        standings,
        input.awards,
        lockedRound.rules.winnerCount,
      );
      if (allocationIssue) throw new CompetitionError(allocationIssue, 409);
    }
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
              ${JSON.stringify(requestedReview)}::jsonb,
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
    const prior = rows<{ payload: { attemptId?: string; reason?: string } }>(
      await tx.execute(sql`
      SELECT payload FROM competition_operation_audit
       WHERE round_id=${input.roundId} AND operation='disqualify' AND idempotency_key=${input.idempotencyKey}
    `),
    )[0];
    if (prior) {
      if (
        prior.payload.attemptId !== input.attemptId ||
        prior.payload.reason !== input.reason
      )
        throw new Error("Disqualification idempotency conflict");
      return { repeated: true };
    }
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
      score_period_key: string;
      status: string;
    }>(
      await tx.execute(sql`
      SELECT member_id, game_id, day_key, score_period_key, status FROM competition_attempts
       WHERE id=${input.attemptId} AND round_id=${input.roundId} FOR UPDATE
    `),
    )[0];
    if (!attempt) throw new Error("Competition attempt not found");
    if (attempt.status !== "verified") {
      throw new Error(`Attempt cannot be disqualified from ${attempt.status}`);
    }
    await tx.execute(sql`
      UPDATE competition_attempts SET status='void', rejection_code=${input.reason}
       WHERE id=${input.attemptId}
    `);
    await recomputeDailyBestTx(tx, {
      roundId: input.roundId,
      memberId: attempt.member_id,
      gameId: attempt.game_id,
      scorePeriodKey: attempt.score_period_key,
      reason: `disqualification:${input.reason}`,
      actor: input.actor,
      rules: lockedRound.rules,
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

export async function rejectPendingAttempt(
  db: Db,
  input: {
    roundId: string;
    attemptId: string;
    actor: string;
    reason: string;
    idempotencyKey: string;
  },
): Promise<{ status: "rejected"; repeated: boolean }> {
  requireOperationsEnabled();
  requireText(input.actor, "actor");
  requireText(input.reason, "reason");
  requireText(input.idempotencyKey, "idempotencyKey");
  return db.transaction(async (tx) => {
    const round = await lockRound(tx, input.roundId);
    assertRoundAvailable(round.rules);
    const prior = rows<{ payload: { attemptId?: string; reason?: string } }>(
      await tx.execute(sql`
      SELECT payload FROM competition_operation_audit
       WHERE round_id=${input.roundId} AND operation='reject-pending'
         AND idempotency_key=${input.idempotencyKey}
    `),
    )[0];
    if (prior) {
      if (
        prior.payload.attemptId !== input.attemptId ||
        prior.payload.reason !== input.reason
      )
        throw new Error("Pending rejection idempotency conflict");
      return { status: "rejected", repeated: true };
    }
    if (!["open", "closing"].includes(round.status))
      throw new Error(
        `Pending receipt cannot be rejected from round ${round.status}`,
      );
    const attempt = rows<{ status: string }>(
      await tx.execute(sql`
      SELECT status FROM competition_attempts
       WHERE id=${input.attemptId} AND round_id=${input.roundId} FOR UPDATE
    `),
    )[0];
    if (!attempt) throw new Error("Competition attempt not found");
    if (attempt.status !== "pending")
      throw new Error(`Attempt cannot be rejected from ${attempt.status}`);
    await tx.execute(sql`
      UPDATE competition_attempts SET status='rejected',rejection_code=${input.reason}
       WHERE id=${input.attemptId}
    `);
    await tx.execute(sql`
      INSERT INTO competition_operation_audit(id,round_id,operation,actor,idempotency_key,payload)
      VALUES(${randomUUID()},${input.roundId},'reject-pending',${input.actor},${input.idempotencyKey},
             ${JSON.stringify({ attemptId: input.attemptId, reason: input.reason })}::jsonb)
    `);
    return { status: "rejected", repeated: false };
  });
}

/**
 * Replay already-confirmed evidence as an explicit operator operation.
 * Verification and its audit record share one transaction so an uncertain
 * client response can always be retried with the same idempotency key.
 */
export async function settleAttempt(
  db: Db,
  input: {
    roundId: string;
    attemptId: string;
    actor: string;
    idempotencyKey: string;
  },
): Promise<SettlementResult> {
  requireOperationsEnabled();
  requireText(input.actor, "actor");
  requireText(input.idempotencyKey, "idempotencyKey");
  return db.transaction(async (tx) => {
    const round = await lockRound(tx, input.roundId);
    assertRoundAvailable(round.rules);
    const prior = rows<{
      payload: {
        attemptId?: string;
        result?: Omit<SettlementResult, "repeated">;
      };
    }>(
      await tx.execute(sql`
        SELECT payload FROM competition_operation_audit
         WHERE round_id=${input.roundId} AND operation='settle'
           AND idempotency_key=${input.idempotencyKey}
      `),
    )[0];
    if (prior) {
      if (prior.payload.attemptId !== input.attemptId || !prior.payload.result)
        throw new Error("Settlement idempotency conflict");
      return { ...prior.payload.result, repeated: true };
    }
    if (!["open", "closing"].includes(round.status))
      throw new Error(`Attempt cannot settle from round ${round.status}`);
    const attempt = rows<{ status: string; security_confirmed: boolean }>(
      await tx.execute(sql`
        SELECT status,security_confirmed FROM competition_attempts
         WHERE id=${input.attemptId}::uuid AND round_id=${input.roundId}::uuid
         FOR UPDATE
      `),
    )[0];
    if (!attempt) throw new CompetitionError("attempt_not_found", 404);
    if (attempt.status !== "pending")
      throw new Error(`Attempt cannot settle from ${attempt.status}`);
    if (!attempt.security_confirmed)
      throw new CompetitionError("security_confirmation_required", 409);

    // Drizzle transactions support nested transactions through savepoints.
    // Keeping verification inside this outer transaction makes its score,
    // ledger changes, and the operator audit record atomic.
    const verified = await verifyAttempt(tx as unknown as Db, input.attemptId);
    const { receipt: _privateReceipt, ...result } = verified;
    await tx.execute(sql`
      INSERT INTO competition_operation_audit
        (id,round_id,operation,actor,idempotency_key,payload)
      VALUES (${randomUUID()},${input.roundId},'settle',${input.actor},${input.idempotencyKey},
              ${JSON.stringify({ attemptId: input.attemptId, result })}::jsonb)
    `);
    return { ...result, repeated: false };
  });
}

export async function operatorReviewBundle(
  db: Db,
  roundId: string,
  options?: {
    pendingLimit?: number;
    pendingAfter?: { receivedAt: Date | string; id: string };
  },
) {
  requireOperationsEnabled();
  if (
    options?.pendingLimit !== undefined &&
    (!Number.isSafeInteger(options.pendingLimit) ||
      options.pendingLimit < 1 ||
      options.pendingLimit > 501)
  )
    throw new Error("Pending review limit is invalid");
  const round = rows<{
    id: string;
    slug: string;
    status: string;
    closes_at: Date | string;
  }>(
    await db.execute(sql`
      SELECT id,slug,status,closes_at FROM competition_rounds WHERE id=${roundId}
    `),
  )[0];
  if (!round) throw new Error("Competition round not found");
  const pending = rows<{
    id: string;
    status: string;
    security_confirmed: boolean;
    receipt: unknown;
    received_at: Date | string;
    received_cursor: string;
  }>(
    await db.execute(sql`
    SELECT id,status,security_confirmed,receipt,received_at,
           to_char(received_at AT TIME ZONE 'UTC','YYYY-MM-DD"T"HH24:MI:SS.US"Z"') AS received_cursor
      FROM competition_attempts
     WHERE round_id=${roundId} AND status='pending' AND received_at<${asDate(round.closes_at)}
       ${options?.pendingAfter ? sql`AND (received_at,id)>(${options.pendingAfter.receivedAt}::timestamptz,${options.pendingAfter.id}::uuid)` : sql``}
     ORDER BY received_at,id
     ${options?.pendingLimit ? sql`LIMIT ${options.pendingLimit}` : sql``}
  `),
  );
  const snapshot = rows<{
    id: string;
    source_digest: string;
    standings: CandidateStanding[];
  }>(
    await db.execute(sql`
    SELECT id,source_digest,standings FROM competition_candidate_snapshots WHERE round_id=${roundId}
  `),
  )[0];
  const tieKeys = new Map<string, string[]>();
  for (const standing of snapshot?.standings ?? []) {
    if (!standing.exactTieKey) continue;
    const members = tieKeys.get(standing.exactTieKey) ?? [];
    members.push(standing.memberId);
    tieKeys.set(standing.exactTieKey, members);
  }
  return {
    round: { id: round.id, slug: round.slug, status: round.status },
    pending: pending.map((attempt) => ({
      attemptId: attempt.id,
      status: attempt.status,
      securityConfirmed: attempt.security_confirmed,
      receiptDigest: digest(attempt.receipt),
      receivedAt: attempt.received_cursor,
    })),
    candidate: snapshot
      ? {
          snapshotId: snapshot.id,
          sourceDigest: snapshot.source_digest,
          standings: snapshot.standings,
        }
      : null,
    tieDecisions: [...tieKeys].map(([exactTieKey, memberIds]) => ({
      exactTieKey,
      resolution: "shared_rank" as const,
      memberIds,
      rationale: "",
    })),
    awards: [],
  };
}

export async function claimAward(
  db: Db,
  input: {
    awardId: string;
    memberId: string;
    proof: { acceptedInstructions: true };
    idempotencyKey: string;
  },
): Promise<{ status: "claimed" | "fulfilled"; repeated: boolean }> {
  requireOperationsEnabled();
  requireText(input.idempotencyKey, "idempotencyKey");
  if (input.proof?.acceptedInstructions !== true)
    throw new CompetitionError("claim_instructions_required", 400);
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
      throw new CompetitionError("award_not_found", 404);
    assertRoundAvailable(award.rules);
    const proofDigest = digest(input.proof);
    if (
      ["claimed", "fulfilled"].includes(award.status) &&
      award.claim_idempotency_key === input.idempotencyKey &&
      award.claim_proof_digest === proofDigest
    ) {
      return {
        status: award.status as "claimed" | "fulfilled",
        repeated: true,
      };
    }
    if (award.status !== "unclaimed")
      throw new CompetitionError("award_claim_conflict", 409);
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
    reason: string;
    idempotencyKey: string;
  },
): Promise<{ status: "fulfilled"; repeated: boolean }> {
  requireOperationsEnabled();
  requireText(input.actor, "actor");
  requireText(input.fulfillmentKey, "fulfillmentKey");
  requireText(input.reason, "reason");
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
              ${JSON.stringify({ awardId: input.awardId, fulfillmentKey: input.fulfillmentKey, reason: input.reason })}::jsonb)
    `);
    return { status: "fulfilled", repeated: false };
  });
}
