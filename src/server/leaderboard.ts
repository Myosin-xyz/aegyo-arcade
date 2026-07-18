/**
 * ONE ranking policy for every surface (M2 review P1): competition
 * ranking ("1224" — rank = 1 + count of strictly greater scores), and the
 * moderation predicate `flagged = false` applied EVERYWHERE. Flagged rows
 * are invisible to top lists, own-rank, and submission ranks alike.
 */

import { and, desc, eq, gt, sql } from "drizzle-orm";
import { devices, leaderboardScores } from "@/db/schema";
import type { Tx } from "./daily-window";

/** Anything drizzle-queryable (db or transaction). */
type Queryable = Pick<Tx, "select">;

export async function rankForScore(
  q: Queryable,
  gameId: string,
  seasonKey: string,
  score: number,
): Promise<number> {
  const rows = await q
    .select({ count: sql<number>`count(*)::int` })
    .from(leaderboardScores)
    .where(
      and(
        eq(leaderboardScores.gameId, gameId),
        eq(leaderboardScores.seasonKey, seasonKey),
        eq(leaderboardScores.flagged, false),
        gt(leaderboardScores.score, score),
      ),
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
    .where(
      and(
        eq(leaderboardScores.gameId, gameId),
        eq(leaderboardScores.seasonKey, seasonKey),
        eq(leaderboardScores.flagged, false),
      ),
    )
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
        eq(leaderboardScores.gameId, gameId),
        eq(leaderboardScores.seasonKey, seasonKey),
        eq(leaderboardScores.deviceId, deviceId),
        eq(leaderboardScores.flagged, false),
      ),
    )
    .orderBy(desc(leaderboardScores.score))
    .limit(1);

  const me = mine[0]
    ? {
        rank: await rankForScore(q, gameId, seasonKey, mine[0].score),
        score: mine[0].score,
      }
    : null;

  return { seasonKey, top, me };
}
