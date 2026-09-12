import "./check-runtime.mjs";
import { createHash } from "node:crypto";
import { readFile } from "node:fs/promises";
import pg from "pg";
import { databaseOptions } from "../src/database-options.mjs";

const fail = (message) => {
  throw new Error(message);
};
if (process.env.ACCOUNTS_GUARD_UPGRADE_CONFIRM !== "oauth-token-revocation-v2")
  fail("guard_upgrade_confirmation_required");
if (process.env.DATABASE_URL) fail("ordinary_DATABASE_URL_forbidden");
const connectionString = process.env.ACCOUNTS_MIGRATION_DATABASE_URL;
const expectedDatabase = process.env.ACCOUNTS_GUARD_UPGRADE_DATABASE_NAME;
if (!connectionString) fail("migration_database_url_required");
if (!/^[a-z_][a-z0-9_]{0,62}$/.test(expectedDatabase ?? ""))
  fail("expected_database_name_required");
const source = async (name) =>
  readFile(new URL(`../src/${name}`, import.meta.url), "utf8");
const bodies = (sql) =>
  [...sql.matchAll(/CREATE OR REPLACE FUNCTION\s+public\.([a-z_]+).*?AS \$\$(.*?)\$\$;/gs)]
    .map(([, name, body]) => [name, createHash("sha256").update(body).digest("hex")])
    .sort(([a], [b]) => a.localeCompare(b));
const previous = bodies(await source("credential-guards-v1.sql"));
const replacement = await source("credential-guards.sql");
const database = new pg.Pool({
  ...databaseOptions(connectionString, {
    caCertificate:
      process.env.ACCOUNTS_MIGRATION_DATABASE_CA_CERT ??
      process.env.ACCOUNTS_DATABASE_CA_CERT,
    serverSHA256:
      process.env.ACCOUNTS_MIGRATION_DATABASE_SERVER_SHA256 ??
      process.env.ACCOUNTS_DATABASE_SERVER_SHA256,
  }),
  max: 1,
});
try {
  await database.query("BEGIN");
  await database.query("SET LOCAL lock_timeout='10s'");
  await database.query("SET LOCAL statement_timeout='120s'");
  await database.query(
    "SELECT pg_advisory_xact_lock(hashtext('aegyo-accounts-schema-v1'))",
  );
  const identity = await database.query(
    "SELECT current_database() AS database, to_regclass('public.aegyo_schema_version') IS NOT NULL AS marker",
  );
  if (
    identity.rows[0]?.database !== expectedDatabase ||
    identity.rows[0]?.marker !== true
  )
    fail("accounts_database_identity_mismatch");
  const marker = await database.query(
    'SELECT version,tables FROM public.aegyo_schema_version',
  );
  if (marker.rowCount !== 1 || marker.rows[0].version !== 1)
    fail("accounts_schema_marker_unsupported");
  const revision = await database.query(
    "SELECT column_name FROM information_schema.columns WHERE table_schema='public' AND table_name='aegyo_schema_version' AND column_name='guard_revision'",
  );
  if (revision.rowCount) fail("guard_upgrade_already_applied");
  const installed = (
    await database.query(
      "SELECT proname,prosrc FROM pg_proc JOIN pg_namespace n ON n.oid=pronamespace WHERE n.nspname='public' AND proname=ANY($1::text[]) ORDER BY proname",
      [previous.map(([name]) => name)],
    )
  ).rows.map(({ proname, prosrc }) => [
    proname,
    createHash("sha256").update(prosrc).digest("hex"),
  ]);
  if (JSON.stringify(installed) !== JSON.stringify(previous))
    fail("installed_guard_definition_unrecognized");
  await database.query(replacement);
  await database.query(
    'ALTER TABLE public.aegyo_schema_version ADD COLUMN guard_revision integer NOT NULL DEFAULT 2 CHECK (guard_revision=2)',
  );
  await database.query("COMMIT");
  console.log("Credential guards upgraded to revision 2");
} catch (error) {
  await database.query("ROLLBACK").catch(() => {});
  console.error(
    error instanceof Error && /^[A-Za-z0-9_]+$/.test(error.message)
      ? error.message
      : "credential_guard_upgrade_failed",
  );
  process.exitCode = 1;
} finally {
  await database.end();
}
