/**
 * POST /api/claw/plays — idempotent, capped, server-decided claw outcome
 * (TECH_SPEC §9.4, §10). Demo mode only in M1: gameplay result, no prize,
 * no claim, no inventory. Requires an active claw configuration; fails
 * closed without DB or session.
 */

import { NextRequest, NextResponse } from "next/server";
import { recordClawPlay } from "@/server/claw-play";
import {
  jsonError,
  readJsonBody,
  requireSession,
  sameOriginOk,
} from "../../_shared/http";

const KEY_PATTERN = /^[A-Za-z0-9_-]{8,128}$/;
const UUID_PATTERN =
  /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;

export async function POST(request: NextRequest) {
  if (!sameOriginOk(request)) return jsonError(403, "bad_origin");
  const guarded = await requireSession(request);
  if (guarded instanceof NextResponse) return guarded;
  const { db, device } = guarded;

  const body = await readJsonBody(request);
  const idempotencyKey = body?.idempotencyKey;
  const attemptId = body?.attemptId;
  if (typeof idempotencyKey !== "string" || !KEY_PATTERN.test(idempotencyKey)) {
    return jsonError(400, "bad_request");
  }
  // Server outcomes are COUNTED-only (§9.4): a claw attempt is required.
  if (typeof attemptId !== "string" || !UUID_PATTERN.test(attemptId)) {
    return jsonError(400, "bad_request");
  }

  const result = await recordClawPlay(db, {
    deviceId: device.deviceId,
    timeZone: device.timeZone,
    idempotencyKey,
    attemptId,
  });

  switch (result.kind) {
    case "played":
      return NextResponse.json({
        outcome: result.outcome,
        ordinal: result.ordinal,
        replay: result.replay,
      });
    case "no_active_promotion":
    case "material_prize_disabled":
      return jsonError(409, "promotion_inactive");
    case "invalid_attempt":
      return jsonError(409, "invalid_attempt");
    case "slot_used":
      return jsonError(409, "daily_slot_used");
    case "device_gone":
      return jsonError(401, "invalid_session");
    case "cap_reached":
      return NextResponse.json(
        { code: "cap_reached", cap: result.cap },
        { status: 409 },
      );
  }
}
