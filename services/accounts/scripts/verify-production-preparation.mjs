#!/usr/bin/env node
import "./check-runtime.mjs";
import pg from "pg";
import { databaseOptions } from "../src/database-options.mjs";
import { checkDatabaseReadiness } from "../src/security-state.mjs";

// Preparation-only, read-only proof. User migration makes this check inapplicable.
let database;
try {
  if (
    process.env.DATABASE_URL ||
    process.env.ACCOUNTS_ENVIRONMENT !== "production" ||
    process.env.ACCOUNTS_TRAFFIC_ENABLED !== "false" ||
    process.env.ACCOUNTS_SIGNUP_ENABLED !== "false" ||
    !process.env.ACCOUNTS_MIGRATION_DATABASE_CA_CERT ||
    !process.env.ACCOUNTS_MIGRATION_DATABASE_SERVER_SHA256 ||
    !["0", "3"].includes(process.env.ACCOUNTS_EXPECTED_CLIENTS)
  )
    throw new Error("preparation_gate_failed");
  database = new pg.Pool({
    ...databaseOptions(process.env.ACCOUNTS_RUNTIME_CHECK_DATABASE_URL, {
      caCertificate: process.env.ACCOUNTS_MIGRATION_DATABASE_CA_CERT,
      serverSHA256: process.env.ACCOUNTS_MIGRATION_DATABASE_SERVER_SHA256,
    }),
    max: 1,
    connectionTimeoutMillis: 5000,
    statement_timeout: 30000,
    lock_timeout: 5000,
    application_name: "accounts-production-preparation-check",
  });
  await database.query("BEGIN ISOLATION LEVEL REPEATABLE READ READ ONLY");
  const identity = (
    await database.query(
      "SELECT current_database() AS name, current_user AS role",
    )
  ).rows[0];
  if (
    identity.name !== "accounts_production" ||
    identity.role !== "aegyo_accounts_production_app"
  )
    throw new Error("database_identity_mismatch");
  if (!(await checkDatabaseReadiness(database)))
    throw new Error("runtime_privileges_or_guards_invalid");
  const counts = (
    await database.query(`SELECT
    (SELECT count(*)::int FROM public."user") users,
    (SELECT count(*)::int FROM public."session") sessions,
    (SELECT count(*)::int FROM public."account") accounts,
    (SELECT count(*)::int FROM public."oauthAccessToken") access_tokens,
    (SELECT count(*)::int FROM public."oauthRefreshToken") refresh_tokens,
    (SELECT count(*)::int FROM public."oauthClient") clients`)
  ).rows[0];
  if (
    counts.users ||
    counts.sessions ||
    counts.accounts ||
    counts.access_tokens ||
    counts.refresh_tokens ||
    counts.clients !== Number(process.env.ACCOUNTS_EXPECTED_CLIENTS)
  )
    throw new Error("unexpected_preparation_population");
  await database.query("ROLLBACK");
  console.info(
    JSON.stringify({
      databaseVerified: true,
      restrictedRuntimeRole: true,
      credentialGuardsReady: true,
      ...counts,
      authenticationActivated: false,
    }),
  );
} catch {
  console.error("production_preparation_check_failed");
  process.exitCode = 1;
} finally {
  await database?.query("ROLLBACK").catch(() => {});
  await database?.end();
}
