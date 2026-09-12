import { sql } from "drizzle-orm";
import type { Db } from "@/db/client";
import {
  rankCandidateStandings,
  type FinalStanding,
  type StandingContribution,
} from "./operations";
import { digest, type Round } from "./store";
import { assertRoundAvailable, parseRules, utcDay } from "./rules";
export async function roundStandings(db: Db, roundId: string) {
  const contributions = (
    await db.execute(
      sql`SELECT member_id AS "memberId",points,day_key AS "dayKey",received_at AS "receivedAt" FROM competition_daily_best WHERE round_id=${roundId}::uuid ORDER BY member_id,day_key,game_id`,
    )
  ).rows as unknown as StandingContribution[];
  const ranked = rankCandidateStandings(
    contributions.map((row) => ({
      ...row,
      receivedAt:
        row.receivedAt instanceof Date
          ? row.receivedAt
          : new Date(row.receivedAt),
    })),
  );
  const names = (
    await db.execute(
      sql`SELECT member_id,username FROM competition_profiles WHERE member_id IN (SELECT member_id FROM competition_enrollments WHERE round_id=${roundId}::uuid)`,
    )
  ).rows;
  const byId = new Map(
    names.map((row) => [row.member_id as string, row.username as string]),
  );
  return {
    ranked,
    public: ranked
      .filter((row) => byId.has(row.memberId))
      .map((row) => ({
        username: byId.get(row.memberId)!,
        rank: row.provisionalRank,
        totalPoints: row.totalPoints,
        maxDailyPoints: row.maxUtcDailyPoints,
      })),
  };
}

async function finalPublicStandings(db: Db, roundId: string) {
  const final = (
    await db.execute(
      sql`SELECT standings FROM competition_final_results WHERE round_id=${roundId}::uuid`,
    )
  ).rows[0] as { standings: FinalStanding[] } | undefined;
  if (!final) throw new Error("Final competition snapshot is missing");
  const names = (
    await db.execute(
      sql`SELECT member_id,username FROM competition_profiles WHERE member_id IN
          (SELECT member_id FROM competition_award_claims WHERE round_id=${roundId}::uuid
           UNION SELECT member_id FROM competition_enrollments WHERE round_id=${roundId}::uuid)`,
    )
  ).rows;
  const byId = new Map(
    names.map((row) => [row.member_id as string, row.username as string]),
  );
  return final.standings
    .filter((row) => byId.has(row.memberId))
    .map((row) => ({
      username: byId.get(row.memberId)!,
      rank: row.finalRank,
      totalPoints: row.totalPoints,
      maxDailyPoints: row.maxUtcDailyPoints,
    }));
}
export async function publicRound(db: Db, slug?: string) {
  const row = (
    await db.execute(
      slug
        ? sql`SELECT * FROM competition_rounds WHERE slug=${slug} AND status<>'draft' LIMIT 1`
        : sql`SELECT * FROM competition_rounds WHERE status<>'draft' ORDER BY opens_at DESC LIMIT 1`,
    )
  ).rows[0] as unknown as Round | undefined;
  if (!row) return { round: null, standings: [], provisional: true };
  row.rules = parseRules(row.rules);
  assertRoundAvailable(row.rules);
  const standing =
    row.status === "final"
      ? { public: await finalPublicStandings(db, row.id) }
      : await roundStandings(db, row.id);
  const opensAt =
    row.opens_at instanceof Date ? row.opens_at : new Date(row.opens_at);
  const closesAt =
    row.closes_at instanceof Date ? row.closes_at : new Date(row.closes_at);
  return {
    round: {
      id: row.id,
      slug: row.slug,
      status: row.status,
      opensAt: opensAt.toISOString(),
      closesAt: closesAt.toISOString(),
      mode: row.rules.mode,
      rules: row.rules,
      rulesDigest: digest(row.rules),
    },
    standings: standing.public,
    provisional: row.status !== "final",
  };
}
export async function memberRound(
  db: Db,
  memberId: string,
  emailVerified: boolean,
  roundId: string,
) {
  const [enrollment, profile, attempts, board, awards] = await Promise.all([
    db.execute(
      sql`SELECT 1 FROM competition_enrollments WHERE round_id=${roundId}::uuid AND member_id=${memberId}::uuid`,
    ),
    db.execute(
      sql`SELECT username FROM competition_profiles WHERE member_id=${memberId}::uuid`,
    ),
    db.execute(
      sql`SELECT id,game_id AS "gameId",day_key AS "dayKey",status,score,points FROM competition_attempts WHERE round_id=${roundId}::uuid AND member_id=${memberId}::uuid ORDER BY issued_at DESC LIMIT 200`,
    ),
    roundStandings(db, roundId),
    db.execute(
      sql`SELECT c.id,c.award_key AS "awardKey",c.status,c.final_rank AS rank
            FROM competition_award_claims c
            JOIN competition_final_results f ON f.id=c.final_result_id AND f.round_id=c.round_id
           WHERE c.round_id=${roundId}::uuid AND c.member_id=${memberId}::uuid
           ORDER BY c.final_rank,c.award_key,c.id`,
    ),
  ]);
  const today = utcDay(new Date());
  const all = attempts.rows;
  const mine = board.ranked.find((row) => row.memberId === memberId);
  return {
    enrolled: !!enrollment.rows.length,
    username: profile.rows[0]?.username ?? null,
    emailVerified,
    attempts: all,
    remaining: {
      snake: Math.max(
        0,
        3 -
          all.filter((a) => a.dayKey === today && a.gameId === "snake").length,
      ),
      flappy: Math.max(
        0,
        3 -
          all.filter((a) => a.dayKey === today && a.gameId === "flappy").length,
      ),
    },
    totalPoints: mine?.totalPoints ?? 0,
    rank: mine?.provisionalRank ?? null,
    awards: awards.rows,
  };
}
