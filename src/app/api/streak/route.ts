/**
 * GET /api/streak — EFFECTIVE visual streak (§10; M2 review P1): a missed
 * player-local day reads as zero immediately, computed from the device's
 * validated timezone with no writes outside the submission transaction.
 */

import { eq } from "drizzle-orm";
import { NextRequest, NextResponse } from "next/server";
import { streaks } from "@/db/schema";
import { effectiveStreak } from "@/server/streak";
import { requireSession } from "../_shared/http";

export async function GET(request: NextRequest) {
  const guarded = await requireSession(request);
  if (guarded instanceof NextResponse) return guarded;
  const { db, device } = guarded;

  const rows = await db
    .select({
      current: streaks.current,
      best: streaks.best,
      lastDayKey: streaks.lastDayKey,
    })
    .from(streaks)
    .where(eq(streaks.deviceId, device.deviceId));
  return NextResponse.json(effectiveStreak(rows[0] ?? null, device.timeZone));
}
