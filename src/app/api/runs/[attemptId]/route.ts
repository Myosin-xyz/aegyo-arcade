/**
 * PUT /api/runs/:attemptId — idempotently submit a counted result
 * (TECH_SPEC §9.2, §10.1). The submission transaction completes the slot,
 * writes the cosmetic leaderboard score, advances the streak, and inserts
 * the outbox row atomically; replays return the original result.
 */

import { NextRequest, NextResponse } from "next/server";
import { submitCountedResult } from "@/server/runs";
import {
  jsonError,
  readJsonBody,
  requireSession,
  sameOriginOk,
} from "../../_shared/http";

const UUID_PATTERN =
  /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;

export async function PUT(
  request: NextRequest,
  context: { params: Promise<{ attemptId: string }> },
) {
  if (!sameOriginOk(request)) return jsonError(403, "bad_origin");
  const guarded = await requireSession(request);
  if (guarded instanceof NextResponse) return guarded;
  const { db, device } = guarded;

  const { attemptId } = await context.params;
  if (!UUID_PATTERN.test(attemptId)) return jsonError(400, "bad_request");
  const body = await readJsonBody(request);
  const score = body?.score;
  if (typeof score !== "number") return jsonError(400, "bad_request");
  const clientDurationMs =
    typeof body?.clientDurationMs === "number"
      ? body.clientDurationMs
      : undefined;

  const result = await submitCountedResult(db, {
    deviceId: device.deviceId,
    attemptId,
    score,
    clientDurationMs,
  });
  switch (result.kind) {
    case "accepted":
      return NextResponse.json({
        accepted: true,
        score: result.score,
        seasonKey: result.seasonKey,
        rank: result.rank,
        streak: result.streak,
        replay: result.replay,
      });
    case "invalid_attempt":
      return jsonError(409, "invalid_attempt");
    case "expired_attempt":
      return jsonError(409, "attempt_expired");
    case "bad_score":
      return jsonError(400, "bad_request");
    case "device_gone":
      return jsonError(401, "invalid_session");
  }
}
