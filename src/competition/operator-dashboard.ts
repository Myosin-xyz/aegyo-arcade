import { sql } from "drizzle-orm";
import type { Db } from "@/db/client";
import { operatorReviewBundle } from "./operations-store";
import { CompetitionError } from "./rules";

type SqlRows<T> = { rows: T[] };

function rows<T>(result: unknown): T[] {
  return (result as SqlRows<T>).rows;
}

function iso(value: Date | string | null): string | null {
  if (value === null) return null;
  return new Date(value).toISOString();
}

type RoundRow = {
  id: string;
  slug: string;
  status: string;
  mode: string;
  opens_at: Date | string;
  closes_at: Date | string;
  enrollment_count: number | string;
  attempt_count: number | string;
  pending_count: number | string;
  candidate_snapshot_id: string | null;
  final_result_id: string | null;
};

export async function competitionOperatorDashboard(
  db: Db,
  selectedRoundId?: string,
) {
  const roundRows = rows<RoundRow>(
    await db.execute(sql`
      SELECT r.id,r.slug,r.status,r.rules->>'mode' AS mode,r.opens_at,r.closes_at,
             count(DISTINCT e.member_id)::int AS enrollment_count,
             count(DISTINCT a.id)::int AS attempt_count,
             count(DISTINCT a.id) FILTER (WHERE a.status='pending')::int AS pending_count,
             max(s.id::text) AS candidate_snapshot_id,
             max(f.id::text) AS final_result_id
        FROM competition_rounds r
        LEFT JOIN competition_enrollments e ON e.round_id=r.id
        LEFT JOIN competition_attempts a ON a.round_id=r.id
        LEFT JOIN competition_candidate_snapshots s ON s.round_id=r.id
        LEFT JOIN competition_final_results f ON f.round_id=r.id
       GROUP BY r.id,r.slug,r.status,r.rules,r.opens_at,r.closes_at
       ORDER BY r.opens_at DESC,r.id DESC
       LIMIT 24
    `),
  );
  const rounds = roundRows.map((round) => ({
    id: round.id,
    slug: round.slug,
    status: round.status,
    mode: round.mode,
    opensAt: iso(round.opens_at)!,
    closesAt: iso(round.closes_at)!,
    enrollmentCount: Number(round.enrollment_count),
    attemptCount: Number(round.attempt_count),
    pendingCount: Number(round.pending_count),
    hasCandidateSnapshot: round.candidate_snapshot_id !== null,
    isFinal: round.final_result_id !== null,
  }));
  const roundId = selectedRoundId ?? rounds[0]?.id;
  if (!roundId)
    return {
      serverNow: new Date().toISOString(),
      rounds,
      selected: null,
    };
  if (!rounds.some((round) => round.id === roundId))
    throw new CompetitionError("round_not_found", 404);

  const [review, attemptsResult, awardsResult, auditResult] = await Promise.all(
    [
      operatorReviewBundle(db, roundId),
      db.execute(sql`
      SELECT a.id,a.game_id,a.status,a.security_confirmed,a.score,a.points,
             a.received_at,a.rejection_code,p.username
        FROM competition_attempts a
        LEFT JOIN competition_profiles p ON p.member_id=a.member_id
       WHERE a.round_id=${roundId}::uuid
         AND a.status IN ('pending','rejected','void')
       ORDER BY a.received_at DESC,a.id DESC
       LIMIT 100
    `),
      db.execute(sql`
      SELECT c.id,c.member_id,c.final_rank,c.award_key,c.status,c.claimed_at,
             c.fulfilled_at,p.username
        FROM competition_award_claims c
        LEFT JOIN competition_profiles p ON p.member_id=c.member_id
       WHERE c.round_id=${roundId}::uuid
       ORDER BY c.final_rank,c.award_key,c.id
    `),
      db.execute(sql`
      SELECT id,operation,actor,created_at
        FROM competition_operation_audit
       WHERE round_id=${roundId}::uuid
       ORDER BY created_at DESC,id DESC
       LIMIT 100
    `),
    ],
  );

  const profileRows = review.candidate
    ? rows<{ member_id: string; username: string }>(
        await db.execute(sql`
          SELECT member_id,username FROM competition_profiles
           WHERE member_id IN (
             SELECT member_id FROM competition_enrollments
              WHERE round_id=${roundId}::uuid
           )
        `),
      )
    : [];
  const usernames = new Map(
    profileRows.map((profile) => [profile.member_id, profile.username]),
  );

  return {
    serverNow: new Date().toISOString(),
    rounds,
    selected: {
      round: rounds.find((round) => round.id === roundId)!,
      pending: review.pending,
      candidate: review.candidate
        ? {
            ...review.candidate,
            standings: review.candidate.standings.map((standing) => ({
              ...standing,
              username: usernames.get(standing.memberId) ?? null,
            })),
          }
        : null,
      tieDecisions: review.tieDecisions,
      attempts: rows<{
        id: string;
        game_id: string;
        status: string;
        security_confirmed: boolean;
        score: number | null;
        points: number | null;
        received_at: Date | string | null;
        rejection_code: string | null;
        username: string | null;
      }>(attemptsResult).map((attempt) => ({
        id: attempt.id,
        gameId: attempt.game_id,
        status: attempt.status,
        securityConfirmed: attempt.security_confirmed,
        score: attempt.score,
        points: attempt.points,
        receivedAt: iso(attempt.received_at),
        rejectionCode: attempt.rejection_code,
        username: attempt.username,
      })),
      awards: rows<{
        id: string;
        member_id: string;
        final_rank: number;
        award_key: string;
        status: string;
        claimed_at: Date | string | null;
        fulfilled_at: Date | string | null;
        username: string | null;
      }>(awardsResult).map((award) => ({
        id: award.id,
        memberId: award.member_id,
        rank: award.final_rank,
        awardKey: award.award_key,
        status: award.status,
        claimedAt: iso(award.claimed_at),
        fulfilledAt: iso(award.fulfilled_at),
        username: award.username,
      })),
      audit: rows<{
        id: string;
        operation: string;
        actor: string;
        created_at: Date | string;
      }>(auditResult).map((entry) => ({
        id: entry.id,
        operation: entry.operation,
        actor: entry.actor,
        createdAt: iso(entry.created_at)!,
      })),
    },
  };
}
