import { createHash, createHmac } from "node:crypto";
import { sql } from "drizzle-orm";
import type { Db } from "@/db/client";
import {
  CompetitionError,
  assertRoundAvailable,
  competitionAttemptDayKey,
  competitionScorePeriodKey,
  fullArenaBonusPoints,
  parseRules,
  pointsForScore,
  type RoundRules,
} from "./rules";
import { materialLaunchBlockers } from "./launch-readiness";
import { verifyCompetitionTrace } from "./verify-replay";
export type CompetitionTx = Parameters<Parameters<Db["transaction"]>[0]>[0];
export type Round = {
  id: string;
  slug: string;
  status: string;
  rules: RoundRules;
  opens_at: Date;
  closes_at: Date;
};
export type Actor = {
  memberId: string;
  providerSessionId: string;
  emailVerified: boolean;
};
type Attempt = {
  id: string;
  round_id: string;
  member_id: string;
  provider_session_id: string;
  game_id: string;
  day_key: string;
  score_period_key: string;
  seed: string;
  status: string;
  issued_at: Date;
  expires_at: Date;
  received_at: Date | null;
  trace_hash: string | null;
  trace: unknown;
  security_confirmed: boolean;
  score: number | null;
  points: number | null;
  receipt: unknown;
  rejection_code: string | null;
};
export function canonicalJson(value: unknown): string {
  if (Array.isArray(value)) return `[${value.map(canonicalJson).join(",")}]`;
  if (value && typeof value === "object")
    return `{${Object.keys(value)
      .sort()
      .map(
        (key) =>
          `${JSON.stringify(key)}:${canonicalJson((value as Record<string, unknown>)[key])}`,
      )
      .join(",")}}`;
  return JSON.stringify(value) ?? "null";
}
export const digest = (value: unknown) =>
  createHash("sha256").update(canonicalJson(value)).digest("hex");
function dateValue(value: unknown): Date {
  const result = value instanceof Date ? value : new Date(String(value));
  if (!Number.isFinite(result.getTime()))
    throw new CompetitionError("invalid_database_time", 503);
  return result;
}
function attemptDates(row: Attempt): Attempt {
  return {
    ...row,
    issued_at: dateValue(row.issued_at),
    expires_at: dateValue(row.expires_at),
    received_at: row.received_at === null ? null : dateValue(row.received_at),
  };
}
export async function lockRound(
  tx: CompetitionTx,
  roundId: string,
): Promise<Round> {
  await tx.execute(
    sql`SELECT pg_advisory_xact_lock(hashtextextended(${`competition-round:${roundId}`},0))`,
  );
  const rows = (
    await tx.execute(
      sql`SELECT id,slug,status,rules,opens_at,closes_at FROM competition_rounds WHERE id=${roundId}::uuid FOR UPDATE`,
    )
  ).rows as unknown as Round[];
  if (!rows[0]) throw new CompetitionError("round_not_found", 404);
  rows[0].rules = parseRules(rows[0].rules);
  rows[0].opens_at = dateValue(rows[0].opens_at);
  rows[0].closes_at = dateValue(rows[0].closes_at);
  return rows[0];
}
const clock = async (tx: CompetitionTx) =>
  dateValue(
    (await tx.execute(sql`SELECT clock_timestamp() AS now`)).rows[0].now,
  );
function isOpen(round: Round, now: Date) {
  assertRoundAvailable(round.rules);
  if (materialLaunchBlockers(round.rules).length > 0)
    throw new CompetitionError("material_launch_not_ready", 409);
  if (round.status !== "open" || now < round.opens_at || now >= round.closes_at)
    throw new CompetitionError("round_not_open");
}
export async function enroll(
  db: Db,
  actor: Actor,
  roundId: string,
  acceptedRulesDigest: string,
) {
  if (!actor.emailVerified)
    throw new CompetitionError("email_verification_required", 403);
  return db.transaction(async (tx) => {
    const round = await lockRound(tx, roundId);
    isOpen(round, await clock(tx));
    if (digest(round.rules) !== acceptedRulesDigest)
      throw new CompetitionError("rules_changed");
    if (
      !(
        await tx.execute(
          sql`SELECT member_id FROM competition_profiles WHERE member_id=${actor.memberId}::uuid`,
        )
      ).rows.length
    )
      throw new CompetitionError("username_required");
    await tx.execute(
      sql`INSERT INTO competition_enrollments(round_id,member_id,rules_digest) VALUES(${roundId}::uuid,${actor.memberId}::uuid,${acceptedRulesDigest}) ON CONFLICT DO NOTHING`,
    );
    return { enrolled: true };
  });
}
export async function issueAttempt(
  db: Db,
  actor: Actor,
  input: { roundId: string; gameId: string; idempotencyKey: string },
  secret: string,
) {
  if (!actor.emailVerified)
    throw new CompetitionError("email_verification_required", 403);
  if (secret.length < 32)
    throw new CompetitionError("competition_unavailable", 503);
  if (!/^[A-Za-z0-9_-]{16,100}$/.test(input.idempotencyKey))
    throw new CompetitionError("invalid_idempotency_key", 400);
  return db.transaction(async (tx) => {
    const round = await lockRound(tx, input.roundId);
    const now = await clock(tx);
    isOpen(round, now);
    if (!round.rules.games.some((game) => game.gameId === input.gameId))
      throw new CompetitionError("ineligible_game", 400);
    const enrolled = (
      await tx.execute(
        sql`SELECT rules_digest FROM competition_enrollments WHERE round_id=${round.id}::uuid AND member_id=${actor.memberId}::uuid`,
      )
    ).rows[0];
    if (!enrolled || enrolled.rules_digest !== digest(round.rules))
      throw new CompetitionError("enrollment_required");
    const existing = (
      await tx.execute(
        sql`SELECT * FROM competition_attempts WHERE round_id=${round.id}::uuid AND member_id=${actor.memberId}::uuid AND idempotency_key=${input.idempotencyKey}`,
      )
    ).rows[0] as unknown as Attempt | undefined;
    if (existing) {
      Object.assign(existing, attemptDates(existing));
      if (
        existing.game_id !== input.gameId ||
        existing.provider_session_id !== actor.providerSessionId
      )
        throw new CompetitionError("idempotency_conflict");
      if (existing.status !== "issued" || existing.expires_at <= now)
        throw new CompetitionError("attempt_already_consumed");
      return {
        attemptId: existing.id,
        seed: existing.seed,
        expiresAt: existing.expires_at.toISOString(),
        reissued: true,
      };
    }
    const day = competitionAttemptDayKey(round.rules, now);
    const scorePeriod = competitionScorePeriodKey(round.rules, now);
    const used = Number(
      (
        await tx.execute(
          sql`SELECT count(*)::int AS count FROM competition_attempts WHERE round_id=${round.id}::uuid AND member_id=${actor.memberId}::uuid AND game_id=${input.gameId} AND day_key=${day}`,
        )
      ).rows[0].count,
    );
    if (used >= round.rules.dailyAttempts)
      throw new CompetitionError("daily_limit_reached");
    const candidate = createHmac("sha256", secret)
      .update(`${round.id}:${input.gameId}:${day}:${digest(round.rules)}`)
      .digest("hex");
    await tx.execute(
      sql`INSERT INTO competition_challenges(round_id,game_id,day_key,seed) VALUES(${round.id}::uuid,${input.gameId},${day},${candidate}) ON CONFLICT DO NOTHING`,
    );
    const seed = (
      await tx.execute(
        sql`SELECT seed FROM competition_challenges WHERE round_id=${round.id}::uuid AND game_id=${input.gameId} AND day_key=${day}`,
      )
    ).rows[0].seed as string;
    const expiry = new Date(
      Math.min(
        now.getTime() + round.rules.attemptTtlSeconds * 1000,
        round.closes_at.getTime(),
      ),
    );
    const attempt = (
      await tx.execute(
        sql`INSERT INTO competition_attempts(round_id,member_id,provider_session_id,game_id,day_key,score_period_key,ordinal,idempotency_key,seed,issued_at,expires_at) VALUES(${round.id}::uuid,${actor.memberId}::uuid,${actor.providerSessionId},${input.gameId},${day},${scorePeriod},${used + 1},${input.idempotencyKey},${seed},${now},${expiry}) RETURNING id`,
      )
    ).rows[0];
    return {
      attemptId: attempt.id as string,
      seed,
      expiresAt: expiry.toISOString(),
      reissued: false,
      remaining: round.rules.dailyAttempts - used - 1,
    };
  });
}
export async function recomputeDailyBestTx(
  tx: CompetitionTx,
  input: {
    roundId: string;
    memberId: string;
    gameId: string;
    dayKey?: string;
    scorePeriodKey?: string;
    reason: string;
    actor?: string;
    rules?: RoundRules;
  },
) {
  const periodKey = input.scorePeriodKey ?? input.dayKey;
  if (!periodKey) throw new CompetitionError("score_period_key_required", 500);
  const old = (
    await tx.execute(
      sql`SELECT points FROM competition_period_best WHERE round_id=${input.roundId}::uuid AND member_id=${input.memberId}::uuid AND game_id=${input.gameId} AND period_key=${periodKey}`,
    )
  ).rows[0];
  const best = (
    await tx.execute(
      sql`SELECT id,points,received_at FROM competition_attempts WHERE round_id=${input.roundId}::uuid AND member_id=${input.memberId}::uuid AND game_id=${input.gameId} AND score_period_key=${periodKey} AND status='verified' ORDER BY points DESC,received_at ASC,id ASC LIMIT 1`,
    )
  ).rows[0];
  const delta = Number(best?.points ?? 0) - Number(old?.points ?? 0);
  if (best)
    await tx.execute(
      sql`INSERT INTO competition_period_best(round_id,member_id,game_id,period_key,attempt_id,points,received_at) VALUES(${input.roundId}::uuid,${input.memberId}::uuid,${input.gameId},${periodKey},${best.id}::uuid,${best.points},${best.received_at}) ON CONFLICT(round_id,member_id,game_id,period_key) DO UPDATE SET attempt_id=excluded.attempt_id,points=excluded.points,received_at=excluded.received_at`,
    );
  else
    await tx.execute(
      sql`DELETE FROM competition_period_best WHERE round_id=${input.roundId}::uuid AND member_id=${input.memberId}::uuid AND game_id=${input.gameId} AND period_key=${periodKey}`,
    );
  if (delta)
    await tx.execute(
      sql`INSERT INTO competition_ledger(round_id,member_id,attempt_id,game_id,day_key,delta,reason) VALUES(${input.roundId}::uuid,${input.memberId}::uuid,${best?.id ?? null}::uuid,${input.gameId},${periodKey},${delta},${input.reason})`,
    );
  const bonus = input.rules
    ? await recomputeFullArenaBonusTx(tx, {
        roundId: input.roundId,
        memberId: input.memberId,
        periodKey,
        rules: input.rules,
      })
    : { points: 0, delta: 0 };
  return { points: Number(best?.points ?? 0), delta, bonus };
}
async function recomputeFullArenaBonusTx(
  tx: CompetitionTx,
  input: {
    roundId: string;
    memberId: string;
    periodKey: string;
    rules: RoundRules;
  },
) {
  const configuredPoints = fullArenaBonusPoints(input.rules);
  const old = (
    await tx.execute(sql`
      SELECT points FROM competition_period_bonuses
       WHERE round_id=${input.roundId}::uuid AND member_id=${input.memberId}::uuid
         AND period_key=${input.periodKey}
    `)
  ).rows[0];
  const coverage = (
    await tx.execute(sql`
      SELECT count(DISTINCT game_id)::int AS games, max(received_at) AS earned_at
        FROM competition_period_best
       WHERE round_id=${input.roundId}::uuid AND member_id=${input.memberId}::uuid
         AND period_key=${input.periodKey} AND points>0
    `)
  ).rows[0];
  const complete =
    configuredPoints > 0 &&
    Number(coverage?.games ?? 0) === input.rules.games.length;
  const nextPoints = complete ? configuredPoints : 0;
  const oldPoints = Number(old?.points ?? 0);
  const delta = nextPoints - oldPoints;
  if (nextPoints > 0) {
    await tx.execute(sql`
      INSERT INTO competition_period_bonuses(round_id,member_id,period_key,points,earned_at)
      VALUES(${input.roundId}::uuid,${input.memberId}::uuid,${input.periodKey},${nextPoints},${coverage.earned_at})
      ON CONFLICT(round_id,member_id,period_key)
      DO UPDATE SET points=excluded.points,earned_at=excluded.earned_at
    `);
  } else if (old) {
    await tx.execute(sql`
      DELETE FROM competition_period_bonuses
       WHERE round_id=${input.roundId}::uuid AND member_id=${input.memberId}::uuid
         AND period_key=${input.periodKey}
    `);
  }
  if (delta) {
    await tx.execute(sql`
      INSERT INTO competition_ledger(round_id,member_id,attempt_id,game_id,day_key,delta,reason)
      VALUES(${input.roundId}::uuid,${input.memberId}::uuid,NULL,'__full_arena__',${input.periodKey},${delta},
             ${delta > 0 ? "full_arena_bonus" : "full_arena_bonus_reversed"})
    `);
  }
  return { points: nextPoints, delta };
}
/** Receipt is persisted before verification, including during a provider outage. */
export async function receiveTrace(
  db: Db,
  actor: Actor,
  attemptId: string,
  trace: unknown,
  securityConfirmed: boolean,
) {
  if (!actor.emailVerified)
    throw new CompetitionError("email_verification_required", 403);
  const traceHash = digest(trace);
  const found = (
    await db.execute(
      sql`SELECT round_id FROM competition_attempts WHERE id=${attemptId}::uuid AND member_id=${actor.memberId}::uuid`,
    )
  ).rows[0];
  if (!found) throw new CompetitionError("attempt_not_found", 404);
  return db.transaction(async (tx) => {
    const round = await lockRound(tx, found.round_id as string);
    assertRoundAvailable(round.rules);
    const attempt = (
      await tx.execute(
        sql`SELECT * FROM competition_attempts WHERE id=${attemptId}::uuid FOR UPDATE`,
      )
    ).rows[0] as unknown as Attempt;
    Object.assign(attempt, attemptDates(attempt));
    if (
      attempt.member_id !== actor.memberId ||
      attempt.provider_session_id !== actor.providerSessionId
    )
      throw new CompetitionError("attempt_session_changed", 403);
    if (attempt.trace_hash) {
      if (attempt.trace_hash !== traceHash)
        throw new CompetitionError("different_trace_retry");
      if (attempt.status === "pending" && securityConfirmed)
        await tx.execute(
          sql`UPDATE competition_attempts SET security_confirmed=true WHERE id=${attemptId}::uuid`,
        );
      return {
        attemptId,
        status: attempt.status,
        receipt: attempt.receipt,
        replayed: true,
      };
    }
    const now = await clock(tx);
    if (
      attempt.status !== "issued" ||
      now >= attempt.expires_at ||
      now >= round.closes_at ||
      !["open", "closing"].includes(round.status)
    )
      throw new CompetitionError("attempt_expired");
    const receipt = {
      attemptId,
      receivedAt: now.toISOString(),
      evidenceHash: traceHash,
    };
    await tx.execute(
      sql`UPDATE competition_attempts SET status='pending',trace=${JSON.stringify(trace)}::jsonb,trace_hash=${traceHash},received_at=${now},security_confirmed=${securityConfirmed},receipt=${JSON.stringify(receipt)}::jsonb WHERE id=${attemptId}::uuid`,
    );
    return { attemptId, status: "pending", receipt, replayed: false };
  });
}
export async function verifyAttempt(db: Db, attemptId: string) {
  const found = (
    await db.execute(
      sql`SELECT round_id FROM competition_attempts WHERE id=${attemptId}::uuid`,
    )
  ).rows[0];
  if (!found) throw new CompetitionError("attempt_not_found", 404);
  return db.transaction(async (tx) => {
    const round = await lockRound(tx, found.round_id as string);
    assertRoundAvailable(round.rules);
    const attempt = (
      await tx.execute(
        sql`SELECT * FROM competition_attempts WHERE id=${attemptId}::uuid FOR UPDATE`,
      )
    ).rows[0] as unknown as Attempt;
    Object.assign(attempt, attemptDates(attempt));
    if (attempt.status !== "pending")
      return {
        attemptId,
        status: attempt.status,
        score: attempt.score,
        points: attempt.points,
        receipt: attempt.receipt,
        code: attempt.rejection_code,
      };
    if (!attempt.security_confirmed)
      return { attemptId, status: "pending", receipt: attempt.receipt };
    if (!["open", "closing"].includes(round.status))
      throw new CompetitionError("round_frozen");
    const result = verifyCompetitionTrace(attempt.trace);
    let rejection: string | null = result.ok ? null : result.code;
    if (
      result.ok &&
      (result.gameId !== attempt.game_id || result.seed !== attempt.seed)
    )
      rejection = "challenge_mismatch";
    if (
      result.ok &&
      (result.ticks * 1000) / 60 >
        attempt.received_at!.getTime() - attempt.issued_at.getTime() + 1000
    )
      rejection = "impossible_duration";
    if (rejection || !result.ok) {
      await tx.execute(
        sql`UPDATE competition_attempts SET status='rejected',rejection_code=${rejection ?? "invalid_trace"} WHERE id=${attemptId}::uuid`,
      );
      return {
        attemptId,
        status: "rejected",
        code: rejection,
        receipt: attempt.receipt,
      };
    }
    const points = pointsForScore(round.rules, attempt.game_id, result.score);
    await tx.execute(
      sql`UPDATE competition_attempts SET status='verified',score=${result.score},points=${points} WHERE id=${attemptId}::uuid`,
    );
    const daily = await recomputeDailyBestTx(tx, {
      roundId: round.id,
      memberId: attempt.member_id,
      gameId: attempt.game_id,
      scorePeriodKey: attempt.score_period_key,
      reason: "verified_attempt",
      rules: round.rules,
    });
    return {
      attemptId,
      status: "verified",
      score: result.score,
      points,
      dailyPoints: daily.points,
      scorePeriodKey: attempt.score_period_key,
      scorePeriodPoints: daily.points,
      fullArenaBonusPoints: daily.bonus.points,
      receipt: attempt.receipt,
    };
  });
}
