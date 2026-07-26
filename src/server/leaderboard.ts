/**
 * ONE ranking policy for every surface (M2 review P1): competition
 * ranking ("1224" — rank = 1 + count of strictly greater scores), and the
 * moderation predicate `flagged = false` applied EVERYWHERE. Flagged rows
 * are invisible to top lists, own-rank, and submission ranks alike.
 */

import { and, desc, eq, gt, gte, sql } from "drizzle-orm";
import { devices, leaderboardScores } from "@/db/schema";
import type { Tx } from "./daily-window";

/** Anything drizzle-queryable (db or transaction). */
type Queryable = Pick<Tx, "select">;

/**
 * A scoreless run is a real run — it consumes the daily slot and advances
 * the streak — but it does not PLACE on a cosmetic board. Without this, a
 * quiet season reads as broken rather than empty: production Snake showed
 * two 0-point runs tied at #1 (operator review, 2026-07-26).
 *
 * Deliberately a READ-time predicate, applied on every ranking surface
 * exactly like `flagged = false`. The row is still written, so no history
 * is lost and the policy is one predicate away from being reverted.
 */
export const MIN_PLACING_SCORE = 1;

/** The one row set that ranking is computed over, on every surface. */
function placedRows(gameId: string, seasonKey: string) {
  return and(
    eq(leaderboardScores.gameId, gameId),
    eq(leaderboardScores.seasonKey, seasonKey),
    eq(leaderboardScores.flagged, false),
    gte(leaderboardScores.score, MIN_PLACING_SCORE),
  );
}

/** Rank for a score, or `null` when the score does not place at all. */
export async function rankForScore(
  q: Queryable,
  gameId: string,
  seasonKey: string,
  score: number,
): Promise<number | null> {
  if (score < MIN_PLACING_SCORE) return null;
  const rows = await q
    .select({ count: sql<number>`count(*)::int` })
    .from(leaderboardScores)
    .where(
      and(placedRows(gameId, seasonKey), gt(leaderboardScores.score, score)),
    );
  return (rows[0]?.count ?? 0) + 1;
}

export interface BoardRow {
  rank: number;
  handle: string;
  score: number;
  you: boolean;
}

export interface SeasonBoard {
  seasonKey: string;
  top: BoardRow[];
  me: { rank: number; score: number } | null;
}

export async function getSeasonBoard(
  q: Queryable,
  gameId: string,
  seasonKey: string,
  deviceId: string,
): Promise<SeasonBoard> {
  const rows = await q
    .select({
      score: leaderboardScores.score,
      handle: devices.generatedHandle,
      deviceId: leaderboardScores.deviceId,
    })
    .from(leaderboardScores)
    .innerJoin(devices, eq(leaderboardScores.deviceId, devices.id))
    .where(placedRows(gameId, seasonKey))
    .orderBy(desc(leaderboardScores.score), leaderboardScores.acceptedAt)
    .limit(50);

  // Competition ranking within the sorted page: ties share a rank; the
  // next distinct score's rank counts everything above it.
  const top: BoardRow[] = [];
  for (let i = 0; i < rows.length; i++) {
    const rank =
      i > 0 && rows[i].score === rows[i - 1].score ? top[i - 1].rank : i + 1;
    top.push({
      rank,
      handle: rows[i].handle ?? "Player",
      score: rows[i].score,
      you: rows[i].deviceId === deviceId,
    });
  }

  const mine = await q
    .select({ score: leaderboardScores.score })
    .from(leaderboardScores)
    .where(
      and(
        placedRows(gameId, seasonKey),
        eq(leaderboardScores.deviceId, deviceId),
      ),
    )
    .orderBy(desc(leaderboardScores.score))
    .limit(1);

  // A player whose only runs were scoreless has no placement to show —
  // `placedRows` already excluded them, so `mine` is empty and `me` is
  // null, the same state as someone who has not played this season.
  const best = mine[0];
  const bestRank = best
    ? await rankForScore(q, gameId, seasonKey, best.score)
    : null;
  const me =
    best && bestRank !== null ? { rank: bestRank, score: best.score } : null;

  return { seasonKey, top, me };
}
