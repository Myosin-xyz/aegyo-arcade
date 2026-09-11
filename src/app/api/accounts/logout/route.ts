import { NextRequest, NextResponse } from "next/server";
import { getAccountsConfig } from "@/accounts/config";
import { MEMBER_COOKIE } from "@/accounts/cookies";
import { clearAccountsCookies } from "@/accounts/http";
import { revokeMemberSession } from "@/accounts/sessions";
import { getDb } from "@/db/client";

export async function POST(request: NextRequest): Promise<NextResponse> {
  const config = getAccountsConfig();
  if (!config) return NextResponse.json({ code: "not_found" }, { status: 404 });
  const origin = request.headers.get("origin");
  if (origin && origin !== config.appOrigin)
    return NextResponse.json({ code: "bad_origin" }, { status: 403 });
  const db = getDb();
  if (!db)
    return NextResponse.json({ code: "service_unavailable" }, { status: 503 });
  const token = request.cookies.get(MEMBER_COOKIE)?.value;
  if (token) await revokeMemberSession(db, token);
  const response = NextResponse.json({ ok: true });
  clearAccountsCookies(response);
  return response;
}
