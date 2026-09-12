#!/usr/bin/env node
import "./check-runtime.mjs";
import { readFile } from "node:fs/promises";
import { randomBytes } from "node:crypto";
import pg from "pg";
import { CompiledQuery, Kysely, PostgresDialect } from "kysely";
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
const localProof =
  process.env.ACCOUNTS_PRODUCTION_CLIENT_LOCAL_PROOF ===
  "disposable-unix-socket";
const connectionString = required("ACCOUNTS_MIGRATION_DATABASE_URL");
if (localProof) {
  const url = new URL(connectionString);
  if (
    url.hostname !== "localhost" ||
    !/^\/tmp\/aegyo-idp-proof-[A-Za-z0-9]+$/.test(
      url.searchParams.get("host") ?? "",
    )
  )
    refuse("local_proof_must_use_disposable_unix_socket");
}
const pool = new pg.Pool({
  ...databaseOptions(
    connectionString,
    localProof
      ? {}
      : {
          caCertificate: required("ACCOUNTS_MIGRATION_DATABASE_CA_CERT"),
          serverSHA256: required("ACCOUNTS_MIGRATION_DATABASE_SERVER_SHA256"),
        },
  ),
  max: 1,
  connectionTimeoutMillis: 5000,
  statement_timeout: 30000,
  lock_timeout: 5000,
  application_name: "accounts-production-client-provisioner",
});
const kysely = new Kysely({ dialect: new PostgresDialect({ pool }) });
let committed = false;
try {
  const result = await kysely.transaction().execute(async (transaction) => {
    const database = {
      async query(text, parameters = []) {
        const result = await transaction.executeQuery(
          CompiledQuery.raw(text, parameters),
        );
        return {
          rows: result.rows,
          rowCount: Number(result.numAffectedRows ?? result.rows.length),
        };
      },
    };
    const adapterDatabase = {
      db: transaction,
      type: "postgres",
      transaction: false,
    };
    await database.query(
      "SELECT pg_advisory_xact_lock(hashtext('accounts-production-clients-v1'))",
    );
    const preservedState = async () => {
      const tables = (
        await database.query(`SELECT table_name FROM information_schema.tables
        WHERE table_schema='public' AND table_type='BASE TABLE' AND table_name <> 'oauthClient'
        ORDER BY table_name`)
      ).rows.map((row) => row.table_name);
      const result = {};
      for (const table of tables) {
        const quoted = `"${table.replaceAll('"', '""')}"`;
        result[table] = (
          await database.query(
            `SELECT to_jsonb(t) AS row FROM public.${quoted} t ORDER BY to_jsonb(t)::text`,
          )
        ).rows.map(({ row }) => row);
      }
      return JSON.stringify(result);
    };
    const beforeState = await preservedState();
    const db = (await database.query("SELECT current_database() name")).rows[0]
      ?.name;
    if (
      db !== "accounts_production" ||
      db !== required("ACCOUNTS_MIGRATION_DATABASE_NAME")
    )
      refuse("database_name_mismatch");
    const counts = (
      await database.query(
        `SELECT (SELECT count(*)::int FROM public."user") users, (SELECT count(*)::int FROM public."session") sessions, (SELECT count(*)::int FROM public."account") accounts, (SELECT count(*)::int FROM public."oauthAccessToken") access_tokens, (SELECT count(*)::int FROM public."oauthRefreshToken") refresh_tokens, (SELECT count(*)::int FROM public."oauthClient") clients`,
      )
    ).rows[0];
    if (
      counts.users !== 0 ||
      counts.sessions !== 0 ||
      counts.accounts !== 0 ||
      counts.access_tokens !== 0 ||
      counts.refresh_tokens !== 0 ||
      ![0, 3].includes(counts.clients)
    )
      refuse("database_population_refused");
    const { auth } = createAccountsProvider({
      database,
      offlineAdapterDatabase: adapterDatabase,
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
    let created = 0;
    for (const row of manifest) {
      let existing;
      try {
        existing = await auth.api.getOAuthClient({
          headers: new Headers({ cookie }),
          query: { client_id: row.clientId },
        });
      } catch {}
      if (!existing) {
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
        created += 1;
        if (
          localProof &&
          Number(process.env.ACCOUNTS_PRODUCTION_CLIENT_PROOF_FAIL_AFTER) ===
            created
        )
          refuse("injected_middle_registration_failure");
      }
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
        current.user_id ||
        current.token_endpoint_auth_method !== "client_secret_basic" ||
        current.require_pkce !== true ||
        current.skip_consent !== true ||
        current.enable_end_session !== true ||
        current.disabled === true ||
        current.scope !== "openid email profile" ||
        JSON.stringify(current.grant_types) !==
          JSON.stringify(["authorization_code"]) ||
        JSON.stringify(current.response_types) !== JSON.stringify(["code"])
      )
        refuse("registered_client_metadata_mismatch");
      const basic = Buffer.from(`${row.clientId}:${row.clientSecret}`).toString(
        "base64",
      );
      const introspection = await auth.handler(
        new Request(
          "https://account.aegyoarena.com/api/auth/oauth2/introspect",
          {
            method: "POST",
            headers: {
              authorization: `Basic ${basic}`,
              "content-type": "application/x-www-form-urlencoded",
            },
            body: "token=definitely-not-issued",
          },
        ),
      );
      if (!introspection.ok || (await introspection.json()).active !== false)
        refuse("registered_client_secret_mismatch");
    }
    await database.query(`DELETE FROM public."session" WHERE "userId"=$1`, [
      body.user.id,
    ]);
    await database.query(`DELETE FROM public."account" WHERE "userId"=$1`, [
      body.user.id,
    ]);
    await database.query(`DELETE FROM public."user" WHERE id=$1`, [
      body.user.id,
    ]);
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
    if ((await preservedState()) !== beforeState)
      refuse("unrelated_table_state_changed");
    return {
      provisioned: counts.clients === 0,
      clients: 3,
      identities: 0,
      sessions: 0,
      tokens: 0,
    };
  });
  committed = true;
  console.info(JSON.stringify(result));
} catch (error) {
  console.error(
    error instanceof ClientProvisionRefusal
      ? error.message
      : "production_client_provision_failed",
  );
  process.exitCode = 1;
} finally {
  await kysely.destroy();
}
