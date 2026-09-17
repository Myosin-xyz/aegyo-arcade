import { NextRequest, NextResponse } from "next/server";
import { getDb } from "@/db/client";
import { getAccountsConfig } from "@/accounts/config";
import { MEMBER_COOKIE } from "@/accounts/cookies";
import { authorizeMemberSession } from "@/accounts/authorization";
import { resolveMemberSession } from "@/accounts/sessions";
import { CompetitionError, competitionEnabled } from "./rules";
export const UUID =
  /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;
export const response = (body: unknown, status = 200) =>
  NextResponse.json(body, {
    status,
    headers: { "Cache-Control": "private, no-store" },
  });
export function competitionDatabase() {
  if (!competitionEnabled()) throw new CompetitionError("not_found", 404);
  const db = getDb();
  if (!db) throw new CompetitionError("service_unavailable", 503);
  return db;
}
export async function memberContext(
  request: NextRequest,
  { quarantine = false, mutation = false } = {},
) {
  const db = competitionDatabase();
  const config = getAccountsConfig();
  if (!config) throw new CompetitionError("accounts_unavailable", 503);
  if (mutation && request.headers.get("origin") !== config.appOrigin)
    throw new CompetitionError("bad_origin", 403);
  const token = request.cookies.get(MEMBER_COOKIE)?.value;
  if (!token) throw new CompetitionError("sign_in_required", 401);
  const authorization = await authorizeMemberSession(db, config, token, {
    sensitive: true,
  });
  if (authorization.kind === "allowed")
    return { db, session: authorization.session, securityConfirmed: true };
  if (authorization.kind === "unavailable" && quarantine) {
    const local = await resolveMemberSession(db, token);
    if (local) return { db, session: local, securityConfirmed: false };
  }
  throw new CompetitionError(
    authorization.kind === "unavailable"
      ? "identity_provider_unavailable"
      : "sign_in_required",
    authorization.kind === "unavailable" ? 503 : 401,
  );
}
export async function boundedBody(
  request: NextRequest,
  limit = 1024,
): Promise<Record<string, unknown>> {
  if (
    !request.headers
      .get("content-type")
      ?.toLowerCase()
      .startsWith("application/json")
  )
    throw new CompetitionError("invalid_body", 400);
  const reader = request.body?.getReader();
  if (!reader) throw new CompetitionError("invalid_body", 400);
  const chunks: Uint8Array[] = [];
  let size = 0;
  try {
    for (;;) {
      const { done, value } = await reader.read();
      if (done) break;
      size += value.byteLength;
      if (size > limit) {
        await reader.cancel();
        throw new CompetitionError("body_too_large", 413);
      }
      chunks.push(value);
    }
  } finally {
    reader.releaseLock();
  }
  const bytes = new Uint8Array(size);
  let offset = 0;
  for (const chunk of chunks) {
    bytes.set(chunk, offset);
    offset += chunk.length;
  }
  try {
    const value: unknown = JSON.parse(
      new TextDecoder("utf-8", { fatal: true }).decode(bytes),
    );
    if (!value || typeof value !== "object" || Array.isArray(value))
      throw new Error();
    return value as Record<string, unknown>;
  } catch {
    throw new CompetitionError("invalid_body", 400);
  }
}
export async function handle(
  action: () => Promise<NextResponse>,
): Promise<NextResponse> {
  try {
    return await action();
  } catch (error) {
    return error instanceof CompetitionError
      ? response({ code: error.code }, error.status)
      : response({ code: "service_unavailable" }, 503);
  }
}
