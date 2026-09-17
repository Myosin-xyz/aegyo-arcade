import { eq } from "drizzle-orm";
import type { Db } from "@/db/client";
import { accountSessions } from "@/db/schema";
import type { AccountsConfig } from "./config";
import {
  evaluateFreshness,
  parseResetInstant,
  type ResetState,
} from "./freshness";
import type { MemberSession } from "./sessions";

export type ProviderSecurityState = {
  version: 1;
  subject: string;
  providerSessionId: string;
  active: boolean;
  passwordResetState: ResetState;
  operatorCutoff: string | null;
  securityVersion: number;
};

export type ProviderSecurityStateResult =
  | { kind: "ok"; state: ProviderSecurityState }
  | { kind: "invalid" }
  | { kind: "unavailable" };

export function parseProviderSecurityState(
  value: unknown,
): ProviderSecurityState | null {
  if (!value || typeof value !== "object" || Array.isArray(value)) return null;
  const row = value as Record<string, unknown>;
  if (
    row.version !== 1 ||
    typeof row.subject !== "string" ||
    typeof row.providerSessionId !== "string" ||
    typeof row.active !== "boolean" ||
    !Number.isSafeInteger(row.securityVersion) ||
    (row.securityVersion as number) < 0 ||
    (row.operatorCutoff !== null &&
      parseResetInstant(row.operatorCutoff) === null)
  )
    return null;
  const reset = row.passwordResetState as Record<string, unknown> | null;
  if (
    !reset ||
    reset.version !== 1 ||
    reset.kind !== "database" ||
    !Object.hasOwn(reset, "lastPasswordReset") ||
    (reset.lastPasswordReset !== null &&
      parseResetInstant(reset.lastPasswordReset) === null)
  )
    return null;
  return value as ProviderSecurityState;
}

export function securityStateAllowsSession(
  session: MemberSession,
  state: ProviderSecurityState,
  nowMs = Date.now(),
): boolean {
  if (
    !state.active ||
    state.subject !== session.subject ||
    state.providerSessionId !== session.providerSessionId ||
    state.securityVersion !== session.securityVersion
  )
    return false;
  const decision = evaluateFreshness({
    authTime: session.authenticatedAt.getTime() / 1000,
    resetState: state.passwordResetState,
    operatorCutoffMs:
      state.operatorCutoff === null
        ? null
        : parseResetInstant(state.operatorCutoff),
    transaction: {
      requestedAtMs: session.authenticatedAt.getTime(),
      maxAgeSeconds: 0,
      reauthenticationAttempt: 1,
    },
    nowMs,
  });
  return decision.kind === "allow";
}

export async function fetchProviderSecurityState(
  config: AccountsConfig,
  subject: string,
  providerSessionId: string,
): Promise<ProviderSecurityStateResult> {
  let response: Response;
  try {
    response = await fetch(
      `${config.providerBaseUrl}/api/internal/session-state`,
      {
        method: "POST",
        cache: "no-store",
        headers: {
          authorization: `Bearer ${config.stateReaderKey}`,
          "content-type": "application/json",
        },
        body: JSON.stringify({ subject, providerSessionId }),
        signal: AbortSignal.timeout(5_000),
      },
    );
  } catch {
    return { kind: "unavailable" };
  }
  if (!response.ok)
    return { kind: response.status >= 500 ? "unavailable" : "invalid" };
  const state = parseProviderSecurityState(
    await response.json().catch(() => null),
  );
  return state ? { kind: "ok", state } : { kind: "invalid" };
}

export async function refreshProviderSecurityState(
  db: Db,
  config: AccountsConfig,
  session: MemberSession,
  now = new Date(),
): Promise<"current" | "invalid" | "unavailable"> {
  const result = await fetchProviderSecurityState(
    config,
    session.subject,
    session.providerSessionId,
  );
  if (result.kind !== "ok") return result.kind;
  const { state } = result;
  if (!securityStateAllowsSession(session, state, now.getTime()))
    return "invalid";
  await db
    .update(accountSessions)
    .set({
      providerCheckedAt: now,
      securityVersion: state.securityVersion,
      passwordResetState: state.passwordResetState,
    })
    .where(eq(accountSessions.tokenHash, session.sessionId));
  return "current";
}
