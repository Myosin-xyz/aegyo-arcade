#!/usr/bin/env node
import "./check-runtime.mjs";
import { mkdir, open, realpath } from "node:fs/promises";
import { constants } from "node:fs";
import { dirname, relative, resolve } from "node:path";
import { fileURLToPath } from "node:url";
import pg from "pg";
import { databaseOptions } from "../src/database-options.mjs";
import {
  ImportRefusal,
  captureLegacySnapshot,
  verifyCredentialProof,
} from "../src/legacy-import.mjs";
import {
  RehearsalRefusal,
  assertInventory,
  validatePrivateSource,
} from "./real-rehearsal-preflight-lib.mjs";

const required = (name) =>
  process.env[name] ||
  (() => {
    throw new RehearsalRefusal(`missing_${name}`);
  })();
const integer = (name) => Number(required(name));
const proofRoot = fileURLToPath(new URL("../.proof", import.meta.url));
await mkdir(proofRoot, { recursive: true, mode: 0o700 });

const config = {
  confirm: process.env.ACCOUNTS_REAL_REHEARSAL_CONFIRM,
  ordinaryDatabaseUrl: process.env.DATABASE_URL,
  sourceUrl: required("ACCOUNTS_IMPORT_SOURCE_DATABASE_URL"),
  caCertificate: required("ACCOUNTS_IMPORT_SOURCE_DATABASE_CA_CERT"),
  serverSHA256: required("ACCOUNTS_IMPORT_SOURCE_DATABASE_SERVER_SHA256"),
  expectedTables: integer("ACCOUNTS_REAL_EXPECTED_TABLES"),
  expectedUsers: integer("ACCOUNTS_IMPORT_EXPECTED_COUNT"),
  expectedSessions: integer("ACCOUNTS_REAL_EXPECTED_SESSIONS"),
  canarySourceUserId: process.env.ACCOUNTS_REAL_CANARY_SOURCE_USER_ID,
  canaryPassword: process.env.ACCOUNTS_REAL_CANARY_PASSWORD,
  legacyPepper: process.env.ACCOUNTS_LEGACY_PEPPER,
  deployedPepperDigest: process.env.ACCOUNTS_REAL_DEPLOYED_PEPPER_DIGEST,
  credentialProofOutput: process.env.ACCOUNTS_IMPORT_CREDENTIAL_PROOF,
};

let pool;
let client;
try {
  const { canaryProvided } = validatePrivateSource(config);
  pool = new pg.Pool({
    ...databaseOptions(config.sourceUrl, {
      caCertificate: config.caCertificate,
      serverSHA256: config.serverSHA256,
    }),
    max: 1,
    connectionTimeoutMillis: 5000,
    statement_timeout: 300000,
    lock_timeout: 5000,
    application_name: "aegyo-real-rehearsal-preflight",
  });
  client = await pool.connect();
  await client.query("BEGIN ISOLATION LEVEL REPEATABLE READ READ ONLY");
  const identity = (
    await client.query(`SELECT current_database() AS database,
    current_user AS role, current_setting('transaction_read_only') AS read_only,
    r.rolsuper, r.rolcreatedb, r.rolcreaterole,
    coalesce(r.rolconfig @> ARRAY['default_transaction_read_only=on'], false) AS durable_read_only
    FROM pg_roles r WHERE r.rolname=current_user`)
  ).rows[0];
  if (identity.database !== required("ACCOUNTS_IMPORT_SOURCE_DATABASE_NAME"))
    throw new RehearsalRefusal("database_name_mismatch");
  if (
    identity.read_only !== "on" ||
    identity.rolsuper ||
    identity.rolcreatedb ||
    identity.rolcreaterole ||
    !identity.durable_read_only
  )
    throw new RehearsalRefusal("source_role_not_durable_read_only");
  const inventory = (
    await client.query(`SELECT
    (SELECT count(*)::int FROM pg_class c JOIN pg_namespace n ON n.oid=c.relnamespace
      WHERE n.nspname NOT IN ('pg_catalog','information_schema') AND n.nspname NOT LIKE 'pg_toast%' AND c.relkind IN ('r','p')) AS "tableCount",
    (SELECT count(*)::int FROM public."User") AS "userCount",
    (SELECT count(*)::int FROM public."Session") AS "sessionCount"`)
  ).rows[0];
  assertInventory(inventory, {
    tableCount: config.expectedTables,
    userCount: config.expectedUsers,
    sessionCount: config.expectedSessions,
  });
  const captured = await captureLegacySnapshot(client, {
    sourceNamespace: required("ACCOUNTS_IMPORT_SOURCE_NAMESPACE"),
    sourceDatabase: required("ACCOUNTS_IMPORT_SOURCE_DATABASE_NAME"),
    issuer: required("ACCOUNTS_IMPORT_ISSUER"),
  });
  let canaryVerified = false;
  if (canaryProvided) {
    verifyCredentialProof(captured.snapshot, {
      sourceUserId: config.canarySourceUserId,
      password: config.canaryPassword,
      legacyPepper: config.legacyPepper,
      deployedPepperDigest: config.deployedPepperDigest,
    });
    const output = resolve(config.credentialProofOutput);
    const parent = await realpath(dirname(output));
    const rel = relative(await realpath(proofRoot), parent);
    if (rel.startsWith("..") || rel.startsWith("/"))
      throw new RehearsalRefusal(
        "credential_output_outside_private_proof_directory",
      );
    const file = await open(
      output,
      constants.O_WRONLY |
        constants.O_CREAT |
        constants.O_EXCL |
        constants.O_NOFOLLOW,
      0o600,
    );
    try {
      await file.writeFile(
        JSON.stringify({
          sourceUserId: config.canarySourceUserId,
          password: config.canaryPassword,
          deployedPepperDigest: config.deployedPepperDigest,
        }) + "\n",
      );
      await file.sync();
    } finally {
      await file.close();
    }
    canaryVerified = true;
  }
  await client.query("ROLLBACK");
  console.info(
    JSON.stringify({
      databaseVerified: true,
      durableReadOnly: true,
      ...inventory,
      snapshotDigest: captured.snapshotDigest,
      canaryRequired: !canaryVerified,
      canaryVerified,
    }),
  );
} catch (error) {
  console.error(
    error instanceof RehearsalRefusal || error instanceof ImportRefusal
      ? error.message
      : "real_rehearsal_preflight_failed",
  );
  process.exitCode = 1;
} finally {
  try {
    await client?.query("ROLLBACK");
  } catch {}
  client?.release();
  await pool?.end();
}
