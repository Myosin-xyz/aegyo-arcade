// @vitest-environment node
import { beforeEach, describe, expect, it, vi } from "vitest";

const mocks = vi.hoisted(() => ({
  discovery: vi.fn(async () => ({ discovered: true })),
  grant: vi.fn(),
  clientSecretBasic: vi.fn(() => "client-auth"),
  buildAuthorizationUrl: vi.fn(
    () => new URL("https://id.example.test/authorize"),
  ),
  enableNonRepudiationChecks: vi.fn(),
  clockTolerance: Symbol("clockTolerance"),
}));

vi.mock("openid-client", () => ({
  discovery: mocks.discovery,
  ClientSecretBasic: mocks.clientSecretBasic,
  authorizationCodeGrant: mocks.grant,
  randomPKCECodeVerifier: vi.fn(() => "v".repeat(43)),
  randomState: vi.fn(() => "state-state-state-state"),
  randomNonce: vi.fn(() => "nonce-nonce-nonce-nonce"),
  calculatePKCECodeChallenge: vi.fn(async () => "challenge"),
  buildAuthorizationUrl: mocks.buildAuthorizationUrl,
  enableNonRepudiationChecks: mocks.enableNonRepudiationChecks,
  clockTolerance: mocks.clockTolerance,
}));

import { beginAuthorization, finishAuthorization } from "@/accounts/provider";
import type { AccountsConfig } from "@/accounts/config";
import type { OidcTransaction } from "@/accounts/transaction";

const config: AccountsConfig = {
  providerBaseUrl: "https://id.example.test",
  issuer: "https://id.example.test/api/auth",
  clientId: "arcade",
  clientSecret: "oauth-secret",
  appOrigin: "https://arcade.example.test",
  transactionSecret: "x".repeat(32),
  stateReaderKey: "reader-secret",
};
const transaction: OidcTransaction = {
  state: "state-state-state-state",
  nonce: "nonce-nonce-nonce-nonce",
  codeVerifier: "v".repeat(43),
  requestedAtMs: 1_000,
  maxAgeSeconds: 3_600,
  reauthenticationAttempt: 0,
};

describe("OIDC callback attack defenses", () => {
  beforeEach(() => vi.clearAllMocks());

  it("uses the registered basic client authentication method", async () => {
    await beginAuthorization(config, {
      maxAgeSeconds: 3_600,
      reauthenticationAttempt: 0,
    });
    expect(mocks.clientSecretBasic).toHaveBeenCalledWith(config.clientSecret);
    expect(mocks.discovery).toHaveBeenCalledWith(
      new URL(config.issuer),
      config.clientId,
      expect.objectContaining({
        client_secret: config.clientSecret,
        [mocks.clockTolerance]: 5,
      }),
      "client-auth",
    );
    expect(mocks.enableNonRepudiationChecks).toHaveBeenCalledWith(
      expect.objectContaining({ discovered: true }),
    );
  });

  it("evicts a rejected discovery so a transient startup failure can recover", async () => {
    const retryConfig = { ...config, clientId: "retry-client" };
    mocks.discovery.mockRejectedValueOnce(new Error("temporary discovery"));
    await expect(
      beginAuthorization(retryConfig, {
        maxAgeSeconds: 3_600,
        reauthenticationAttempt: 0,
      }),
    ).rejects.toThrow("temporary discovery");
    await expect(
      beginAuthorization(retryConfig, {
        maxAgeSeconds: 3_600,
        reauthenticationAttempt: 0,
      }),
    ).resolves.toBeDefined();
    expect(mocks.discovery).toHaveBeenCalledTimes(2);
  });

  it("forces an interactive login only for the bounded freshness retry", async () => {
    await beginAuthorization(config, {
      maxAgeSeconds: 0,
      reauthenticationAttempt: 1,
    });
    expect(mocks.buildAuthorizationUrl).toHaveBeenLastCalledWith(
      expect.anything(),
      expect.objectContaining({ max_age: "0", prompt: "login" }),
    );
  });

  it("delegates code, issuer/audience/signature, PKCE, state, nonce and max_age validation to openid-client", async () => {
    mocks.grant.mockResolvedValue({
      claims: () => ({
        iss: config.issuer,
        sub: "user-1",
        sid: "sid-1",
        auth_time: 1,
        "https://aegyoarena.com/claims/password-reset-state": {
          version: 1,
          kind: "database",
          lastPasswordReset: null,
        },
        "https://aegyoarena.com/claims/security-version": 1,
      }),
    });
    await finishAuthorization(
      config,
      new URL(
        "https://arcade.example.test/api/accounts/callback?code=x&state=y",
      ),
      transaction,
    );
    expect(mocks.grant).toHaveBeenCalledWith(
      expect.anything(),
      expect.any(URL),
      expect.objectContaining({
        pkceCodeVerifier: transaction.codeVerifier,
        expectedState: transaction.state,
        expectedNonce: transaction.nonce,
        maxAge: transaction.maxAgeSeconds,
        idTokenExpected: true,
      }),
    );
  });

  it("refuses an ID token without the provider session id", async () => {
    mocks.grant.mockResolvedValue({
      claims: () => ({ iss: config.issuer, sub: "user-1" }),
    });
    await expect(
      finishAuthorization(
        config,
        new URL("https://arcade.example.test/api/accounts/callback?code=x"),
        transaction,
      ),
    ).rejects.toThrow("missing_provider_session");
  });
});
