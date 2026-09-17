import { NextRequest, NextResponse } from "next/server";
import { authorizeMemberSession } from "@/accounts/authorization";
import { getAccountsConfig } from "@/accounts/config";
import { MEMBER_COOKIE } from "@/accounts/cookies";
import { clearAccountsCookies } from "@/accounts/http";
import {
  createCompetitionProfile,
  getCompetitionProfile,
  validateUsername,
} from "@/accounts/profile";
import { getDb } from "@/db/client";
import type { Db } from "@/db/client";
import type { MemberSession } from "@/accounts/sessions";

const MAX_BODY_BYTES = 256;
const PRIVATE_HEADERS = { "Cache-Control": "private, no-store" };

function json(body: object, status = 200): NextResponse {
  return NextResponse.json(body, { status, headers: PRIVATE_HEADERS });
}

type Authorized =
  | { kind: "error"; response: NextResponse }
  | {
      kind: "allowed";
      db: Db;
      session: MemberSession;
    };

async function authorized(request: NextRequest): Promise<Authorized> {
  const config = getAccountsConfig();
  if (!config)
    return { kind: "error", response: json({ code: "not_found" }, 404) };
  const db = getDb();
  if (!db)
    return {
      kind: "error",
      response: json({ code: "service_unavailable" }, 503),
    };
  const token = request.cookies.get(MEMBER_COOKIE)?.value;
  if (!token)
    return {
      kind: "error",
      response: json({ authenticated: false }, 401),
    };
  const authorization = await authorizeMemberSession(db, config, token, {
    sensitive: true,
  });
  if (authorization.kind === "unavailable") {
    return {
      kind: "error",
      response: json({ code: "identity_provider_unavailable" }, 503),
    };
  }
  if (authorization.kind === "invalid") {
    const response = json({ authenticated: false }, 401);
    clearAccountsCookies(response);
    return { kind: "error", response };
  }
  return { kind: "allowed", db, session: authorization.session };
}

export async function GET(request: NextRequest): Promise<NextResponse> {
  try {
    const context = await authorized(request);
    if (context.kind === "error") return context.response;
    const profile = await getCompetitionProfile(
      context.db,
      context.session.memberId,
    );
    return json({
      username: profile?.username ?? null,
      emailVerified: context.session.emailVerified,
      usernameEditable: profile === null && context.session.emailVerified,
    });
  } catch {
    return json({ code: "service_unavailable" }, 503);
  }
}

async function mutate(request: NextRequest): Promise<NextResponse> {
  const configured = getAccountsConfig();
  if (!configured) return json({ code: "not_found" }, 404);
  if (request.headers.get("origin") !== configured.appOrigin)
    return json({ code: "bad_origin" }, 403);
  const context = await authorized(request);
  if (context.kind === "error") return context.response;
  const declaredLength = Number(request.headers.get("content-length") ?? "0");
  if (Number.isFinite(declaredLength) && declaredLength > MAX_BODY_BYTES)
    return json({ code: "invalid_request" }, 400);
  const text = await request.text();
  if (new TextEncoder().encode(text).byteLength > MAX_BODY_BYTES)
    return json({ code: "invalid_request" }, 400);
  let body: unknown;
  try {
    body = JSON.parse(text);
  } catch {
    return json({ code: "invalid_request" }, 400);
  }
  if (!body || typeof body !== "object" || Array.isArray(body))
    return json({ code: "invalid_request" }, 400);
  const validation = validateUsername(
    (body as Record<string, unknown>).username,
  );
  if (!validation.ok)
    return json(
      {
        code:
          validation.reason === "reserved"
            ? "username_reserved"
            : "invalid_username",
      },
      400,
    );
  if (!context.session.emailVerified)
    return json({ code: "verified_email_required" }, 403);
  try {
    const result = await createCompetitionProfile(
      context.db,
      context.session.memberId,
      validation.username,
    );
    if (result.kind === "username_unavailable")
      return json({ code: "username_unavailable" }, 409);
    if (result.kind === "member_already_named")
      return json(
        { code: "username_already_set", username: result.username },
        409,
      );
    return json(
      {
        username: result.username,
        emailVerified: true,
        usernameEditable: false,
      },
      result.kind === "created" ? 201 : 200,
    );
  } catch {
    return json({ code: "service_unavailable" }, 503);
  }
}

export async function POST(request: NextRequest): Promise<NextResponse> {
  return mutate(request);
}

export async function PUT(request: NextRequest): Promise<NextResponse> {
  return mutate(request);
}
