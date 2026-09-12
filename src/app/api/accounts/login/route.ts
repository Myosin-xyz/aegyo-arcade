import { NextResponse } from "next/server";
import { getAccountsConfig, NORMAL_MAX_AGE_SECONDS } from "@/accounts/config";
import { authorizationRedirect } from "@/accounts/http";
import { safeAccountReturnTo } from "@/accounts/transaction";

export async function GET(request?: Request): Promise<NextResponse> {
  const config = getAccountsConfig();
  if (!config) return NextResponse.json({ code: "not_found" }, { status: 404 });
  try {
    return await authorizationRedirect(config, {
      maxAgeSeconds: NORMAL_MAX_AGE_SECONDS,
      reauthenticationAttempt: 0,
      returnTo: safeAccountReturnTo(
        request ? new URL(request.url).searchParams.get("returnTo") : null,
      ),
    });
  } catch {
    return NextResponse.json(
      { code: "identity_provider_unavailable" },
      { status: 503 },
    );
  }
}
