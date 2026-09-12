import "./check-runtime.mjs";
import { createHash } from "node:crypto";
import { readFile } from "node:fs/promises";
import pg from "pg";
import { getMigrations } from "better-auth/db/migration";
import { createAccountsProvider } from "../src/provider-core.mjs";
import { databaseOptions } from "../src/database-options.mjs";

const CONFIRMATION = "dedicated-accounts-database";
const MARKER = "aegyo_schema_version";
const VERSION = 1;
const role = process.env.ACCOUNTS_DATABASE_ROLE || "aegyo_accounts_app";

class MigrationRefusal extends Error {}

function fail(message) {
  throw new MigrationRefusal(message);
}

function identifier(value) {
  if (!/^[a-z_][a-z0-9_]{0,62}$/.test(value))
    fail("ACCOUNTS_DATABASE_ROLE must be a simple PostgreSQL role name");
  return `"${value}"`;
}

function literal(value) {
  return `'${value.replaceAll("'", "''")}'`;
}

function quotedColumn(value) {
  return `"${value.replaceAll('"', '""')}"`;
}

if (process.env.ACCOUNTS_MIGRATION_CONFIRM !== CONFIRMATION)
  fail(
    `Set ACCOUNTS_MIGRATION_CONFIRM=${CONFIRMATION} after selecting the dedicated Accounts database`,
  );
if (process.env.DATABASE_URL)
  fail("DATABASE_URL must not be present in the migration process");
const connectionString = process.env.ACCOUNTS_MIGRATION_DATABASE_URL;
if (!connectionString) fail("ACCOUNTS_MIGRATION_DATABASE_URL is required");

identifier(role);
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
let committed = false;
let phase = "connect";

try {
  phase = "lock";
  await database.query("BEGIN");
  await database.query("SET LOCAL lock_timeout = '10s'");
  await database.query("SET LOCAL statement_timeout = '120s'");
  await database.query(
    "SELECT pg_advisory_xact_lock(hashtext('aegyo-accounts-schema-v1'))",
  );

  const tablesResult = await database.query(`
    SELECT table_name
    FROM information_schema.tables
    WHERE table_schema = 'public' AND table_type = 'BASE TABLE'
    ORDER BY table_name
  `);
  const existingTables = tablesResult.rows.map(({ table_name }) => table_name);
  const hasMarker = existingTables.includes(MARKER);
  if (existingTables.length > 0 && !hasMarker)
    fail(
      "Refusing migration: public contains tables but is not an initialized Accounts database",
    );

  let recordedTables;
  if (hasMarker) {
    const marker = await database.query(
      `SELECT version, tables FROM public.${MARKER}`,
    );
    if (
      marker.rowCount !== 1 ||
      marker.rows[0].version !== VERSION ||
      !Array.isArray(marker.rows[0].tables)
    )
      fail(
        "Refusing migration: Accounts schema marker is missing or unsupported",
      );
    recordedTables = [...marker.rows[0].tables].sort();
    const recordedInventory = [...recordedTables, MARKER].sort();
    if (JSON.stringify(recordedInventory) !== JSON.stringify(existingTables))
      fail(
        "Refusing migration: public table inventory differs from the recorded Accounts schema",
      );
  }

  const { options } = createAccountsProvider({
    database,
    secret: "migration-schema-only-secret-with-at-least-32-bytes",
    legacyPepper: "migration-schema-only-pepper",
    baseURL: "https://accounts-schema.invalid",
    mail: null,
  });
  phase = "generate-schema";
  const migration = await getMigrations(options);
  const pending =
    migration.toBeCreated.length +
    migration.toBeAdded.length +
    migration.toBeAddedIndexes.length;
  if (migration.unsafeChanges.length || migration.schemaProblems.length)
    fail(
      "Refusing migration: generated schema reports unsafe changes or drift",
    );
  if (hasMarker && pending)
    fail(
      "Refusing migration: schema changed; review and version a new migration explicitly",
    );

  if (!hasMarker) {
    phase = "install-schema";
    const generatedTables = migration.toBeCreated
      .map(({ table }) => table)
      .sort();
    if (!generatedTables.length || migration.toBeAdded.length)
      fail(
        "Refusing migration: the dedicated database was not empty at schema generation",
      );
    const compiled = await migration.compileMigrations();
    const schemaHash = createHash("sha256").update(compiled).digest("hex");
    await migration.runMigrations();
    const guards = await readFile(
      new URL("../src/credential-guards.sql", import.meta.url),
      "utf8",
    );
    await database.query(guards);
    await database.query(
      `CREATE TABLE public.${MARKER} (
        version integer PRIMARY KEY CHECK (version > 0),
        guard_revision integer NOT NULL CHECK (guard_revision = 2),
        tables text[] NOT NULL,
        schema_hash text NOT NULL CHECK (length(schema_hash) = 64),
        installed_at timestamptz NOT NULL DEFAULT clock_timestamp()
      )`,
    );
    await database.query(
      `INSERT INTO public.${MARKER} (version, guard_revision, tables, schema_hash) VALUES ($1, 2, $2, $3)`,
      [VERSION, generatedTables, schemaHash],
    );
    recordedTables = generatedTables;
  }

  const roleResult = await database.query(
    "SELECT 1 FROM pg_catalog.pg_roles WHERE rolname = $1",
    [role],
  );
  if (roleResult.rowCount === 0) {
    phase = "create-role";
    const password = process.env.ACCOUNTS_DATABASE_ROLE_PASSWORD;
    if (!password)
      fail(
        "ACCOUNTS_DATABASE_ROLE_PASSWORD is required when creating the application role",
      );
    await database.query(
      `CREATE ROLE ${identifier(role)} LOGIN PASSWORD ${literal(password)} NOSUPERUSER NOCREATEDB NOCREATEROLE NOINHERIT NOREPLICATION`,
    );
  } else {
    const attributes = await database.query(
      `SELECT rolcanlogin, rolsuper, rolcreatedb, rolcreaterole, rolreplication, rolbypassrls
       FROM pg_catalog.pg_roles WHERE rolname = $1`,
      [role],
    );
    const { rolcanlogin, ...elevated } = attributes.rows[0];
    if (!rolcanlogin || Object.values(elevated).some(Boolean))
      fail(
        "Refusing migration: existing application role is not a restricted login role",
      );
  }

  phase = "grant-privileges";
  await database.query("REVOKE CREATE ON SCHEMA public FROM PUBLIC");
  await database.query(
    `REVOKE CREATE ON SCHEMA public FROM ${identifier(role)}`,
  );
  await database.query(`GRANT USAGE ON SCHEMA public TO ${identifier(role)}`);
  const currentDatabase = await database.query(
    "SELECT current_database() AS name",
  );
  await database.query(
    `GRANT CONNECT ON DATABASE ${quotedColumn(currentDatabase.rows[0].name)} TO ${identifier(role)}`,
  );

  const protectedUserColumns = new Set([
    "passwordChangedAt",
    "credentialVersion",
    "securityVersion",
    "operatorRevokedAt",
    "role",
    "banned",
    "banReason",
    "banExpires",
  ]);
  for (const table of recordedTables) {
    const tableName = quotedColumn(table);
    const columns = await database.query(
      `SELECT column_name FROM information_schema.columns
       WHERE table_schema = 'public' AND table_name = $1 ORDER BY ordinal_position`,
      [table],
    );
    const allColumns = columns.rows.map(({ column_name }) => column_name);
    await database.query(
      `REVOKE ALL PRIVILEGES ON TABLE public.${tableName} FROM ${identifier(role)}`,
    );
    await database.query(
      `REVOKE UPDATE (${allColumns.map(quotedColumn).join(", ")}) ON TABLE public.${tableName} FROM ${identifier(role)}`,
    );
    await database.query(
      `GRANT SELECT, INSERT, DELETE ON TABLE public.${tableName} TO ${identifier(role)}`,
    );
    const updatable = allColumns.filter(
      (column) => table !== "user" || !protectedUserColumns.has(column),
    );
    if (!updatable.length)
      fail(
        "Refusing migration: generated table has no application-updatable columns",
      );
    await database.query(
      `GRANT UPDATE (${updatable.map(quotedColumn).join(", ")}) ON TABLE public.${tableName} TO ${identifier(role)}`,
    );
  }
  await database.query(
    `REVOKE ALL ON TABLE public.${quotedColumn(MARKER)} FROM ${identifier(role)}`,
  );
  await database.query(
    `GRANT SELECT ON TABLE public.${quotedColumn(MARKER)} TO ${identifier(role)}`,
  );
  await database.query(
    `REVOKE ALL ON FUNCTION public.aegyo_revoke_user(text, boolean) FROM ${identifier(role)}`,
  );
  const ownership = await database.query(
    `SELECT 1 FROM (
       SELECT c.relowner AS owner FROM pg_catalog.pg_class c
       JOIN pg_catalog.pg_namespace n ON n.oid = c.relnamespace
       WHERE n.nspname = 'public' AND c.relkind IN ('r', 'p', 'S')
       UNION ALL
       SELECT p.proowner AS owner FROM pg_catalog.pg_proc p
       JOIN pg_catalog.pg_namespace n ON n.oid = p.pronamespace
       WHERE n.nspname = 'public'
     ) objects
     JOIN pg_catalog.pg_roles r ON r.oid = objects.owner
     WHERE r.rolname = $1
     LIMIT 1`,
    [role],
  );
  if (ownership.rowCount)
    fail("Refusing migration: application role owns an Accounts schema object");

  await database.query("COMMIT");
  committed = true;
  console.info(
    `Accounts schema version ${VERSION} is installed and application privileges are restricted.`,
  );
} catch (error) {
  if (!committed) await database.query("ROLLBACK").catch(() => {});
  console.error(
    error instanceof MigrationRefusal
      ? error.message
      : `Accounts migration failed (${
          typeof error?.code === "string" && /^[A-Z0-9]{5}$/.test(error.code)
            ? error.code
            : "internal"
        }, ${phase}); inspect sanitized database operator logs.`,
  );
  process.exitCode = 1;
} finally {
  await database.end();
}
