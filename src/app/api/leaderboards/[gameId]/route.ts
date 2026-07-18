/**
 * GET /api/leaderboards/:gameId — current cosmetic weekly season
 * (§8.3, META-2) via the ONE shared ranking policy (competition ranking,
 * flagged rows invisible everywhere — M2 review P1).
 */

import { NextRequest, NextResponse } from "next/server";
import { getSeasonBoard } from "@/server/leaderboard";
import { seasonKeyFor } from "@/server/season";
import { isCountedGame } from "@/server/games-config";
import { jsonError, requireSession } from "../../_shared/http";

export async function GET(
  request: NextRequest,
  context: { params: Promise<{ gameId: string }> },
) {
  const guarded = await requireSession(request);
  if (guarded instanceof NextResponse) return guarded;
  const { db, device } = guarded;

  const { gameId } = await context.params;
  if (!isCountedGame(gameId)) return jsonError(404, "unknown_game");

  const board = await getSeasonBoard(
    db,
    gameId,
    seasonKeyFor(new Date()),
    device.deviceId,
  );
  return NextResponse.json(board);
}
