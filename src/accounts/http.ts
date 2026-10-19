import { NextResponse } from "next/server";
import type { AccountClient, AccountsConfig } from "./config";
import {
  MEMBER_COOKIE,
  OIDC_TRANSACTION_COOKIE,
  SECURE_COOKIE,
} from "./cookies";
import { beginAuthorization } from "./provider";
import { sealTransaction } from "./transaction";

export async function authorizationRedirect(
  config: AccountsConfig,
  input: {
    maxAgeSeconds: number;
    reauthenticationAttempt: 0 | 1;
    returnTo?: string;
    client?: AccountClient;
    nowMs?: number;
  },
): Promise<NextResponse> {
  const authorization = await beginAuthorization(config, input);
  const response = NextResponse.redirect(authorization.url);
  response.cookies.set({
    name: OIDC_TRANSACTION_COOKIE,
    value: sealTransaction(authorization.transaction, config.transactionSecret),
    ...SECURE_COOKIE,
    maxAge: 10 * 60,
  });
  return response;
}

/** `maxAge` must equal the TTL the member session row was created with. */
export function setMemberCookie(
  response: NextResponse,
  token: string,
  options: { maxAge: number },
): void {
  response.cookies.set({
    name: MEMBER_COOKIE,
    value: token,
    ...SECURE_COOKIE,
    maxAge: options.maxAge,
  });
}

export function clearAccountsCookies(response: NextResponse): void {
  for (const name of [MEMBER_COOKIE, OIDC_TRANSACTION_COOKIE])
    response.cookies.set({ name, value: "", ...SECURE_COOKIE, maxAge: 0 });
}

export function clearTransactionCookie(response: NextResponse): void {
  response.cookies.set({
    name: OIDC_TRANSACTION_COOKIE,
    value: "",
    ...SECURE_COOKIE,
    maxAge: 0,
  });
}
