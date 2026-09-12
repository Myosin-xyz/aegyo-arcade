import { sql } from "drizzle-orm";
import type { Db } from "@/db/client";
import {
  rankCandidateStandings,
  type FinalStanding,
  type StandingContribution,
} from "./operations";
import { digest, type Round } from "./store";
import type { GameHighScore } from "./operations-store";
import { assertRoundAvailable, parseRules, publicRules, utcDay } from "./rules";
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

function compareHighScores(
  a: { gameId: string; username: string; score: number },
  b: { gameId: string; username: string; score: number },
) {
  return (
    (a.gameId < b.gameId ? -1 : a.gameId > b.gameId ? 1 : 0) ||
    b.score - a.score ||
    (a.username < b.username ? -1 : a.username > b.username ? 1 : 0)
  );
}

async function liveGameHighScores(db: Db, roundId: string) {
  const result = (
    await db.execute(sql`
      SELECT DISTINCT ON (a.member_id,a.game_id)
             a.game_id AS "gameId",p.username,a.score
        FROM competition_attempts a
        JOIN competition_profiles p ON p.member_id=a.member_id
        JOIN competition_enrollments e ON e.round_id=a.round_id AND e.member_id=a.member_id
       WHERE a.round_id=${roundId}::uuid AND a.status='verified' AND a.score IS NOT NULL
       ORDER BY a.member_id,a.game_id,a.score DESC,a.received_at ASC,a.id ASC
    `)
  ).rows as unknown as { gameId: string; username: string; score: number }[];
  return result.sort(compareHighScores);
}

async function finalPublishedRound(db: Db, roundId: string) {
  const final = (
    await db.execute(
      sql`SELECT f.standings,s.game_high_scores AS "gameHighScores"
            FROM competition_final_results f
            JOIN competition_candidate_snapshots s ON s.id=f.candidate_snapshot_id
           WHERE f.round_id=${roundId}::uuid`,
    )
  ).rows[0] as
    { standings: FinalStanding[]; gameHighScores: GameHighScore[] } | undefined;
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
  const standings = final.standings
    .filter((row) => byId.has(row.memberId))
    .map((row) => ({
      username: byId.get(row.memberId)!,
      rank: row.finalRank,
      totalPoints: row.totalPoints,
      maxDailyPoints: row.maxUtcDailyPoints,
    }));
  const gameHighScores = final.gameHighScores
    .filter((row) => byId.has(row.memberId))
    .map((row) => ({
      gameId: row.gameId,
      username: byId.get(row.memberId)!,
      score: row.score,
    }))
    .sort(compareHighScores);
  return { standings, gameHighScores };
}
export async function publicRound(db: Db, slug?: string) {
  const materialVisible =
    process.env.ARCADE_MATERIAL_COMPETITION_ENABLED === "true";
  const row = (
    await db.execute(
      slug
        ? sql`SELECT *,statement_timestamp() AS server_now FROM competition_rounds WHERE slug=${slug} AND status<>'draft' LIMIT 1`
        : sql`SELECT *,statement_timestamp() AS server_now FROM competition_rounds
              WHERE status<>'draft' AND (rules->>'mode'='synthetic' OR ${materialVisible})
              ORDER BY CASE
                WHEN status='open' AND opens_at<=statement_timestamp() AND closes_at>statement_timestamp() THEN 0
                WHEN status='open' AND opens_at>statement_timestamp() THEN 1
                ELSE 2 END,
                CASE WHEN status='open' AND opens_at>statement_timestamp() THEN opens_at END ASC,
                opens_at DESC
              LIMIT 1`,
    )
  ).rows[0] as unknown as (Round & { server_now: Date | string }) | undefined;
  const rounds = (
    await db.execute(sql`SELECT slug,status,opens_at,closes_at FROM competition_rounds
      WHERE status<>'draft' AND (rules->>'mode'='synthetic' OR ${materialVisible})
      ORDER BY opens_at DESC LIMIT 12`)
  ).rows.map((item) => ({
    slug: String(item.slug),
    status: String(item.status),
    opensAt: new Date(item.opens_at as string | Date).toISOString(),
    closesAt: new Date(item.closes_at as string | Date).toISOString(),
  }));
  if (!row) return { round: null, rounds, standings: [], provisional: true };
  row.rules = parseRules(row.rules);
  assertRoundAvailable(row.rules);
  const finalized =
    row.status === "final" ? await finalPublishedRound(db, row.id) : null;
  const standing = finalized ? null : await roundStandings(db, row.id);
  const gameHighScores = finalized
    ? finalized.gameHighScores
    : await liveGameHighScores(db, row.id);
  const opensAt =
    row.opens_at instanceof Date ? row.opens_at : new Date(row.opens_at);
  const closesAt =
    row.closes_at instanceof Date ? row.closes_at : new Date(row.closes_at);
  return {
    serverNow: new Date(row.server_now).toISOString(),
    rounds,
    round: {
      id: row.id,
      slug: row.slug,
      status: row.status,
      opensAt: opensAt.toISOString(),
      closesAt: closesAt.toISOString(),
      mode: row.rules.mode,
      rules: publicRules(row.rules),
      rulesDigest: digest(row.rules),
    },
    standings: finalized?.standings ?? standing!.public,
    gameHighScores,
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
