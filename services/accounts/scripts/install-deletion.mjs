import "./check-runtime.mjs";
import { readFile } from "node:fs/promises";
import pg from "pg";
import { databaseOptions } from "../src/database-options.mjs";

if (
  process.env.ACCOUNTS_DELETION_SCHEMA_CONFIRM !== "install-account-deletion" ||
  process.env.DATABASE_URL
)
  throw new Error(
    "Use the explicit deletion migration confirmation and migration connection only",
  );
const name = process.env.ACCOUNTS_MIGRATION_DATABASE_NAME;
const role = process.env.ACCOUNTS_DATABASE_ROLE || "aegyo_accounts_app";
if (
  !/^[a-z_][a-z0-9_]{0,62}$/.test(name || "") ||
  !/^[a-z_][a-z0-9_]{0,62}$/.test(role)
)
  throw new Error("Exact database name and restricted runtime role required");
if (!process.env.ACCOUNTS_MIGRATION_DATABASE_URL)
  throw new Error("Migration connection required");
const pool = new pg.Pool({
  ...databaseOptions(process.env.ACCOUNTS_MIGRATION_DATABASE_URL, {
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
  await pool.query("BEGIN");
  const actual = await pool.query("SELECT current_database() name");
  if (actual.rows[0].name !== name) throw new Error("Wrong database");
  await pool.query("SET LOCAL lock_timeout='10s'");
  await pool.query("SET LOCAL statement_timeout='60s'");
  const marker = await pool.query(
    "SELECT version FROM public.aegyo_schema_version",
  );
  if (!marker.rows.some((r) => r.version === 1))
    throw new Error("Not a prepared Accounts database");
  const runtime = await pool.query(
    "SELECT rolsuper,rolcreaterole,rolcreatedb,rolbypassrls FROM pg_roles WHERE rolname=$1",
    [role],
  );
  if (runtime.rows.length !== 1 || Object.values(runtime.rows[0]).some(Boolean))
    throw new Error("Runtime role must be restricted");
  await pool.query(
    "SELECT pg_advisory_xact_lock(hashtext('aegyo-accounts-deletion-schema'))",
  );
  await pool.query(
    await readFile(
      new URL("../src/deletion-schema.sql", import.meta.url),
      "utf8",
    ),
  );
  await pool.query(`GRANT USAGE ON SCHEMA account_deletion TO "${role}";
    GRANT SELECT,UPDATE ON account_deletion.jobs TO "${role}";
    GRANT EXECUTE ON FUNCTION account_deletion.begin_request(text,text,uuid,text) TO "${role}";
    GRANT EXECUTE ON FUNCTION account_deletion.finish_request(uuid) TO "${role}";`);
  await pool.query("COMMIT");
  console.info(
    "Deletion schema installed; feature remains disabled until explicitly configured.",
  );
} catch (e) {
  await pool.query("ROLLBACK");
  throw e;
} finally {
  await pool.end();
}
