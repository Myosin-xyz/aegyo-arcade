#!/usr/bin/env node
import "./check-runtime.mjs";
import pg from "pg";
import { databaseOptions } from "../src/database-options.mjs";
const fail = (c) => {
  throw new Error(c);
};
const req = (n) => process.env[n] || fail(`missing_${n}`);
let pool;
try {
  pool = new pg.Pool({
    ...databaseOptions(req("REHEARSAL_LEGACY_OWNER_DATABASE_URL"), {
      caCertificate: req("REHEARSAL_DATABASE_CA_CERT"),
      serverSHA256: req("REHEARSAL_DATABASE_SERVER_SHA256"),
    }),
    max: 1,
  });
  const x = (
    await pool.query(
      `select current_database() db,current_user role,(select count(*)::int from public."User") users,(select count(*)::int from public."Session") sessions,(select count(*)::int from pg_class c join pg_namespace n on n.oid=c.relnamespace where n.nspname='public' and c.relkind in ('r','p')) tables,to_regclass('public."SharedAuthIdentity"') is not null identity_present`,
    )
  ).rows[0];
  if (
    x.db !== req("REHEARSAL_LEGACY_DATABASE_NAME") ||
    x.role !== req("REHEARSAL_DATABASE_OWNER_ROLE") ||
    x.users !== Number(req("ACCOUNTS_IMPORT_EXPECTED_COUNT")) ||
    x.sessions !== Number(req("ACCOUNTS_REAL_EXPECTED_SESSIONS")) ||
    x.tables !== Number(req("ACCOUNTS_REAL_EXPECTED_TABLES")) ||
    x.identity_present !==
      (req("AEGYO_REHEARSAL_SCHEMA_STATUS") === "additive-v1")
  )
    fail("preserved_clone_shape_mismatch");
  if (x.identity_present) {
    const state = (
      await pool.query(
        'select (select count(*)::int from "SharedAuthIdentity") mappings,(select count(*)::int from "AuthCutoverLatch") latches',
      )
    ).rows[0];
    if (state.mappings !== 0 || state.latches !== 0)
      fail("preserved_clone_shared_auth_not_empty");
  }
  console.info("preserved_clone_shape_valid=true");
} catch (e) {
  console.error(
    /^[a-z_]+$/.test(e?.message ?? "")
      ? e.message
      : "preserved_clone_check_failed",
  );
  process.exitCode = 1;
} finally {
  await pool?.end();
}
