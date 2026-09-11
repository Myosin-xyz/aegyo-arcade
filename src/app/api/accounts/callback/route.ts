import { NextRequest, NextResponse } from "next/server";
import { getAccountsConfig } from "@/accounts/config";
import { OIDC_TRANSACTION_COOKIE } from "@/accounts/cookies";
import {
  clearTransactionCookie,
  authorizationRedirect,
  setMemberCookie,
} from "@/accounts/http";
import { finishAuthorization } from "@/accounts/provider";
import { fetchProviderSecurityState } from "@/accounts/security-state";
import {
  evaluateFreshness,
  parseResetInstant,
  type ResetState,
} from "@/accounts/freshness";
import { createMemberSession } from "@/accounts/sessions";
import { openTransaction } from "@/accounts/transaction";
import { getDb } from "@/db/client";
import { canonicalExternalRequestUrl } from "@/server/request-origin";

function failure(code: string, status = 400): NextResponse {
  const response = NextResponse.json({ code }, { status });
  clearTransactionCookie(response);
  return response;
}

function resetClaimMatches(
  claim: unknown,
  current: { version: 1; kind: "database"; lastPasswordReset: string | null },
): boolean {
  if (!claim || typeof claim !== "object" || Array.isArray(claim)) return false;
  const value = claim as Record<string, unknown>;
  return (
    value.version === current.version &&
    value.kind === current.kind &&
    value.lastPasswordReset === current.lastPasswordReset
  );
}

export async function GET(request: NextRequest): Promise<NextResponse> {
  const config = getAccountsConfig();
  if (!config) return NextResponse.json({ code: "not_found" }, { status: 404 });
  const callbackUrl = canonicalExternalRequestUrl(request, config.appOrigin);
  if (
    callbackUrl === null ||
    callbackUrl.origin !== config.appOrigin ||
    callbackUrl.pathname !== "/api/accounts/callback"
  )
    return failure("invalid_callback_url");
  const transaction = openTransaction(
    request.cookies.get(OIDC_TRANSACTION_COOKIE)?.value,
    config.transactionSecret,
  );
  if (!transaction) return failure("invalid_authorization_transaction");
  const db = getDb();
  if (!db) return failure("service_unavailable", 503);
  try {
    const identity = await finishAuthorization(
      config,
      callbackUrl,
      transaction,
    );
    if (
      identity.issuer !== config.issuer ||
      !Number.isSafeInteger(identity.securityVersion) ||
      (identity.securityVersion as number) < 0
    )
      return failure("invalid_identity_claims");
    const operatorCutoffMs =
      identity.operatorCutoff === null
        ? null
        : parseResetInstant(identity.operatorCutoff);
    if (identity.operatorCutoff !== null && operatorCutoffMs === null)
      return failure("invalid_identity_claims");
    const providerState = await fetchProviderSecurityState(
      config,
      identity.subject,
      identity.providerSessionId,
    );
    if (providerState.kind === "unavailable")
      return failure("identity_provider_unavailable", 503);
    if (providerState.kind === "invalid")
      return failure("invalid_provider_security_state");
    const { state } = providerState;
    if (
      state.subject !== identity.subject ||
      state.providerSessionId !== identity.providerSessionId
    )
      return failure("invalid_provider_security_state");
    const decision = evaluateFreshness({
      authTime: identity.authTime,
      resetState: state.passwordResetState,
      operatorCutoffMs:
        state.operatorCutoff === null
          ? null
          : parseResetInstant(state.operatorCutoff),
      transaction,
      nowMs: Date.now(),
    });
    const signedStateMatches =
      identity.securityVersion === state.securityVersion &&
      identity.operatorCutoff === state.operatorCutoff &&
      resetClaimMatches(identity.resetState, state.passwordResetState);
    if (
      !state.active ||
      !signedStateMatches ||
      decision.kind === "reauthenticate"
    ) {
      if (transaction.reauthenticationAttempt === 1)
        return failure("reauthentication_failed");
      const notBeforeMs =
        decision.kind === "reauthenticate" ? decision.notBeforeMs : Date.now();
      const waitMs = Math.max(0, notBeforeMs - Date.now());
      if (waitMs) await new Promise((resolve) => setTimeout(resolve, waitMs));
      return authorizationRedirect(config, {
        maxAgeSeconds: 0,
        reauthenticationAttempt: 1,
        nowMs: Math.max(Date.now(), notBeforeMs),
      });
    }
    if (decision.kind !== "allow") return failure(decision.reason);
    const session = await createMemberSession(db, {
      issuer: identity.issuer,
      subject: identity.subject,
      providerSessionId: identity.providerSessionId,
      name: identity.name,
      picture: identity.picture,
      authenticatedAtMs: decision.authenticatedAtMs,
      securityVersion: state.securityVersion,
      resetState: state.passwordResetState as ResetState,
    });
    const response = NextResponse.redirect(new URL("/", config.appOrigin));
    clearTransactionCookie(response);
    setMemberCookie(response, session.token);
    return response;
  } catch {
    return failure("authorization_failed");
  }
}
