// @vitest-environment node
import { describe, expect, it } from "vitest";
import {
  accountsEnabled,
  getAccountsConfig,
  PROVIDER_STATE_MAX_AGE_MS,
} from "@/accounts/config";
import { MEMBER_COOKIE, OIDC_TRANSACTION_COOKIE } from "@/accounts/cookies";
import {
  openTransaction,
  sealTransaction,
  type OidcTransaction,
} from "@/accounts/transaction";
import {
  parseProviderSecurityState,
  securityStateAllowsSession,
  type ProviderSecurityState,
} from "@/accounts/security-state";
import type { MemberSession } from "@/accounts/sessions";
import { getTableColumns } from "drizzle-orm";
import { accountMembers, accountSessions } from "@/db/schema";

const base = Date.parse("2026-09-11T12:00:00.000Z");
const tx: OidcTransaction = {
  state: "state-state-state-state",
  nonce: "nonce-nonce-nonce-nonce",
  codeVerifier: "v".repeat(43),
  requestedAtMs: base,
  maxAgeSeconds: 3600,
  reauthenticationAttempt: 0,
};

describe("Arcade member adapter boundaries", () => {
  it("is disabled by default and rejects partial runtime configuration", () => {
    expect(accountsEnabled({})).toBe(false);
    expect(getAccountsConfig({})).toBeNull();
    expect(
      getAccountsConfig({ ARCADE_SHARED_AUTH_ENABLED: "true" }),
    ).toBeNull();
  });

  it("derives the Better Auth issuer and internal state endpoint base separately", () => {
    const config = getAccountsConfig({
      ARCADE_SHARED_AUTH_ENABLED: "true",
      ARCADE_AUTH_BASE_URL: "https://id.example.test",
      ARCADE_APP_ORIGIN: "https://arcade.example.test",
      ARCADE_AUTH_CLIENT_ID: "arcade",
      ARCADE_AUTH_CLIENT_SECRET: "oauth-secret",
      ARCADE_AUTH_TRANSACTION_SECRET: "x".repeat(32),
      ARCADE_AUTH_STATE_READER_KEY: "reader-secret",
    });
    expect(config).toMatchObject({
      issuer: "https://id.example.test/api/auth",
      providerBaseUrl: "https://id.example.test",
      appOrigin: "https://arcade.example.test",
    });
  });

  it("keeps member and authorization cookies distinct from the guest cookie", () => {
    expect(MEMBER_COOKIE).toBe("__Host-aegyo_member");
    expect(OIDC_TRANSACTION_COOKIE).toBe("__Host-aegyo_oidc_tx");
    expect([MEMBER_COOKIE, OIDC_TRANSACTION_COOKIE]).not.toContain(
      "__Host-aegyo_device",
    );
  });

  it("does not map member identities by email or attach anonymous device ownership", () => {
    expect(Object.keys(getTableColumns(accountMembers))).toEqual([
      "id",
      "issuer",
      "subject",
      "displayName",
      "avatarUrl",
      "createdAt",
      "updatedAt",
    ]);
    expect(Object.keys(getTableColumns(accountSessions))).not.toContain(
      "deviceId",
    );
  });

  it("returns a hidden route while the feature flag is off", async () => {
    const previous = process.env.ARCADE_SHARED_AUTH_ENABLED;
    delete process.env.ARCADE_SHARED_AUTH_ENABLED;
    const { GET } = await import("@/app/api/accounts/login/route");
    const response = await GET();
    expect(response.status).toBe(404);
    if (previous === undefined) delete process.env.ARCADE_SHARED_AUTH_ENABLED;
    else process.env.ARCADE_SHARED_AUTH_ENABLED = previous;
  });

  it("rejects tampered, expired, and replay-shaped authorization transactions", () => {
    const secret = "secret".repeat(8);
    const sealed = sealTransaction(tx, secret);
    expect(openTransaction(sealed, secret, base + 1)).toEqual(tx);
    const middle = Math.floor(sealed.length / 2);
    const tampered = `${sealed.slice(0, middle)}${sealed[middle] === "A" ? "B" : "A"}${sealed.slice(middle + 1)}`;
    expect(openTransaction(tampered, secret, base + 1)).toBeNull();
    expect(
      openTransaction(sealed, secret, base + 10 * 60 * 1000 + 1),
    ).toBeNull();
    expect(openTransaction(sealed, "wrong".repeat(8), base + 1)).toBeNull();
  });
});

function session(): MemberSession {
  return {
    sessionId: "hash",
    memberId: "member",
    subject: "user-1",
    providerSessionId: "sid-1",
    displayName: null,
    avatarUrl: null,
    authenticatedAt: new Date(base),
    providerCheckedAt: new Date(base),
    securityVersion: 7,
    passwordResetState: {
      version: 1,
      kind: "database",
      lastPasswordReset: null,
    },
  };
}

function state(
  overrides: Partial<ProviderSecurityState> = {},
): ProviderSecurityState {
  return {
    version: 1,
    subject: "user-1",
    providerSessionId: "sid-1",
    active: true,
    passwordResetState: {
      version: 1,
      kind: "database",
      lastPasswordReset: null,
    },
    operatorCutoff: null,
    securityVersion: 7,
    ...overrides,
  };
}

describe("provider security-state freshness", () => {
  it("uses a 30-second absolute cache bound", () => {
    expect(PROVIDER_STATE_MAX_AGE_MS).toBe(30_000);
  });

  it.each([
    ["inactive", { active: false }],
    ["wrong subject", { subject: "user-2" }],
    ["wrong provider session", { providerSessionId: "sid-2" }],
    ["new security epoch", { securityVersion: 8 }],
    ["rollback epoch", { securityVersion: 6 }],
    [
      "post-login reset",
      {
        passwordResetState: {
          version: 1,
          kind: "database",
          lastPasswordReset: "2026-09-11T12:00:00.001Z",
        },
      },
    ],
    ["operator cutoff", { operatorCutoff: "2026-09-11T12:00:00.001Z" }],
  ])("fails closed for %s", (_name, patch) => {
    expect(
      securityStateAllowsSession(
        session(),
        state(patch as Partial<ProviderSecurityState>),
        base + 2_000,
      ),
    ).toBe(false);
  });

  it("accepts only an unchanged active provider session", () => {
    expect(securityStateAllowsSession(session(), state(), base + 2_000)).toBe(
      true,
    );
  });

  it("rejects malformed endpoint responses", () => {
    expect(
      parseProviderSecurityState({ ...state(), credentialVersion: 999 }),
    ).not.toBeNull();
    expect(
      parseProviderSecurityState({ ...state(), securityVersion: -1 }),
    ).toBeNull();
    expect(
      parseProviderSecurityState({
        ...state(),
        passwordResetState: { version: 1, kind: "database" },
      }),
    ).toBeNull();
  });
});
