/**
 * POST /api/session — issue/refresh the host-only pseudonymous session
 * (TECH_SPEC §8.1, §10). Accepts an optional validated IANA timezone.
 * Returns locale/handle only — never a device ID.
 */

import { NextRequest, NextResponse } from "next/server";
import { getDb } from "@/db/client";
import {
  createDeviceSession,
  resolveSession,
  touchSession,
  SESSION_COOKIE,
  SESSION_TTL_DAYS,
} from "@/server/identity";
import { jsonError, readJsonBody, sameOriginOk } from "../_shared/http";

export async function POST(request: NextRequest) {
  if (!sameOriginOk(request)) return jsonError(403, "bad_origin");
  const db = getDb();
  if (!db) return jsonError(503, "service_unavailable");

  const body = (await readJsonBody(request)) ?? {};
  const timeZone = body.timeZone;
  // §12.1: the client preference updates the device record. Allowlisted
  // — junk never reaches the column.
  const locale =
    body.locale === "en" || body.locale === "es-419" ? body.locale : undefined;

  const existingToken = request.cookies.get(SESSION_COOKIE)?.value;
  if (existingToken) {
    const device = await resolveSession(db, existingToken);
    if (device) {
      // ROLLING session (§8.1): every visit extends both the DB row and
      // the cookie — retention is 90 days since last activity. A null
      // expiry means a deletion raced us — fall through to a new identity.
      const touched = await touchSession(
        db,
        existingToken,
        device,
        timeZone,
        locale,
      );
      if (touched.expiresAt) {
        const response = NextResponse.json({
          ok: true,
          // Effective locale: touchSession may just have persisted the
          // requested change; the pre-update record would be stale.
          locale: locale ?? device.locale,
          handle: device.handle,
        });
        response.cookies.set({
          name: SESSION_COOKIE,
          value: existingToken,
          httpOnly: true,
          secure: true,
          sameSite: "lax",
          path: "/",
          maxAge: SESSION_TTL_DAYS * 24 * 60 * 60,
        });
        return response;
      }
    }
  }

  const created = await createDeviceSession(db, { timeZone, locale });
  const response = NextResponse.json({
    ok: true,
    locale: created.device.locale,
    handle: created.device.handle,
  });
  response.cookies.set({
    name: SESSION_COOKIE,
    value: created.token,
    httpOnly: true,
    secure: true,
    sameSite: "lax",
    path: "/",
    maxAge: SESSION_TTL_DAYS * 24 * 60 * 60,
  });
  return response;
}
