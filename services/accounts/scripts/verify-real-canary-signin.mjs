#!/usr/bin/env node
import "./check-runtime.mjs";
import pg from "pg";
import { createAccountsProvider } from "../src/provider-core.mjs";
import { databaseOptions } from "../src/database-options.mjs";

const fail = (code) => { throw new Error(code); };
const required = (name) => process.env[name] || fail(`missing_${name}`);
let database;
try {
  if (process.env.DATABASE_URL) fail("ordinary_DATABASE_URL_forbidden");
  if (required("ACCOUNTS_REAL_CANARY_CONFIRM") !== "verify-imported-team-canary") fail("canary_confirmation_missing");
  const expectedDatabase = required("ACCOUNTS_IMPORT_TARGET_DATABASE_NAME");
  if (!/^accounts_rehearsal_[0-9]{8}_[a-z0-9]{6,16}$/.test(expectedDatabase)) fail("production_target_forbidden");
  database = new pg.Pool({
    ...databaseOptions(required("ACCOUNTS_IMPORT_TARGET_DATABASE_URL"), {
      caCertificate: required("ACCOUNTS_IMPORT_TARGET_DATABASE_CA_CERT"),
      serverSHA256: required("ACCOUNTS_IMPORT_TARGET_DATABASE_SERVER_SHA256"),
    }), max: 1,
  });
  if ((await database.query("SELECT current_database() name")).rows[0]?.name !== expectedDatabase) fail("database_name_mismatch");
  const mapping = (await database.query(
    `SELECT i.subject, u."emailVerified", u.role FROM aegyo_import.identities i
     JOIN public."user" u ON u.id=i.subject
     WHERE i.source_namespace=$1 AND i.local_user_id=$2`,
    [required("ACCOUNTS_IMPORT_SOURCE_NAMESPACE"), required("ACCOUNTS_REAL_CANARY_SOURCE_USER_ID")],
  )).rows;
  if (mapping.length !== 1) fail("canary_mapping_missing");
  if (mapping[0].emailVerified !== false || mapping[0].role !== "user") fail("canary_state_not_preserved");
  const { auth } = createAccountsProvider({
    database,
    secret: required("BETTER_AUTH_SECRET"),
    legacyPepper: required("ACCOUNTS_LEGACY_PEPPER"),
    baseURL: required("ACCOUNTS_BASE_URL"),
    mail: null,
    signupAllowed: false,
  });
  const response = await auth.handler(new Request(`${required("ACCOUNTS_BASE_URL")}/api/auth/sign-in/email`, {
    method: "POST",
    headers: { "content-type": "application/json", origin: new URL(required("ACCOUNTS_BASE_URL")).origin },
    body: JSON.stringify({ email: required("ACCOUNTS_REAL_CANARY_EMAIL"), password: required("ACCOUNTS_REAL_CANARY_PASSWORD") }),
  }));
  if (!response.ok || (await response.json()).user?.id !== mapping[0].subject) fail("imported_canary_signin_failed");
  console.info("imported_canary_signin=true");
} catch (error) {
  console.error(/^[_a-z]+$/.test(error?.message ?? "") ? error.message : "canary_signin_failed");
  process.exitCode = 1;
} finally {
  await database?.end();
}
