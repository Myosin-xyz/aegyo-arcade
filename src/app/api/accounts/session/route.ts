import { NextRequest, NextResponse } from "next/server";
import { getAccountsConfig } from "@/accounts/config";
import { MEMBER_COOKIE } from "@/accounts/cookies";
import { clearAccountsCookies } from "@/accounts/http";
import { authorizeMemberSession } from "@/accounts/authorization";
import { getDb } from "@/db/client";

export async function GET(request: NextRequest): Promise<NextResponse> {
  const config = getAccountsConfig();
  if (!config) return NextResponse.json({ code: "not_found" }, { status: 404 });
  const db = getDb();
  if (!db)
    return NextResponse.json({ code: "service_unavailable" }, { status: 503 });
  const token = request.cookies.get(MEMBER_COOKIE)?.value;
  if (!token)
    return NextResponse.json({ authenticated: false }, { status: 401 });
  const authorization = await authorizeMemberSession(db, config, token, {
    sensitive: false,
  });
  if (authorization.kind === "unavailable")
    return NextResponse.json(
      { code: "identity_provider_unavailable" },
      { status: 503 },
    );
  if (authorization.kind === "invalid") {
    const response = NextResponse.json(
      { authenticated: false },
      { status: 401 },
    );
    clearAccountsCookies(response);
    return response;
  }
  const { session } = authorization;
  return NextResponse.json({
    authenticated: true,
    member: { displayName: session.displayName, avatarUrl: session.avatarUrl },
  });
}
