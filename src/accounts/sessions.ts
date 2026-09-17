import { createHash, randomBytes } from "node:crypto";
import { and, eq, gt, isNull } from "drizzle-orm";
import type { Db } from "@/db/client";
import { accountMembers, accountSessions } from "@/db/schema";
import {
  MEMBER_SESSION_TTL_SECONDS,
  PROVIDER_STATE_MAX_AGE_MS,
} from "./config";
import type { ResetState } from "./freshness";

export function newMemberToken(): string {
  return randomBytes(32).toString("base64url");
}
export function hashMemberToken(token: string): string {
  return createHash("sha256").update(token).digest("hex");
}

export type MemberSession = {
  sessionId: string;
  memberId: string;
  subject: string;
  providerSessionId: string;
  emailVerified: boolean;
  displayName: string | null;
  avatarUrl: string | null;
  authenticatedAt: Date;
  providerCheckedAt: Date;
  securityVersion: number;
  passwordResetState: ResetState;
};

export async function createMemberSession(
  db: Db,
  input: {
    issuer: string;
    subject: string;
    providerSessionId: string;
    emailVerified?: boolean;
    name: string | null;
    picture: string | null;
    authenticatedAtMs: number;
    securityVersion: number;
    resetState: ResetState;
    now?: Date;
  },
): Promise<{ token: string; expiresAt: Date }> {
  const token = newMemberToken();
  const now = input.now ?? new Date();
  const expiresAt = new Date(now.getTime() + MEMBER_SESSION_TTL_SECONDS * 1000);
  await db.transaction(async (tx) => {
    const [member] = await tx
      .insert(accountMembers)
      .values({
        issuer: input.issuer,
        subject: input.subject,
        displayName: input.name,
        avatarUrl: input.picture,
        updatedAt: now,
      })
      .onConflictDoUpdate({
        target: [accountMembers.issuer, accountMembers.subject],
        set: {
          displayName: input.name,
          avatarUrl: input.picture,
          updatedAt: now,
        },
      })
      .returning({ id: accountMembers.id });
    await tx.insert(accountSessions).values({
      tokenHash: hashMemberToken(token),
      memberId: member.id,
      providerSessionId: input.providerSessionId,
      emailVerified: input.emailVerified === true,
      authenticatedAt: new Date(input.authenticatedAtMs),
      providerCheckedAt: now,
      securityVersion: input.securityVersion,
      passwordResetState: input.resetState,
      expiresAt,
    });
  });
  return { token, expiresAt };
}

export async function resolveMemberSession(
  db: Db,
  token: string,
  now = new Date(),
): Promise<MemberSession | null> {
  const rows = await db
    .select({
      sessionId: accountSessions.tokenHash,
      memberId: accountMembers.id,
      subject: accountMembers.subject,
      providerSessionId: accountSessions.providerSessionId,
      emailVerified: accountSessions.emailVerified,
      displayName: accountMembers.displayName,
      avatarUrl: accountMembers.avatarUrl,
      authenticatedAt: accountSessions.authenticatedAt,
      providerCheckedAt: accountSessions.providerCheckedAt,
      securityVersion: accountSessions.securityVersion,
      passwordResetState: accountSessions.passwordResetState,
    })
    .from(accountSessions)
    .innerJoin(accountMembers, eq(accountSessions.memberId, accountMembers.id))
    .where(
      and(
        eq(accountSessions.tokenHash, hashMemberToken(token)),
        isNull(accountSessions.revokedAt),
        gt(accountSessions.expiresAt, now),
      ),
    )
    .limit(1);
  return (rows[0] as MemberSession | undefined) ?? null;
}

export function providerStateIsCurrent(
  session: MemberSession,
  nowMs = Date.now(),
): boolean {
  const age = nowMs - session.providerCheckedAt.getTime();
  return age >= 0 && age <= PROVIDER_STATE_MAX_AGE_MS;
}

export async function revokeMemberSession(
  db: Db,
  token: string,
): Promise<void> {
  await db
    .update(accountSessions)
    .set({ revokedAt: new Date() })
    .where(eq(accountSessions.tokenHash, hashMemberToken(token)));
}
