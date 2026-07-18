/**
 * DELETE /api/privacy/device — tombstone device-linked data and revoke the
 * session (TECH_SPEC §8.1, §10). ONE transaction under the same per-device
 * advisory lock gameplay takes (M1 review B5): a concurrent claw play
 * either commits before the lock (its rows are deleted here) or acquires
 * the lock after (and sees the tombstoned device → rejected). Demo
 * gameplay rows are deleted outright; future material-prize records follow
 * promotion retention rules (`OPEN LEGAL DECISION`, §9.5) and are NOT
 * silently deleted here.
 */

import { and, eq, inArray, sql } from "drizzle-orm";
import { NextRequest, NextResponse } from "next/server";
import { clawPlays, promotions } from "@/db/schema";
import {
  deviceLockKey,
  tombstoneDeviceTx,
  SESSION_COOKIE,
} from "@/server/identity";
import { jsonError, requireSession, sameOriginOk } from "../../_shared/http";

export async function DELETE(request: NextRequest) {
  if (!sameOriginOk(request)) return jsonError(403, "bad_origin");
  const guarded = await requireSession(request);
  if (guarded instanceof NextResponse) return guarded;
  const { db, device } = guarded;

  await db.transaction(async (tx) => {
    // Same lock class as recordClawPlay — serializes delete vs play.
    await tx.execute(
      sql`SELECT pg_advisory_xact_lock(hashtextextended(${deviceLockKey(device.deviceId)}, 0))`,
    );
    const demoPromotions = tx
      .select({ id: promotions.id })
      .from(promotions)
      .where(eq(promotions.kind, "demo"));
    await tx
      .delete(clawPlays)
      .where(
        and(
          eq(clawPlays.deviceId, device.deviceId),
          inArray(clawPlays.promotionId, demoPromotions),
        ),
      );
    await tombstoneDeviceTx(tx, device.deviceId);
  });

  const response = NextResponse.json({ ok: true });
  response.cookies.set({
    name: SESSION_COOKIE,
    value: "",
    httpOnly: true,
    secure: true,
    sameSite: "lax",
    path: "/",
    maxAge: 0,
  });
  return response;
}
