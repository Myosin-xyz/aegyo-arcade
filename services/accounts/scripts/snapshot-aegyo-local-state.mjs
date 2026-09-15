#!/usr/bin/env node
import "./check-runtime.mjs";
import { createHash } from "node:crypto";
import { open } from "node:fs/promises";
import pg from "pg";
import { databaseOptions } from "../src/database-options.mjs";
const fail = (c) => {
  throw new Error(c);
};
const req = (n) => process.env[n] || fail(`missing_${n}`);
const links = [
  { table: "Session", owner: "userId", label: "Session" },
  { table: "Favorite", owner: "userId", label: "Favorite" },
  { table: "Comment", owner: "userId", label: "Comment" },
  { table: "SuggestedEdit", owner: "userId", label: "SuggestedEdit" },
  { table: "SlangVote", owner: "userId", label: "SlangVote" },
  { table: "Follow", owner: "followerId", label: "Follow" },
];
const additiveSessionColumns = [
  "providerSessionId",
  "authenticatedAt",
  "providerCheckedAt",
  "securityVersion",
  "passwordResetAt",
];
const digest = (rows) =>
  createHash("sha256")
    .update(rows.map((row) => row.record_json).join("\n"))
    .digest("hex");
const assertTable = async (pool, table, requiredColumns) => {
  const relation = (
    await pool.query(
      `select c.relkind from pg_class c join pg_namespace n on n.oid=c.relnamespace
       where n.nspname=$1 and c.relname=$2`,
      ["public", table],
    )
  ).rows;
  if (relation.length !== 1 || !["r", "p"].includes(relation[0].relkind))
    fail("linked_table_missing_or_ambiguous");
  const columns = new Set(
    (
      await pool.query(
        "select column_name from information_schema.columns where table_schema=$1 and table_name=$2",
        ["public", table],
      )
    ).rows.map((row) => row.column_name),
  );
  if (requiredColumns.some((column) => !columns.has(column)))
    fail("linked_table_shape_mismatch");
};
let pool;
let client;
let transactionOpen = false;
try {
  const connectionString = req("REHEARSAL_LEGACY_OWNER_DATABASE_URL");
  const proofSocket = process.env.ACCOUNTS_PROOF_PG_SOCKET;
  const connectionURL = new URL(connectionString);
  if (
    proofSocket !== undefined &&
    (!/^\/tmp\/aegyo-idp-proof-[A-Za-z0-9]+$/.test(proofSocket) ||
      connectionURL.hostname !== "localhost" ||
      connectionURL.searchParams.get("host") !== proofSocket)
  )
    fail("invalid_local_proof_socket");
  pool = new pg.Pool({
    ...databaseOptions(
      connectionString,
      proofSocket
        ? {}
        : {
            caCertificate: req("REHEARSAL_DATABASE_CA_CERT"),
            serverSHA256: req("REHEARSAL_DATABASE_SERVER_SHA256"),
          },
    ),
    max: 1,
  });
  client = await pool.connect();
  await client.query("BEGIN ISOLATION LEVEL REPEATABLE READ READ ONLY");
  transactionOpen = true;
  const db = (await client.query("select current_database() name")).rows[0]
    ?.name;
  if (db !== req("REHEARSAL_LEGACY_DATABASE_NAME"))
    fail("database_name_mismatch");
  const users = (
    await client.query('select id, role from "User" order by id')
  ).rows.map((x) => ({
    ...x,
    linkedRecords: {},
    linkedRecordDigests: {},
  }));
  const byId = new Map(users.map((x) => [x.id, x]));
  const schemaProbe = (
    await client.query(
      `select
        to_regclass('public."SharedAuthIdentity"') is not null identity_table,
        to_regclass('public."AuthCutoverLatch"') is not null latch_table,
        count(*) filter
          (where column_name = any($1::text[]))::int session_column_count
       from information_schema.columns
       where table_schema='public' and table_name='Session'`,
      [additiveSessionColumns],
    )
  ).rows[0];
  const installedColumnCount = schemaProbe.session_column_count;
  const legacySchema =
    !schemaProbe.identity_table &&
    !schemaProbe.latch_table &&
    installedColumnCount === 0;
  const additiveSchema =
    schemaProbe.identity_table &&
    schemaProbe.latch_table &&
    installedColumnCount === additiveSessionColumns.length;
  if (!legacySchema && !additiveSchema)
    fail(
      `shared_auth_schema_partial_i${Number(schemaProbe.identity_table)}_l${Number(schemaProbe.latch_table)}_c${installedColumnCount}`,
    );
  const schemaStatus = legacySchema ? "legacy" : "additive-v1";
  let sharedAuthMappings = 0;
  let cutoverLatches = 0;
  if (additiveSchema) {
    const populatedSessionMetadata = Number(
      (
        await client.query(
          `select count(*) count from "Session" where
             "providerSessionId" is not null or "authenticatedAt" is not null or
             "providerCheckedAt" is not null or "securityVersion" is not null or
             "passwordResetAt" is not null`,
        )
      ).rows[0].count,
    );
    if (populatedSessionMetadata !== 0)
      fail("shared_auth_session_metadata_not_empty");
    sharedAuthMappings = Number(
      (await client.query('select count(*) count from "SharedAuthIdentity"'))
        .rows[0].count,
    );
    cutoverLatches = Number(
      (await client.query('select count(*) count from "AuthCutoverLatch"'))
        .rows[0].count,
    );
  }
  for (const { table, owner, label } of links) {
    await assertTable(client, table, ["id", owner]);
    const rowJson =
      table === "Session"
        ? `to_jsonb(t) - ARRAY['providerSessionId','authenticatedAt','providerCheckedAt','securityVersion','passwordResetAt']`
        : "to_jsonb(t)";
    const rows = (
      await client.query(
        `select id, "${owner}" user_id, (${rowJson})::text record_json from "${table}" t order by id`,
      )
    ).rows;
    const ownedRows = new Map();
    for (const row of rows) {
      const user = byId.get(row.user_id);
      if (!user) fail("orphan_linked_record");
      (user.linkedRecords[label] ??= []).push(row.id);
      (
        ownedRows.get(row.user_id) ??
        ownedRows.set(row.user_id, []).get(row.user_id)
      ).push(row);
    }
    for (const user of users) {
      const records = ownedRows.get(user.id) ?? [];
      user.linkedRecords[label] ??= [];
      user.linkedRecordDigests[label] = digest(records);
    }
  }
  await assertTable(client, "PollVote", [
    "id",
    "voterRef",
    "voterType",
    "pollSlug",
    "option",
  ]);
  const pollRows = (
    await client.query(
      `select id, "voterRef" voter_ref, "voterType" voter_type,
              to_jsonb(t)::text record_json
       from "PollVote" t order by id`,
    )
  ).rows;
  const anonymousPollRows = [];
  const profilePollRows = new Map();
  for (const row of pollRows) {
    if (row.voter_type === "device") {
      anonymousPollRows.push(row);
      continue;
    }
    if (row.voter_type !== "profile") fail("poll_voter_type_unknown");
    const user = byId.get(row.voter_ref);
    if (!user) fail("orphan_profile_poll_vote");
    (user.linkedRecords.PollVote ??= []).push(row.id);
    (
      profilePollRows.get(row.voter_ref) ??
      profilePollRows.set(row.voter_ref, []).get(row.voter_ref)
    ).push(row);
  }
  for (const user of users) {
    user.linkedRecords.PollVote ??= [];
    user.linkedRecordDigests.PollVote = digest(
      profilePollRows.get(user.id) ?? [],
    );
  }
  const anonymousPollVotes = {
    ids: anonymousPollRows.map((row) => row.id),
    recordsDigest: digest(anonymousPollRows),
  };
  await client.query("ROLLBACK");
  transactionOpen = false;
  const f = await open(req("ACCOUNTS_REAL_LOCAL_STATE_OUTPUT"), "wx", 0o600);
  try {
    await f.writeFile(
      JSON.stringify({
        version: 1,
        evidenceVersion: 2,
        schemaStatus,
        sharedAuthMappings,
        cutoverLatches,
        users,
        anonymousPollVotes,
      }) + "\n",
    );
  } finally {
    await f.close();
  }
  console.info(
    JSON.stringify({
      users: users.length,
      linkedTables: [
        ...new Set([...links.map((x) => x.table), "PollVote"]),
      ].filter((t) =>
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
    /^[a-z0-9_]+$/.test(e?.message ?? "") ? e.message : "local_state_failed",
  );
  process.exitCode = 1;
} finally {
  if (transactionOpen) await client?.query("ROLLBACK").catch(() => {});
  client?.release();
  await pool?.end();
}
