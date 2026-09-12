import * as oidc from "openid-client";
import type { AccountsConfig } from "./config";
import { PROVIDER_CLOCK_SKEW_MS } from "./freshness";
import type { OidcTransaction } from "./transaction";

const configs = new Map<string, Promise<oidc.Configuration>>();

async function provider(config: AccountsConfig): Promise<oidc.Configuration> {
  const cacheKey = `${config.issuer}\0${config.clientId}`;
  let pending = configs.get(cacheKey);
  if (!pending) {
    pending = oidc
      .discovery(
        new URL(config.issuer),
        config.clientId,
        {
          client_secret: config.clientSecret,
          [oidc.clockTolerance]: PROVIDER_CLOCK_SKEW_MS / 1_000,
        },
        oidc.ClientSecretBasic(config.clientSecret),
      )
      .then((discovered) => {
        oidc.enableNonRepudiationChecks(discovered);
        return discovered;
      })
      .catch((error) => {
        configs.delete(cacheKey);
        throw error;
      });
    configs.set(cacheKey, pending);
  }
  return pending;
}

export type VerifiedAuthorization = {
  issuer: string;
  subject: string;
  providerSessionId: string;
  name: string | null;
  picture: string | null;
  emailVerified: boolean;
  authTime: unknown;
  resetState: unknown;
  securityVersion: unknown;
  operatorCutoff: unknown;
};

export async function beginAuthorization(
  config: AccountsConfig,
  input: {
    maxAgeSeconds: number;
    reauthenticationAttempt: 0 | 1;
    nowMs?: number;
  },
): Promise<{ url: URL; transaction: OidcTransaction }> {
  const codeVerifier = oidc.randomPKCECodeVerifier();
  const transaction: OidcTransaction = {
    state: oidc.randomState(),
    nonce: oidc.randomNonce(),
    codeVerifier,
    requestedAtMs: input.nowMs ?? Date.now(),
    maxAgeSeconds: input.maxAgeSeconds,
    reauthenticationAttempt: input.reauthenticationAttempt,
  };
  const url = oidc.buildAuthorizationUrl(await provider(config), {
    redirect_uri: `${config.appOrigin}/api/accounts/callback`,
    response_type: "code",
    scope: "openid email profile",
    code_challenge: await oidc.calculatePKCECodeChallenge(codeVerifier),
    code_challenge_method: "S256",
    state: transaction.state,
    nonce: transaction.nonce,
    max_age: String(transaction.maxAgeSeconds),
    ...(transaction.reauthenticationAttempt === 1 ? { prompt: "login" } : {}),
  });
  return { url, transaction };
}

export async function finishAuthorization(
  config: AccountsConfig,
  callbackUrl: URL,
  transaction: OidcTransaction,
): Promise<VerifiedAuthorization> {
  const tokens = await oidc.authorizationCodeGrant(
    await provider(config),
    callbackUrl,
    {
      pkceCodeVerifier: transaction.codeVerifier,
      expectedState: transaction.state,
      expectedNonce: transaction.nonce,
      maxAge: transaction.maxAgeSeconds,
      idTokenExpected: true,
    },
  );
  const claims = tokens.claims();
  if (
    !claims ||
    typeof claims.sub !== "string" ||
    typeof claims.iss !== "string"
  )
    throw new Error("invalid_identity_claims");
  if (typeof claims.sid !== "string" || claims.sid.length === 0)
    throw new Error("missing_provider_session");
  if (typeof claims.email_verified !== "boolean")
    throw new Error("missing_verified_email_claim");
  return {
    issuer: claims.iss,
    subject: claims.sub,
    providerSessionId: claims.sid,
    name: typeof claims.name === "string" ? claims.name : null,
    picture: typeof claims.picture === "string" ? claims.picture : null,
    emailVerified: claims.email_verified,
    authTime: claims.auth_time,
    resetState: claims["https://aegyoarena.com/claims/password-reset-state"],
    securityVersion: claims["https://aegyoarena.com/claims/security-version"],
    operatorCutoff: claims["https://aegyoarena.com/claims/operator-cutoff"],
  };
}
