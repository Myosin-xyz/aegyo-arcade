import { NextResponse } from "next/server";
import {
  getAccountsConfig,
  NORMAL_MAX_AGE_SECONDS,
  parseAccountClient,
} from "@/accounts/config";
import { authorizationRedirect } from "@/accounts/http";
import { safeAccountReturnTo } from "@/accounts/transaction";

export async function GET(request?: Request): Promise<NextResponse> {
  const config = getAccountsConfig();
  if (!config) return NextResponse.json({ code: "not_found" }, { status: 404 });
  const params = request ? new URL(request.url).searchParams : null;
  try {
    return await authorizationRedirect(config, {
      maxAgeSeconds: NORMAL_MAX_AGE_SECONDS,
      reauthenticationAttempt: 0,
      returnTo: safeAccountReturnTo(params?.get("returnTo") ?? null),
      // `client=mobile` (exact) selects the mobile session TTL; else web.
      client: parseAccountClient(params?.get("client")),
    });
  } catch {
    return NextResponse.json(
      { code: "identity_provider_unavailable" },
      { status: 503 },
    );
  }
}
