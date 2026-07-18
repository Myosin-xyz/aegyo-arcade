/**
 * POST /api/runs — issue (or idempotently recover) the device's counted
 * attempt for a game under OD-1 (TECHSPEC §9.2, §10). One completed
 * counted run per player-local day, portal-wide; issuance never burns
 * the entitlement.
 */

import { NextRequest, NextResponse } from "next/server";
import { issueCountedAttempt } from "@/server/runs";
import {
  jsonError,
  readJsonBody,
  requireSession,
  sameOriginOk,
} from "../_shared/http";

const GAME_ID_PATTERN = /^[a-z0-9-]{2,32}$/;

export async function POST(request: NextRequest) {
  if (!sameOriginOk(request)) return jsonError(403, "bad_origin");
  const guarded = await requireSession(request);
  if (guarded instanceof NextResponse) return guarded;
  const { db, device } = guarded;

  const body = await readJsonBody(request);
  const gameId = body?.gameId;
  if (typeof gameId !== "string" || !GAME_ID_PATTERN.test(gameId)) {
    return jsonError(400, "bad_request");
  }

  const result = await issueCountedAttempt(db, {
    deviceId: device.deviceId,
    timeZone: device.timeZone,
    gameId,
  });
  switch (result.kind) {
    case "issued":
      return NextResponse.json({
        attemptId: result.attemptId,
        gameId: result.gameId,
        seed: result.seed,
        expiresAt: result.expiresAt.toISOString(),
        reissued: result.reissued,
      });
    case "slot_used":
      return NextResponse.json(
        {
          code: "daily_slot_used",
          nextEligibleAt: result.nextEligibleAt.toISOString(),
        },
        { status: 409 },
      );
    case "unknown_game":
      return jsonError(400, "bad_request");
    case "device_gone":
      return jsonError(401, "invalid_session");
  }
}
