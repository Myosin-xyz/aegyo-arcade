#!/usr/bin/env node
import "./check-runtime.mjs";
import { createHash, randomBytes } from "node:crypto";
import pg from "pg";
import { createLocalJWKSet, jwtVerify } from "jose";
import { databaseOptions } from "../src/database-options.mjs";
import {
  PRODUCTION_CLIENTS,
  validateManifest,
} from "./provision-production-clients-lib.mjs";

const fail = (code) => {
  throw new Error(code);
};
const required = (name) => process.env[name] || fail(`missing_${name}`);
let owner, runtime, tokenClient, issuedTokens, canarySubject;
let priorSessionIds = new Set();
async function revokeIssuedTokens() {
  if (!issuedTokens || !tokenClient) return;
  for (const value of [
    issuedTokens.access_token,
    issuedTokens.refresh_token,
  ].filter(Boolean)) {
    const revoked = await fetch(
      "https://account.aegyoarena.com/api/auth/oauth2/revoke",
      {
        method: "POST",
        headers: {
          authorization: `Basic ${Buffer.from(`${tokenClient.clientId}:${tokenClient.clientSecret}`).toString("base64")}`,
          "content-type": "application/x-www-form-urlencoded",
        },
        body: new URLSearchParams({ token: value }),
        signal: AbortSignal.timeout(10_000),
      },
    );
    if (!revoked.ok) fail("production_token_cleanup_failed");
  }
  issuedTokens = null;
}
try {
  if (process.env.DATABASE_URL) fail("ordinary_DATABASE_URL_forbidden");
  if (
    required("ACCOUNTS_PRODUCTION_ACTIVATION_CONFIRM") !==
    "prove-live-provider-before-irreversible-latch"
  )
    fail("activation_readiness_confirmation_missing");
  if (
    required("ACCOUNTS_ENVIRONMENT") !== "production" ||
    required("ACCOUNTS_TRAFFIC_ENABLED") !== "true" ||
    required("ACCOUNTS_SIGNUP_ENABLED") !== "false" ||
    required("ACCOUNTS_BASE_URL") !== "https://account.aegyoarena.com" ||
    required("ACCOUNTS_IMPORT_TARGET_DATABASE_NAME") !== "accounts_production"
  )
    fail("production_activation_configuration_invalid");
  const options = {
    caCertificate: required("ACCOUNTS_IMPORT_TARGET_DATABASE_CA_CERT"),
    serverSHA256: required("ACCOUNTS_IMPORT_TARGET_DATABASE_SERVER_SHA256"),
  };
  owner = new pg.Pool({
    ...databaseOptions(
      required("ACCOUNTS_IMPORT_TARGET_DATABASE_URL"),
      options,
    ),
    max: 1,
  });
  const runtimeURL = new URL(required("ACCOUNTS_IMPORT_TARGET_DATABASE_URL"));
  runtimeURL.username = required("ACCOUNTS_DATABASE_ROLE");
  runtimeURL.password = required("ACCOUNTS_DATABASE_ROLE_PASSWORD");
  runtime = new pg.Pool({
    ...databaseOptions(runtimeURL.href, options),
    max: 1,
  });
  const identity = (
    await runtime.query("SELECT current_database() database,current_user role")
  ).rows[0];
  if (
    identity.database !== "accounts_production" ||
    identity.role !== "aegyo_accounts_production_app"
  )
    fail("runtime_database_identity_mismatch");
  const clients = (
    await owner.query(`SELECT "clientId", "redirectUris", "postLogoutRedirectUris",
      scopes, "grantTypes", "responseTypes", "tokenEndpointAuthMethod",
      "skipConsent", "requirePKCE", "enableEndSession", disabled
      FROM public."oauthClient"`)
  ).rows;
  if (clients.length !== 3) fail("production_callback_set_mismatch");
  const expectedRedirects = new Set(
    PRODUCTION_CLIENTS.map((row) => `${row[1]}|${row[2]}`),
  );
  for (const client of clients) {
    const redirect = Array.isArray(client.redirectUris)
      ? client.redirectUris
      : JSON.parse(client.redirectUris);
    const logout = Array.isArray(client.postLogoutRedirectUris)
      ? client.postLogoutRedirectUris
      : JSON.parse(client.postLogoutRedirectUris);
    if (
      redirect.length !== 1 ||
      logout.length !== 1 ||
      !expectedRedirects.delete(`${redirect[0]}|${logout[0]}`) ||
      client.disabled ||
      client.tokenEndpointAuthMethod !== "client_secret_basic" ||
      !client.skipConsent ||
      !client.requirePKCE ||
      !client.enableEndSession ||
      JSON.stringify(client.grantTypes) !==
        JSON.stringify(["authorization_code"]) ||
      JSON.stringify(client.responseTypes) !== JSON.stringify(["code"]) ||
      new Set(client.scopes).size !== 3
    )
      fail("production_callback_set_mismatch");
  }
  if (expectedRedirects.size) fail("production_callback_set_mismatch");
  const base = "https://account.aegyoarena.com";
  const response = await fetch(`${base}/readyz`, {
    signal: AbortSignal.timeout(10_000),
  });
  if (!response.ok || (await response.json()).ready !== true)
    fail("production_runtime_not_ready");
  const discoveryResponse = await fetch(
    `${base}/api/auth/.well-known/openid-configuration`,
    { signal: AbortSignal.timeout(10_000) },
  );
  if (!discoveryResponse.ok) fail("production_discovery_failed");
  const discovery = await discoveryResponse.json();
  if (
    discovery.issuer !== `${base}/api/auth` ||
    discovery.authorization_endpoint !== `${base}/api/auth/oauth2/authorize` ||
    discovery.token_endpoint !== `${base}/api/auth/oauth2/token` ||
    discovery.jwks_uri !== `${base}/api/auth/jwks`
  )
    fail("production_discovery_mismatch");
  const jwksResponse = await fetch(discovery.jwks_uri, {
    signal: AbortSignal.timeout(10_000),
  });
  const jwks = jwksResponse.ok ? await jwksResponse.json() : null;
  if (!Array.isArray(jwks?.keys) || jwks.keys.length < 1)
    fail("production_jwks_missing");
  const mapping = (
    await owner.query(
      `SELECT i.subject,u.email,u."emailVerified"
      FROM aegyo_import.identities i JOIN public."user" u ON u.id=i.subject
      WHERE i.source_namespace=$1 AND i.local_user_id=$2`,
      [
        required("ACCOUNTS_IMPORT_SOURCE_NAMESPACE"),
        required("ACCOUNTS_REAL_CANARY_SOURCE_USER_ID"),
      ],
    )
  ).rows;
  if (
    mapping.length !== 1 ||
    mapping[0].email.trim().toLowerCase() !==
      required("ACCOUNTS_REAL_CANARY_EMAIL").trim().toLowerCase() ||
    String(mapping[0].emailVerified) !==
      required("ACCOUNTS_REAL_CANARY_EXPECTED_VERIFIED")
  )
    fail("canary_mapping_or_state_mismatch");
  canarySubject = mapping[0].subject;
  priorSessionIds = new Set(
    (
      await runtime.query('SELECT id FROM public."session" WHERE "userId"=$1', [
        mapping[0].subject,
      ])
    ).rows.map((row) => row.id),
  );
  const signIn = await fetch(`${base}/api/auth/sign-in/email`, {
    method: "POST",
    headers: { "content-type": "application/json", origin: base },
    body: JSON.stringify({
      email: required("ACCOUNTS_REAL_CANARY_EMAIL"),
      password: required("ACCOUNTS_REAL_CANARY_PASSWORD"),
    }),
    signal: AbortSignal.timeout(10_000),
  });
  if (!signIn.ok || (await signIn.json()).user?.id !== mapping[0].subject)
    fail("imported_canary_signin_failed");
  const cookie = signIn.headers
    .getSetCookie()
    .map((value) => value.split(";", 1)[0])
    .join("; ");
  if (!cookie) fail("imported_canary_cookie_missing");
  const client = validateManifest(
    JSON.parse(required("ACCOUNTS_PRODUCTION_CLIENTS_JSON")),
  )[0];
  tokenClient = client;
  const verifier = randomBytes(32).toString("base64url");
  const nonce = randomBytes(16).toString("hex");
  const query = new URLSearchParams({
    client_id: client.clientId,
    redirect_uri: client.redirectUri,
    response_type: "code",
    scope: "openid email profile",
    state: "production-cutover-proof",
    nonce,
    code_challenge: createHash("sha256").update(verifier).digest("base64url"),
    code_challenge_method: "S256",
  });
  const authorize = await fetch(`${base}/api/auth/oauth2/authorize?${query}`, {
    headers: { cookie },
    redirect: "manual",
    signal: AbortSignal.timeout(10_000),
  });
  const callback = new URL(
    authorize.headers.get("location") || "https://invalid.invalid",
  );
  const code = callback.searchParams.get("code");
  if (callback.origin + callback.pathname !== client.redirectUri || !code)
    fail("production_authorization_code_failed");
  const token = await fetch(`${base}/api/auth/oauth2/token`, {
    method: "POST",
    headers: {
      authorization: `Basic ${Buffer.from(`${client.clientId}:${client.clientSecret}`).toString("base64")}`,
      "content-type": "application/x-www-form-urlencoded",
    },
    body: new URLSearchParams({
      grant_type: "authorization_code",
      client_id: client.clientId,
      redirect_uri: client.redirectUri,
      code,
      code_verifier: verifier,
    }),
    signal: AbortSignal.timeout(10_000),
  });
  const tokens = token.ok ? await token.json() : null;
  if (!tokens?.id_token) fail("production_token_exchange_failed");
  issuedTokens = tokens;
  const verified = await jwtVerify(tokens.id_token, createLocalJWKSet(jwks), {
    issuer: `${base}/api/auth`,
    audience: client.clientId,
  });
  if (
    verified.payload.sub !== mapping[0].subject ||
    verified.payload.nonce !== nonce
  )
    fail("production_token_claims_mismatch");
  const readers = JSON.parse(required("ACCOUNTS_STATE_READERS_JSON"));
  const readerKey = readers[client.key];
  if (typeof readerKey !== "string" || readerKey.length < 32)
    fail("production_state_reader_missing");
  const stateResponse = await fetch(`${base}/api/internal/session-state`, {
    method: "POST",
    headers: {
      authorization: `Bearer ${readerKey}`,
      "content-type": "application/json",
    },
    body: JSON.stringify({
      subject: verified.payload.sub,
      providerSessionId: verified.payload.sid,
    }),
    signal: AbortSignal.timeout(10_000),
  });
  const securityState = stateResponse.ok ? await stateResponse.json() : null;
  if (
    securityState?.subject !== verified.payload.sub ||
    securityState?.providerSessionId !== verified.payload.sid ||
    securityState?.active !== true
  )
    fail("production_security_state_failed");
  await revokeIssuedTokens();
  const created = (
    await runtime.query('SELECT id FROM public."session" WHERE "userId"=$1', [
      mapping[0].subject,
    ])
  ).rows.filter((row) => !priorSessionIds.has(row.id));
  if (created.length !== 1) fail("canary_session_outcome_invalid");
  await runtime.query(
    'DELETE FROM public."session" WHERE id=$1 AND "userId"=$2',
    [created[0].id, mapping[0].subject],
  );
  canarySubject = null;
  console.info(
    JSON.stringify({
      runtimeReady: true,
      discoveryVerified: true,
      jwksVerified: true,
      callbacksVerified: 3,
      importedCanaryVerified: true,
      tokenVerified: true,
      securityStateVerified: true,
      canarySessionRemoved: true,
    }),
  );
} catch (error) {
  console.error(
    /^[a-z0-9_]+$/.test(error?.message ?? "")
      ? error.message
      : "production_activation_readiness_failed",
  );
  process.exitCode = 1;
} finally {
  try {
    await revokeIssuedTokens();
    if (runtime && canarySubject) {
      const created = (
        await runtime.query(
          'SELECT id FROM public."session" WHERE "userId"=$1',
          [canarySubject],
        )
      ).rows.filter((row) => !priorSessionIds.has(row.id));
      for (const row of created)
        await runtime.query(
          'DELETE FROM public."session" WHERE id=$1 AND "userId"=$2',
          [row.id, canarySubject],
        );
    }
  } catch {
    console.error("production_canary_cleanup_failed");
    process.exitCode = 1;
  }
  await Promise.allSettled([owner?.end(), runtime?.end()]);
}
