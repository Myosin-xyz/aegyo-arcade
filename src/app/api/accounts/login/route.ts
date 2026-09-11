import { NextResponse } from "next/server";
import { getAccountsConfig, NORMAL_MAX_AGE_SECONDS } from "@/accounts/config";
import { authorizationRedirect } from "@/accounts/http";

export async function GET(): Promise<NextResponse> {
  const config = getAccountsConfig();
  if (!config) return NextResponse.json({ code: "not_found" }, { status: 404 });
  try {
    return await authorizationRedirect(config, {
      maxAgeSeconds: NORMAL_MAX_AGE_SECONDS,
      reauthenticationAttempt: 0,
    });
  } catch {
    return NextResponse.json(
      { code: "identity_provider_unavailable" },
      { status: 503 },
    );
  }
}
