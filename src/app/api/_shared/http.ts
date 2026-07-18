/**
 * Shared route-handler guards (TECH_SPEC §10, §14): same-origin validation
 * for mutations, strict JSON parsing, and session resolution from the
 * host-only cookie. Fail closed when the database is unavailable.
 */

import { NextRequest, NextResponse } from "next/server";
import { getDb, type Db } from "@/db/client";
import {
  resolveSession,
  SESSION_COOKIE,
  type SessionDevice,
} from "@/server/identity";

export function sameOriginOk(request: NextRequest): boolean {
  const origin = request.headers.get("origin");
  if (!origin) return true; // same-origin GET/HEAD and some agents omit it
  return origin === new URL(request.url).origin;
}

export function jsonError(
  status: number,
  code: string,
): NextResponse<{ code: string }> {
  return NextResponse.json({ code }, { status });
}

export async function readJsonBody(
  request: NextRequest,
): Promise<Record<string, unknown> | null> {
  const contentType = request.headers.get("content-type") ?? "";
  if (!contentType.includes("application/json")) return null;
  try {
    const body: unknown = await request.json();
    if (typeof body !== "object" || body === null || Array.isArray(body)) {
      return null;
    }
    return body as Record<string, unknown>;
  } catch {
    return null;
  }
}

export interface GuardedContext {
  db: Db;
  device: SessionDevice;
}

/** DB + session guard for authenticated mutations. */
export async function requireSession(
  request: NextRequest,
): Promise<GuardedContext | NextResponse<{ code: string }>> {
  const db = getDb();
  if (!db) return jsonError(503, "service_unavailable");
  const token = request.cookies.get(SESSION_COOKIE)?.value;
  if (!token) return jsonError(401, "no_session");
  const device = await resolveSession(db, token);
  if (!device) return jsonError(401, "invalid_session");
  return { db, device };
}
