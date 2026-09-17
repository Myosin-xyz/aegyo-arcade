#!/usr/bin/env node
import { resolve } from "node:path";
import { fileURLToPath } from "node:url";
import { parseArgs } from "node:util";
import pg from "pg";
import {
  collectCompetitionPreflight,
  CompetitionPreflightError,
  validateDatabaseSelection,
} from "./preflight-lib.mjs";

function argumentsFrom(argv) {
  const normalized = argv[0] === "--" ? argv.slice(1) : argv;
  const { values } = parseArgs({
    args: normalized,
    options: {
      "expected-database": { type: "string" },
      "confirm-database": { type: "string" },
    },
    strict: true,
  });
  return {
    expectedDatabase: validateDatabaseSelection(
      values["expected-database"],
      values["confirm-database"],
    ),
  };
}

export function operatorDatabaseClientConfig(connectionString) {
  let address;
  try {
    address = new URL(connectionString);
  } catch {
    throw new CompetitionPreflightError("invalid_operator_database_url");
  }
  if (!["postgres:", "postgresql:"].includes(address.protocol))
    throw new CompetitionPreflightError("invalid_operator_database_url");
  const local = new Set(["localhost", "127.0.0.1", "::1", "[::1]"]).has(
    address.hostname,
  );
  const sslModes = address.searchParams.getAll("sslmode");
  if (!local && (sslModes.length !== 1 || sslModes[0] !== "verify-full"))
    throw new CompetitionPreflightError("database_tls_verification_required");
  return {
    connectionString,
    ...(local ? {} : { ssl: { rejectUnauthorized: true } }),
  };
}

export async function main(argv = process.argv.slice(2), env = process.env) {
  const { expectedDatabase } = argumentsFrom(argv);
  const connectionString = env.COMPETITION_OPERATOR_DATABASE_URL;
  if (!connectionString)
    throw new CompetitionPreflightError("operator_database_url_required");
  const client = new pg.Client({
    ...operatorDatabaseClientConfig(connectionString),
    application_name: "aegyo-competition-readonly-preflight",
    connectionTimeoutMillis: 10_000,
  });
  try {
    await client.connect();
    const report = await collectCompetitionPreflight(client, expectedDatabase);
    process.stdout.write(`${JSON.stringify(report, null, 2)}\n`);
    if (!report.ok) process.exitCode = 2;
  } finally {
    await client.end().catch(() => {});
  }
}

if (
  process.argv[1] &&
  resolve(process.argv[1]) === fileURLToPath(import.meta.url)
) {
  main().catch((error) => {
    const code =
      error instanceof CompetitionPreflightError
        ? error.code
        : "competition_preflight_failed";
    process.stderr.write(`${JSON.stringify({ ok: false, error: code })}\n`);
    process.exitCode = 1;
  });
}
