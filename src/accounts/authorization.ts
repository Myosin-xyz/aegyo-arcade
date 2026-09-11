import type { Db } from "@/db/client";
import type { AccountsConfig } from "./config";
import { refreshProviderSecurityState } from "./security-state";
import {
  providerStateIsCurrent,
  resolveMemberSession,
  revokeMemberSession,
  type MemberSession,
} from "./sessions";

export type MemberAuthorization =
  | { kind: "allowed"; session: MemberSession }
  | { kind: "invalid" }
  | { kind: "unavailable" };

/** Sensitive writes always check the IdP; ordinary reads may use at most 30s. */
export async function authorizeMemberSession(
  db: Db,
  config: AccountsConfig,
  token: string,
  options: { sensitive: boolean },
): Promise<MemberAuthorization> {
  const session = await resolveMemberSession(db, token);
  if (!session) return { kind: "invalid" };
  if (!options.sensitive && providerStateIsCurrent(session))
    return { kind: "allowed", session };
  const state = await refreshProviderSecurityState(db, config, session);
  if (state === "unavailable") return { kind: "unavailable" };
  if (state === "invalid") {
    await revokeMemberSession(db, token);
    return { kind: "invalid" };
  }
  return { kind: "allowed", session };
}
