#!/usr/bin/env node
import "./check-runtime.mjs";
import { readFile } from "node:fs/promises";
import { randomBytes } from "node:crypto";
import pg from "pg";
import { databaseOptions } from "../src/database-options.mjs";
import { createAccountsProvider } from "../src/provider-core.mjs";
import {
  ClientProvisionRefusal,
  validateManifest,
} from "./provision-production-clients-lib.mjs";
const refuse = (code) => {
  throw new ClientProvisionRefusal(code);
};
const required = (key) => process.env[key] || refuse(`missing_${key}`);
if (process.env.DATABASE_URL) refuse("ordinary_DATABASE_URL_forbidden");
if (
  required("ACCOUNTS_ENVIRONMENT") !== "production" ||
  required("ACCOUNTS_TRAFFIC_ENABLED") !== "false" ||
  required("ACCOUNTS_SIGNUP_ENABLED") !== "false" ||
  required("ACCOUNTS_PRODUCTION_CLIENT_CONFIRM") !==
    "offline-first-party-clients"
)
  refuse("production_gate_failed");
if (required("ACCOUNTS_BASE_URL") !== "https://account.aegyoarena.com")
  refuse("production_origin_mismatch");
const manifest = validateManifest(
  JSON.parse(
    await readFile(required("ACCOUNTS_PRODUCTION_CLIENT_MANIFEST"), "utf8"),
  ),
);
const database = new pg.Pool({
  ...databaseOptions(required("ACCOUNTS_MIGRATION_DATABASE_URL"), {
    caCertificate: required("ACCOUNTS_MIGRATION_DATABASE_CA_CERT"),
    serverSHA256: required("ACCOUNTS_MIGRATION_DATABASE_SERVER_SHA256"),
  }),
  max: 1,
  connectionTimeoutMillis: 5000,
  statement_timeout: 30000,
  lock_timeout: 5000,
  application_name: "accounts-production-client-provisioner",
});
let committed = false;
try {
  await database.query("BEGIN");
  await database.query(
    "SELECT pg_advisory_xact_lock(hashtext('accounts-production-clients-v1'))",
  );
  const db = (await database.query("SELECT current_database() name")).rows[0]
    ?.name;
  if (
    db !== "accounts_production" ||
    db !== required("ACCOUNTS_MIGRATION_DATABASE_NAME")
  )
    refuse("database_name_mismatch");
  const counts = (
    await database.query(
      `SELECT (SELECT count(*)::int FROM public."user") users, (SELECT count(*)::int FROM public."oauthClient") clients`,
    )
  ).rows[0];
  if (counts.users !== 0 || ![0, 3].includes(counts.clients))
    refuse("database_population_refused");
  const { auth } = createAccountsProvider({
    database,
    secret: required("BETTER_AUTH_SECRET"),
    legacyPepper: required("ACCOUNTS_LEGACY_PEPPER"),
    baseURL: "https://account.aegyoarena.com",
    signupAllowed: true,
    allowProofAdmin: true,
    offlineOAuthClientCredentials: {
      clientIds: manifest.map((x) => x.clientId),
      clientSecrets: manifest.map((x) => x.clientSecret),
    },
  });
  const password = randomBytes(36).toString("base64url");
  const signup = await auth.handler(
    new Request("https://account.aegyoarena.com/api/auth/sign-up/email", {
      method: "POST",
      headers: {
        "content-type": "application/json",
        origin: "https://account.aegyoarena.com",
        "x-aegyo-client-ip": "192.0.2.1",
      },
      body: JSON.stringify({
        name: "Offline client provisioner",
        email: "offline-client-provisioner@example.invalid",
        password,
      }),
    }),
  );
  if (!signup.ok) refuse("bootstrap_signup_failed");
  const body = await signup.json();
  const cookie = signup.headers
    .getSetCookie()
    .map((x) => x.split(";", 1)[0])
    .join("; ");
  await database.query(`UPDATE public."user" SET role='admin' WHERE id=$1`, [
    body.user.id,
  ]);
  for (const row of manifest) {
    let existing;
    try {
      existing = await auth.api.getOAuthClient({
        headers: new Headers({ cookie }),
        query: { client_id: row.clientId },
      });
    } catch {}
    if (!existing)
      await auth.api.adminCreateOAuthClient({
        headers: new Headers({ cookie }),
        body: {
          client_name: `Aegyo first-party ${row.key}`,
          redirect_uris: [row.redirectUri],
          post_logout_redirect_uris: [row.postLogoutRedirectUri],
          scope: "openid email profile",
          grant_types: ["authorization_code"],
          response_types: ["code"],
          token_endpoint_auth_method: "client_secret_basic",
          skip_consent: true,
          require_pkce: true,
          enable_end_session: true,
        },
      });
    const current = await auth.api.getOAuthClient({
      headers: new Headers({ cookie }),
      query: { client_id: row.clientId },
    });
    if (
      current.client_id !== row.clientId ||
      current.client_name !== `Aegyo first-party ${row.key}` ||
      JSON.stringify(current.redirect_uris) !==
        JSON.stringify([row.redirectUri]) ||
      JSON.stringify(current.post_logout_redirect_uris) !==
        JSON.stringify([row.postLogoutRedirectUri]) ||
      current.reference_id !== "aegyo-first-party-v1" ||
      current.user_id
    )
      refuse("registered_client_metadata_mismatch");
    const basic = Buffer.from(`${row.clientId}:${row.clientSecret}`).toString(
      "base64",
    );
    const introspection = await auth.handler(
      new Request("https://account.aegyoarena.com/api/auth/oauth2/introspect", {
        method: "POST",
        headers: {
          authorization: `Basic ${basic}`,
          "content-type": "application/x-www-form-urlencoded",
        },
        body: "token=definitely-not-issued",
      }),
    );
    if (!introspection.ok || (await introspection.json()).active !== false)
      refuse("registered_client_secret_mismatch");
  }
  await database.query(
    `DELETE FROM public."session" WHERE "userId"=$1; DELETE FROM public."account" WHERE "userId"=$1; DELETE FROM public."user" WHERE id=$1`,
    [body.user.id],
  );
  const final = (
    await database.query(
      `SELECT (SELECT count(*)::int FROM public."user") users, (SELECT count(*)::int FROM public."session") sessions, (SELECT count(*)::int FROM public."account") accounts, (SELECT count(*)::int FROM public."oauthAccessToken") access_tokens, (SELECT count(*)::int FROM public."oauthRefreshToken") refresh_tokens, (SELECT count(*)::int FROM public."oauthClient") clients`,
    )
  ).rows[0];
  if (
    final.users ||
    final.sessions ||
    final.accounts ||
    final.access_tokens ||
    final.refresh_tokens ||
    final.clients !== 3
  )
    refuse("bootstrap_cleanup_failed");
  await database.query("COMMIT");
  committed = true;
  console.info(
    JSON.stringify({
      provisioned: counts.clients === 0,
      clients: 3,
      identities: 0,
      sessions: 0,
      tokens: 0,
    }),
  );
} catch (error) {
  if (!committed) await database.query("ROLLBACK").catch(() => {});
  console.error(
    error instanceof ClientProvisionRefusal
      ? error.message
      : "production_client_provision_failed",
  );
  process.exitCode = 1;
} finally {
  await database.end();
}
