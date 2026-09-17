/** Aggregate/catalog inventory. Does not fetch users, credentials or wallets. */
import { execFileSync } from "node:child_process";
import { chmod, mkdir, writeFile } from "node:fs/promises";
import { resolve } from "node:path";
import { fileURLToPath } from "node:url";
import { parseArgs } from "node:util";
import pg from "pg";

const expectedTables = {
  // Minimum preservation tripwires, including tables created outside Prisma.
  // The collector still inventories every public table, not only this list.
  aegyo: [
    "User",
    "Session",
    "PasswordReset",
    "EventRegistration",
    "CommunityAnnotation",
  ],
  arcade: ["devices", "device_sessions", "run_attempts", "streaks"],
  daebak: [
    "users",
    "daebuks_grants",
    "referral_codes",
    "referral_attributions",
  ],
};

function identifier(name) {
  return '"' + name.replaceAll('"', '""') + '"';
}

/** Inject a pg-compatible client for tests; all queries run in READ ONLY. */
export async function collectInventory(client, product) {
  if (!Object.hasOwn(expectedTables, product))
    throw new Error("Unknown product");
  await client.query("BEGIN ISOLATION LEVEL REPEATABLE READ READ ONLY");
  try {
    await client.query("SET LOCAL statement_timeout = '15s'");
    await client.query("SET LOCAL lock_timeout = '2s'");
    await client.query("SET LOCAL idle_in_transaction_session_timeout = '30s'");
    // Respect permissions/RLS explicitly; partial counts must never look complete.
    await client.query("SET LOCAL row_security = off");
    const { rows: catalog } = await client.query(`
      SELECT c.oid, c.relname AS name, c.relrowsecurity AS row_security,
             c.relforcerowsecurity AS force_row_security,
             pg_catalog.has_table_privilege(c.oid, 'SELECT') AS can_read
      FROM pg_catalog.pg_class c
      JOIN pg_catalog.pg_namespace n ON n.oid = c.relnamespace
      WHERE n.nspname = 'public' AND c.relkind IN ('r', 'p')
        AND NOT c.relispartition
      ORDER BY c.relname
    `);
    const tables = [];
    for (const table of catalog) {
      if (!table.can_read) throw new Error("Incomplete inventory permissions");
      const { rows: count } = await client.query(
        `SELECT count(*)::text AS count FROM public.${identifier(table.name)}`,
      );
      const { rows: columns } = await client.query(
        `SELECT a.attname AS name,
                pg_catalog.format_type(a.atttypid, a.atttypmod) AS type,
                a.attnotnull AS not_null
         FROM pg_catalog.pg_attribute a
         WHERE a.attrelid = $1 AND a.attnum > 0 AND NOT a.attisdropped
         ORDER BY a.attnum`,
        [table.oid],
      );
      const { rows: constraints } = await client.query(
        `SELECT conname AS name, contype AS type, convalidated AS validated
         FROM pg_catalog.pg_constraint WHERE conrelid = $1 ORDER BY conname`,
        [table.oid],
      );
      tables.push({
        name: table.name,
        count: count[0].count,
        rowSecurity: table.row_security,
        forceRowSecurity: table.force_row_security,
        columns,
        constraints,
      });
    }
    const found = new Set(tables.map((t) => t.name));
    const missingExpectedTables = expectedTables[product].filter(
      (name) => !found.has(name),
    );
    await client.query("ROLLBACK");
    return {
      version: 1,
      product,
      observedAt: new Date().toISOString(),
      transaction: "repeatable-read, read-only, rolled back",
      scope: "public base tables; counts and catalog only",
      completeForExpectedTables: missingExpectedTables.length === 0,
      missingExpectedTables,
      tables,
      limitations: [
        "Database inventory is not a Privy identity count or backup/restore proof.",
        "A database URL alone does not establish which deployment uses it.",
        "Re-inventory before cutover; no source records or credentials exported.",
      ],
    };
  } catch (error) {
    await client.query("ROLLBACK").catch(() => {});
    throw error;
  }
}

async function main() {
  const { values } = parseArgs({
    options: {
      product: { type: "string" },
      "database-env": { type: "string" },
      "railway-cwd": { type: "string" },
      service: { type: "string" },
      environment: { type: "string" },
    },
    strict: true,
  });
  const product = values.product;
  if (!Object.hasOwn(expectedTables, product)) {
    throw new Error("Set --product aegyo|arcade|daebak");
  }
  const usesRailway = Boolean(values["railway-cwd"]);
  const usesEnv = Boolean(values["database-env"]);
  if (usesRailway === usesEnv) {
    throw new Error("Choose one explicit credential source");
  }
  let connectionString;
  if (usesRailway) {
    if (!values.service || !values.environment) {
      throw new Error("Railway service and environment are required");
    }
    // Secrets stay in process memory, never command arguments or diagnostics.
    const variables = JSON.parse(
      execFileSync(
        "railway",
        [
          "variables",
          "--json",
          "--service",
          values.service,
          "--environment",
          values.environment,
        ],
        {
          cwd: values["railway-cwd"],
          encoding: "utf8",
          timeout: 30_000,
          stdio: ["ignore", "pipe", "pipe"],
        },
      ),
    );
    connectionString = variables.DATABASE_PUBLIC_URL;
  } else {
    if (!/^[A-Z_][A-Z0-9_]*$/.test(values["database-env"])) {
      throw new Error("Invalid environment variable name");
    }
    connectionString = process.env[values["database-env"]];
  }
  if (!connectionString) throw new Error("Requested connection is unavailable");
  const address = new URL(connectionString);
  if (!["postgres:", "postgresql:"].includes(address.protocol)) {
    throw new Error("Expected PostgreSQL connection");
  }
  const client = new pg.Client({
    connectionString,
    application_name: "aegyo-auth-readonly-inventory",
    connectionTimeoutMillis: 10_000,
    // Do not disable TLS certificate verification or rewrite the supplied URL.
  });
  try {
    await client.connect();
    const report = await collectInventory(client, product);
    const directory = resolve(".auth-proof");
    await mkdir(directory, { recursive: true, mode: 0o700 });
    await chmod(directory, 0o700);
    const filename = `${product}-inventory-${Date.now()}.json`;
    await writeFile(
      resolve(directory, filename),
      JSON.stringify(report, null, 2) + "\n",
      {
        mode: 0o600,
        flag: "wx",
      },
    );
    console.log(`Private aggregate inventory saved: .auth-proof/${filename}`);
    console.log(`Expected tables present: ${report.completeForExpectedTables}`);
    if (!report.completeForExpectedTables) process.exitCode = 2;
  } finally {
    await client.end().catch(() => {});
  }
}

if (
  process.argv[1] &&
  resolve(process.argv[1]) === fileURLToPath(import.meta.url)
) {
  main().catch(() => {
    // Driver/CLI errors may contain credentials or user identifiers.
    console.error(
      "Inventory failed; no complete report produced. Check explicit access and database selection privately.",
    );
    process.exitCode = 1;
  });
}
