/**
 * Callback policy for already-verified OIDC claims. This does not verify JWTs.
 * The adapter must first validate issuer, audience, signature, nonce and state
 * with its OIDC SDK, and supply the server-stored authorization transaction.
 * No application session may be minted until this policy allows it.
 */
export const RESET_STATE_CLAIM =
  "https://aegyoarena.com/claims/password-reset-state";

export type ResetState = {
  version: 1;
  kind: "database";
  lastPasswordReset: string | null;
};

export type AuthorizationTransaction = {
  requestedAtMs: number;
  maxAgeSeconds: number;
  reauthenticationAttempt: 0 | 1;
};

export type FreshnessDecision =
  | { kind: "allow"; authenticatedAtMs: number }
  | {
      kind: "reauthenticate";
      reason: "stale_authentication";
      notBeforeMs: number;
      maxAgeSeconds: 0;
      reauthenticationAttempt: 1;
    }
  | {
      kind: "deny";
      reason:
        | "invalid_transaction"
        | "invalid_auth_time"
        | "invalid_reset_state"
        | "unsupported_connection"
        | "invalid_operator_cutoff"
        | "reauthentication_failed";
    };

function isRecord(value: unknown): value is Record<string, unknown> {
  return value !== null && typeof value === "object" && !Array.isArray(value);
}

function isInstant(value: unknown): value is number {
  return (
    typeof value === "number" &&
    Number.isSafeInteger(value) &&
    value >= 0 &&
    value <= 8.64e15
  );
}

/** Accept the provider's ISO UTC timestamp without silently normalizing dates. */
export function parseResetInstant(value: unknown): number | null {
  if (
    typeof value !== "string" ||
    !/^\d{4}-\d{2}-\d{2}T\d{2}:\d{2}:\d{2}(?:\.\d{1,3})?Z$/.test(value)
  ) {
    return null;
  }
  const ms = Date.parse(value);
  if (!isInstant(ms)) return null;
  const canonical = new Date(ms).toISOString();
  const expected = value.includes(".")
    ? value.replace(
        /\.(\d+)Z$/,
        (_, fraction: string) => `.${fraction.padEnd(3, "0")}Z`,
      )
    : value.replace("Z", ".000Z");
  return canonical === expected ? ms : null;
}

/**
 * A whole-second auth_time represents an interval. Require its lower bound
 * to meet the cutoff. A reset grace period would also admit old SSO within
 * that period; instead delay the single fresh-login retry past the interval.
 */
export function evaluateFreshness(input: {
  authTime: unknown;
  resetState: unknown;
  operatorCutoffMs: number | null;
  transaction: AuthorizationTransaction;
  nowMs: number;
}): FreshnessDecision {
  const { transaction, nowMs, authTime, resetState, operatorCutoffMs } = input;
  if (
    !transaction ||
    !isInstant(nowMs) ||
    !isInstant(transaction.requestedAtMs) ||
    transaction.requestedAtMs > nowMs ||
    !Number.isSafeInteger(transaction.maxAgeSeconds) ||
    transaction.maxAgeSeconds < 0 ||
    transaction.maxAgeSeconds > 2_147_483_647 ||
    ![0, 1].includes(transaction.reauthenticationAttempt) ||
    (transaction.reauthenticationAttempt === 1 &&
      transaction.maxAgeSeconds !== 0)
  ) {
    return { kind: "deny", reason: "invalid_transaction" };
  }
  if (
    typeof authTime !== "number" ||
    !Number.isSafeInteger(authTime) ||
    !isInstant(authTime * 1000) ||
    authTime > Math.floor(nowMs / 1000)
  ) {
    return { kind: "deny", reason: "invalid_auth_time" };
  }
  if (!isRecord(resetState) || resetState.version !== 1) {
    return { kind: "deny", reason: "invalid_reset_state" };
  }
  if (resetState.kind === "unsupported") {
    return { kind: "deny", reason: "unsupported_connection" };
  }
  if (
    resetState.kind !== "database" ||
    !Object.hasOwn(resetState, "lastPasswordReset")
  ) {
    return { kind: "deny", reason: "invalid_reset_state" };
  }
  const resetMs =
    resetState.lastPasswordReset === null
      ? null
      : parseResetInstant(resetState.lastPasswordReset);
  if (
    (resetMs === null && resetState.lastPasswordReset !== null) ||
    (resetMs !== null && resetMs > nowMs)
  ) {
    return { kind: "deny", reason: "invalid_reset_state" };
  }
  if (
    operatorCutoffMs !== null &&
    (!isInstant(operatorCutoffMs) || operatorCutoffMs > nowMs)
  ) {
    return { kind: "deny", reason: "invalid_operator_cutoff" };
  }

  const authenticatedAtMs = authTime * 1000;
  const cutoffMs = Math.max(resetMs ?? 0, operatorCutoffMs ?? 0);
  // Match the precision of auth_time when validating the OIDC max_age request.
  // Keep the reset/operator cutoff at full precision; never round it down.
  const requestSecondMs = Math.floor(transaction.requestedAtMs / 1000) * 1000;
  const requiredByRequestMs =
    requestSecondMs - transaction.maxAgeSeconds * 1000;
  if (authenticatedAtMs < cutoffMs || authenticatedAtMs < requiredByRequestMs) {
    if (transaction.reauthenticationAttempt === 1) {
      return { kind: "deny", reason: "reauthentication_failed" };
    }
    return {
      kind: "reauthenticate",
      reason: "stale_authentication",
      // Wait at most one second before starting the new transaction. This
      // also protects max_age=0 from another same-second old-SSO response.
      notBeforeMs: Math.max(
        Math.ceil(cutoffMs / 1000) * 1000,
        (Math.floor(nowMs / 1000) + 1) * 1000,
      ),
      maxAgeSeconds: 0,
      reauthenticationAttempt: 1,
    };
  }
  return { kind: "allow", authenticatedAtMs };
}
