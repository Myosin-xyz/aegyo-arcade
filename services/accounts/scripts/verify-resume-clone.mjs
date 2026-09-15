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
      `select current_database() db,current_user role,(select count(*)::int from public."User") users,(select count(*)::int from public."Session") sessions,(select count(*)::int from pg_class c join pg_namespace n on n.oid=c.relnamespace where n.nspname='public' and c.relkind in ('r','p')) tables,to_regclass('public."SharedAuthIdentity"') is null identity_absent`,
    )
  ).rows[0];
  if (
    x.db !== req("REHEARSAL_LEGACY_DATABASE_NAME") ||
    x.role !== req("REHEARSAL_DATABASE_OWNER_ROLE") ||
    x.users !== Number(req("ACCOUNTS_IMPORT_EXPECTED_COUNT")) ||
    x.sessions !== Number(req("ACCOUNTS_REAL_EXPECTED_SESSIONS")) ||
    x.tables !== Number(req("ACCOUNTS_REAL_EXPECTED_TABLES")) ||
    !x.identity_absent
  )
    fail("preserved_clone_shape_mismatch");
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
