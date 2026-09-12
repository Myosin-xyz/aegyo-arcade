// @vitest-environment node
import { beforeEach, describe, expect, it, vi } from "vitest";
import { NextRequest } from "next/server";

const mocks = vi.hoisted(() => ({
  createMemberSession: vi.fn(),
  fetchProviderSecurityState: vi.fn(),
  finishAuthorization: vi.fn(),
  authorizationRedirect: vi.fn(async () =>
    Response.redirect("https://id.example.test/authorize"),
  ),
  transaction: {
    state: "state-state-state-state",
    nonce: "nonce-nonce-nonce-nonce",
    codeVerifier: "v".repeat(43),
    requestedAtMs: 0,
    maxAgeSeconds: 3_600,
    reauthenticationAttempt: 0,
    returnTo: "/championship",
  },
}));

const config = {
  providerBaseUrl: "https://id.example.test",
  issuer: "https://id.example.test/api/auth",
  clientId: "arcade",
  clientSecret: "oauth-secret",
  appOrigin: "https://arcade.example.test",
  transactionSecret: "x".repeat(32),
  stateReaderKey: "reader-secret",
};

vi.mock("@/accounts/config", () => ({ getAccountsConfig: () => config }));
vi.mock("@/accounts/transaction", () => ({
  openTransaction: () => mocks.transaction,
  safeAccountReturnTo: (value: string) => value,
}));
vi.mock("@/accounts/provider", () => ({
  finishAuthorization: mocks.finishAuthorization,
}));
vi.mock("@/accounts/security-state", () => ({
  fetchProviderSecurityState: mocks.fetchProviderSecurityState,
}));
vi.mock("@/accounts/sessions", () => ({
  createMemberSession: mocks.createMemberSession,
}));
vi.mock("@/accounts/http", () => ({
  clearTransactionCookie: vi.fn(),
  setMemberCookie: vi.fn(),
  authorizationRedirect: mocks.authorizationRedirect,
}));
vi.mock("@/db/client", () => ({ getDb: () => ({ database: true }) }));

import { GET } from "@/app/api/accounts/callback/route";

const resetState = {
  version: 1 as const,
  kind: "database" as const,
  lastPasswordReset: null,
};

describe("member callback authoritative state check", () => {
  beforeEach(() => {
    vi.clearAllMocks();
    const now = Math.floor(Date.now() / 1_000) * 1_000;
    Object.assign(mocks.transaction, {
      requestedAtMs: now,
      maxAgeSeconds: 3_600,
      reauthenticationAttempt: 0,
    });
    mocks.finishAuthorization.mockResolvedValue({
      issuer: config.issuer,
      subject: "user-1",
      providerSessionId: "sid-1",
      name: "Member",
      picture: null,
      emailVerified: true,
      authTime: now / 1_000,
      resetState,
      securityVersion: 7,
      operatorCutoff: null,
    });
  });

  function callbackRequest(): NextRequest {
    return new NextRequest(
      "https://arcade.example.test/api/accounts/callback?code=valid&state=valid",
      { headers: { cookie: "__Host-aegyo_oidc_tx=sealed" } },
    );
  }

  it("rejects a path adjacent to the exact callback route", async () => {
    const request = new NextRequest(
      "https://arcade.example.test/api/accounts/callback/extra?code=valid&state=valid",
      { headers: { cookie: "__Host-aegyo_oidc_tx=sealed" } },
    );
    const response = await GET(request);
    expect(response.status).toBe(400);
    expect(mocks.finishAuthorization).not.toHaveBeenCalled();
    expect(mocks.createMemberSession).not.toHaveBeenCalled();
  });

  it("never mints when current provider state is unavailable", async () => {
    mocks.fetchProviderSecurityState.mockResolvedValue({
      kind: "unavailable",
    });
    const response = await GET(callbackRequest());
    expect(response.status).toBe(503);
    expect(mocks.createMemberSession).not.toHaveBeenCalled();
  });

  it("a valid signed token revoked before callback gets one retry and no session", async () => {
    mocks.fetchProviderSecurityState.mockResolvedValue({
      kind: "ok",
      state: {
        version: 1,
        subject: "user-1",
        providerSessionId: "sid-1",
        active: false,
        passwordResetState: resetState,
        operatorCutoff: null,
        securityVersion: 7,
      },
    });
    const response = await GET(callbackRequest());
    expect(response.status).toBe(302);
    expect(mocks.authorizationRedirect).toHaveBeenCalledWith(
      config,
      expect.objectContaining({
        maxAgeSeconds: 0,
        reauthenticationAttempt: 1,
        returnTo: "/championship",
      }),
    );
    expect(mocks.createMemberSession).not.toHaveBeenCalled();
  });

  it("returns a successful login to the sealed local journey", async () => {
    mocks.fetchProviderSecurityState.mockResolvedValue({
      kind: "ok",
      state: {
        version: 1,
        subject: "user-1",
        providerSessionId: "sid-1",
        active: true,
        passwordResetState: resetState,
        operatorCutoff: null,
        securityVersion: 7,
      },
    });
    mocks.createMemberSession.mockResolvedValue({ token: "member-token" });
    const response = await GET(callbackRequest());
    expect(response.status).toBe(307);
    expect(response.headers.get("location")).toBe(
      "https://arcade.example.test/championship",
    );
  });

  it("does not loop when the authoritative rejection follows the retry", async () => {
    mocks.transaction.reauthenticationAttempt = 1;
    mocks.transaction.maxAgeSeconds = 0;
    mocks.fetchProviderSecurityState.mockResolvedValue({
      kind: "ok",
      state: {
        version: 1,
        subject: "user-1",
        providerSessionId: "sid-1",
        active: false,
        passwordResetState: resetState,
        operatorCutoff: null,
        securityVersion: 7,
      },
    });
    const response = await GET(callbackRequest());
    expect(response.status).toBe(400);
    expect(mocks.authorizationRedirect).not.toHaveBeenCalled();
    expect(mocks.createMemberSession).not.toHaveBeenCalled();
  });
});
