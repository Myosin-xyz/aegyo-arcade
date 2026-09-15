#!/usr/bin/env node
import "./check-runtime.mjs";
import { open } from "node:fs/promises";
import pg from "pg";
import { databaseOptions } from "../src/database-options.mjs";
const fail = (c) => {
  throw new Error(c);
};
const req = (n) => process.env[n] || fail(`missing_${n}`);
const links = [
  ["Session", "userId", "Session"],
  ["Favorite", "userId", "Favorite"],
  ["Comment", "userId", "Comment"],
  ["SuggestedEdit", "userId", "SuggestedEdit"],
  ["SlangVote", "userId", "SlangVote"],
  ["PollVote", "userId", "PollVote"],
  ["Follow", "followerId", "Follow:follower"],
  ["Follow", "followingId", "Follow:following"],
];
let pool;
try {
  pool = new pg.Pool({
    ...databaseOptions(req("REHEARSAL_LEGACY_OWNER_DATABASE_URL"), {
      caCertificate: req("REHEARSAL_DATABASE_CA_CERT"),
      serverSHA256: req("REHEARSAL_DATABASE_SERVER_SHA256"),
    }),
    max: 1,
  });
  const db = (await pool.query("select current_database() name")).rows[0]?.name;
  if (db !== req("REHEARSAL_LEGACY_DATABASE_NAME"))
    fail("database_name_mismatch");
  const users = (
    await pool.query('select id, role from "User" order by id')
  ).rows.map((x) => ({ ...x, linkedRecords: {} }));
  const byId = new Map(users.map((x) => [x.id, x]));
  for (const [table, column, label] of links) {
    const exists = (
      await pool.query("select to_regclass($1) is not null ok", [
        `public.${table}`,
      ])
    ).rows[0].ok;
    if (!exists) continue;
    const cols = (
      await pool.query(
        "select column_name from information_schema.columns where table_schema=$1 and table_name=$2",
        ["public", table],
      )
    ).rows.map((x) => x.column_name);
    if (!cols.includes("id") || !cols.includes(column))
      fail("linked_table_shape_mismatch");
    const rows = (
      await pool.query(
        `select id, "${column}" user_id from "${table}" order by id`,
      )
    ).rows;
    for (const row of rows) {
      const user = byId.get(row.user_id);
      if (!user) fail("orphan_linked_record");
      (user.linkedRecords[label] ??= []).push(row.id);
    }
  }
  const f = await open(req("ACCOUNTS_REAL_LOCAL_STATE_OUTPUT"), "wx", 0o600);
  try {
    await f.writeFile(JSON.stringify({ version: 1, users }) + "\n");
  } finally {
    await f.close();
  }
  console.info(
    JSON.stringify({
      users: users.length,
      linkedTables: [...new Set(links.map((x) => x[0]))].filter((t) =>
        users.some((u) =>
          Object.keys(u.linkedRecords).some(
            (k) => k === t || k.startsWith(t + ":"),
          ),
        ),
      ).length,
    }),
  );
} catch (e) {
  console.error(
    /^[a-z_]+$/.test(e?.message ?? "") ? e.message : "local_state_failed",
  );
  process.exitCode = 1;
} finally {
  await pool?.end();
}
