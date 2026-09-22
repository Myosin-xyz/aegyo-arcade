import { createHash, randomUUID } from "node:crypto";
import {
  PRODUCTION,
  ProductionCutoverRefusal,
  augmentManifestWithOwnership,
  preservationDigest,
} from "./production-cutover-lib.mjs";

const refuse = (code) => {
  throw new ProductionCutoverRefusal(code);
};
const quoteIdentifier = (value) => `"${value.replaceAll('"', '""')}"`;

async function transaction(client, readOnly, operation) {
  await client.query(
    `BEGIN ISOLATION LEVEL REPEATABLE READ${readOnly ? " READ ONLY" : ""}`,
  );
  try {
    await client.query("SET LOCAL statement_timeout = '300s'");
    await client.query("SET LOCAL lock_timeout = '5s'");
    const result = await operation();
    await client.query("ROLLBACK");
    return result;
  } catch (error) {
    await client.query("ROLLBACK").catch(() => {});
    throw error;
  }
}

export async function verifyProductionConnections(
  sourceReader,
  sourceOwner,
  accountsOwner,
  config,
) {
  const sourceReaderIdentity = (
    await sourceReader.query(`SELECT current_database() AS database,
      current_user AS role, current_setting('transaction_read_only') AS read_only`)
  ).rows[0];
  const sourceRole = (
    await sourceReader.query(`SELECT rolsuper, rolcreatedb, rolcreaterole,
      rolbypassrls, coalesce(rolconfig @> ARRAY['default_transaction_read_only=on'], false) AS durable_read_only
      FROM pg_roles WHERE rolname=current_user`)
  ).rows[0];
  const sourceOwnerIdentity = (
    await sourceOwner.query(
      "SELECT current_database() AS database, current_user AS role",
    )
  ).rows[0];
  const accountsOwnerIdentity = (
    await accountsOwner.query(
      "SELECT current_database() AS database, current_user AS role",
    )
  ).rows[0];
  if (
    sourceReaderIdentity?.database !== PRODUCTION.sourceDatabase ||
    sourceReaderIdentity.role !== config.sourceReadOnlyRole ||
    sourceReaderIdentity.read_only !== "on" ||
    !sourceRole?.durable_read_only ||
    sourceRole.rolsuper ||
    sourceRole.rolcreatedb ||
    sourceRole.rolcreaterole ||
    sourceRole.rolbypassrls
  )
    refuse("source_reader_identity_or_privileges_invalid");
  if (
    sourceOwnerIdentity?.database !== PRODUCTION.sourceDatabase ||
    sourceOwnerIdentity.role !== config.sourceOwnerRole
  )
    refuse("source_owner_identity_invalid");
  if (
    accountsOwnerIdentity?.database !== PRODUCTION.accountsDatabase ||
    accountsOwnerIdentity.role !== config.accountsOwnerRole
  )
    refuse("accounts_owner_identity_invalid");
  return true;
}

export async function inspectAegyoProduction(client, expectedTables) {
  return transaction(client, true, async () => {
    const tables = Number(
      (
        await client.query(`SELECT count(*)::int AS count
          FROM pg_class c JOIN pg_namespace n ON n.oid=c.relnamespace
          WHERE n.nspname='public' AND c.relkind IN ('r','p')`)
      ).rows[0]?.count,
    );
    const counts = (
      await client.query(`SELECT
        (SELECT count(*)::int FROM public."User") AS users,
        (SELECT count(*)::int FROM public."Session") AS sessions,
        (SELECT count(*)::int FROM public."SharedAuthIdentity") AS mappings,
        (SELECT count(*)::int FROM public."AuthCutoverLatch") AS latches`)
    ).rows[0];
    if (tables !== expectedTables) refuse("source_table_count_mismatch");
    if (counts.latches > 1) refuse("invalid_activation_latch_population");
    return { database: PRODUCTION.sourceDatabase, tables, ...counts };
  });
}

export async function inspectAccountsProduction(client) {
  return transaction(client, true, async () => {
    const importRelations = (
      await client.query(`SELECT to_regclass('aegyo_import.batches') AS batches,
        to_regclass('aegyo_import.identities') AS identities`)
    ).rows[0];
    if (
      Boolean(importRelations.batches) !== Boolean(importRelations.identities)
    )
      refuse("partial_import_journal_schema");
    const hasImport = Boolean(importRelations.batches);
    if (hasImport) {
      const shape = (
        await client.query(`SELECT table_name, column_name, data_type, is_nullable
          FROM information_schema.columns WHERE table_schema='aegyo_import'
          ORDER BY table_name, ordinal_position`)
      ).rows;
      const expectedShape = [
        ["batches", "source_namespace", "text", "NO"],
        ["batches", "source_database", "text", "NO"],
        ["batches", "issuer", "text", "NO"],
        ["batches", "snapshot_digest", "text", "NO"],
        ["batches", "user_count", "integer", "NO"],
        ["batches", "created_at", "timestamp with time zone", "NO"],
        ["identities", "source_namespace", "text", "NO"],
        ["identities", "local_user_id", "text", "NO"],
        ["identities", "subject", "text", "NO"],
        ["identities", "credential_id", "text", "NO"],
      ].map(([table_name, column_name, data_type, is_nullable]) => ({
        table_name,
        column_name,
        data_type,
        is_nullable,
      }));
      const access = (
        await client.query(
          `SELECT has_schema_privilege($1,'aegyo_import','USAGE') AS schema_access,
            has_table_privilege($1,'aegyo_import.batches','SELECT,INSERT,UPDATE,DELETE') AS batches_access,
            has_table_privilege($1,'aegyo_import.identities','SELECT,INSERT,UPDATE,DELETE') AS identities_access`,
          [PRODUCTION.accountsRuntimeRole],
        )
      ).rows[0];
      if (
        JSON.stringify(shape) !== JSON.stringify(expectedShape) ||
        access?.schema_access ||
        access?.batches_access ||
        access?.identities_access
      )
        refuse("invalid_import_journal_shape_or_privileges");
    }
    const marker = await client.query(
      "SELECT version, guard_revision FROM public.aegyo_schema_version",
    );
    const counts = (
      await client.query(`SELECT
        (SELECT count(*)::int FROM public."user") AS users,
        (SELECT count(*)::int FROM public."account") AS accounts,
        (SELECT count(*)::int FROM public."session") AS sessions,
        (SELECT count(*)::int FROM public."oauthAccessToken") AS access_tokens,
        (SELECT count(*)::int FROM public."oauthRefreshToken") AS refresh_tokens,
        (SELECT count(*)::int FROM public."jwks") AS jwks,
        (SELECT count(*)::int FROM public."oauthClient") AS clients`)
    ).rows[0];
    const importBatches = hasImport
      ? Number(
          (
            await client.query(
              "SELECT count(*)::int AS count FROM aegyo_import.batches",
            )
          ).rows[0]?.count,
        )
      : 0;
    return {
      database: PRODUCTION.accountsDatabase,
      schemaVersion:
        marker.rowCount === 1 ? Number(marker.rows[0].version) : null,
      guardRevision:
        marker.rowCount === 1 ? Number(marker.rows[0].guard_revision) : null,
      users: counts.users,
      accounts: counts.accounts,
      sessions: counts.sessions,
      accessTokens: counts.access_tokens,
      refreshTokens: counts.refresh_tokens,
      jwks: counts.jwks,
      clients: counts.clients,
      importJournalInstalled: hasImport,
      importBatches,
    };
  });
}

// Every public source table is fingerprinted except the two tables this
// cutover is explicitly allowed to populate. The private artifact contains
// only table names, aggregate row counts and hashes, never row contents.
export async function captureProductionPreservation(client) {
  return transaction(client, true, async () => {
    return capturePreservationRows(client);
  });
}

async function preservationTableNames(client) {
  return (
    await client.query(`SELECT c.relname AS name
      FROM pg_class c JOIN pg_namespace n ON n.oid=c.relnamespace
      WHERE n.nspname='public' AND c.relkind IN ('r','p')
        AND c.relname NOT IN ('SharedAuthIdentity','AuthCutoverLatch')
      ORDER BY c.relname`)
  ).rows.map((row) => row.name);
}

async function capturePreservationRows(client) {
  const names = await preservationTableNames(client);
  const tables = [];
  for (const name of names) {
    const relation = `public.${quoteIdentifier(name)}`;
    const row = (
      await client.query(`SELECT count(*)::int AS count,
          encode(sha256(convert_to(coalesce(string_agg(to_jsonb(t)::text, E'\\n'
            ORDER BY to_jsonb(t)::text), ''), 'UTF8')), 'hex') AS digest
          FROM ${relation} t`)
    ).rows[0];
    tables.push({
      table: `public.${name}`,
      count: Number(row.count),
      digest: row.digest,
    });
  }
  return { version: 1, database: PRODUCTION.sourceDatabase, tables };
}

export const REQUIRED_USER_OWNERSHIP_EDGES = Object.freeze([
  "AnnotationComment.userId",
  "AnnotationVote.userId",
  "AuditLog.userId",
  "Comment.userId",
  "Favorite.userId",
  "Follow.followerId",
  "KimchiRating.userId",
  "LyricAnnotation.userId",
  "PointEvent.userId",
  "Session.userId",
  "SlangVote.userId",
  "SuggestedEdit.reviewedById",
  "SuggestedEdit.userId",
]);

// These runtime-created tables predate database-level foreign keys, but their
// columns still carry Aegyo user ids. Treat them as ownership edges and verify
// both their catalog shape and their row ownership during the cutover.
export const LOGICAL_USER_OWNERSHIP_EDGES = Object.freeze([
  Object.freeze({ table: "Follow", column: "followerId" }),
  Object.freeze({ table: "SlangVote", column: "userId" }),
]);

async function captureOwnershipRows(client) {
  const foreignKeyEdges = (
    await client.query(`SELECT src.relname AS table_name, source_col.attname AS column_name
      FROM pg_constraint fk
      JOIN pg_class src ON src.oid=fk.conrelid
      JOIN pg_namespace src_ns ON src_ns.oid=src.relnamespace
      JOIN pg_class target ON target.oid=fk.confrelid
      JOIN pg_namespace target_ns ON target_ns.oid=target.relnamespace
      JOIN pg_attribute source_col ON source_col.attrelid=src.oid AND source_col.attnum=fk.conkey[1]
      JOIN pg_attribute target_col ON target_col.attrelid=target.oid AND target_col.attnum=fk.confkey[1]
      WHERE fk.contype='f' AND src_ns.nspname='public' AND target_ns.nspname='public'
        AND target.relname='User' AND target_col.attname='id'
        AND array_length(fk.conkey,1)=1 AND array_length(fk.confkey,1)=1
        AND src.relname <> 'SharedAuthIdentity'
      ORDER BY src.relname, source_col.attname`)
  ).rows.map((row) => ({ table: row.table_name, column: row.column_name }));
  const logicalEdges = (
    await client.query(`SELECT c.relname AS table_name, a.attname AS column_name
      FROM pg_class c
      JOIN pg_namespace n ON n.oid=c.relnamespace
      JOIN pg_attribute a ON a.attrelid=c.oid
      WHERE n.nspname='public' AND c.relkind IN ('r','p')
        AND a.attnum > 0 AND NOT a.attisdropped
        AND ((c.relname='Follow' AND a.attname='followerId')
          OR (c.relname='SlangVote' AND a.attname='userId'))
      ORDER BY c.relname, a.attname`)
  ).rows.map((row) => ({ table: row.table_name, column: row.column_name }));
  if (logicalEdges.length !== LOGICAL_USER_OWNERSHIP_EDGES.length)
    refuse("required_logical_user_ownership_edge_missing");
  const edges = [
    ...new Map(
      [...foreignKeyEdges, ...logicalEdges].map((edge) => [
        `${edge.table}.${edge.column}`,
        edge,
      ]),
    ).values(),
  ].sort(
    (left, right) =>
      left.table.localeCompare(right.table) ||
      left.column.localeCompare(right.column),
  );
  const edgeNames = new Set(
    edges.map((edge) => `${edge.table}.${edge.column}`),
  );
  for (const required of REQUIRED_USER_OWNERSHIP_EDGES)
    if (!edgeNames.has(required))
      refuse("required_user_ownership_edge_missing");
  const byUser = new Map();
  for (const edge of edges) {
    const table = `public.${quoteIdentifier(edge.table)}`;
    const column = quoteIdentifier(edge.column);
    const rows = (
      await client.query(`SELECT ${column} AS owner, count(*)::int AS count,
        encode(sha256(convert_to(coalesce(string_agg(to_jsonb(t)::text, E'\\n'
          ORDER BY to_jsonb(t)::text), ''), 'UTF8')), 'hex') AS digest
        FROM ${table} t WHERE ${column} IS NOT NULL GROUP BY ${column} ORDER BY ${column}`)
    ).rows;
    for (const row of rows) {
      if (!byUser.has(row.owner)) byUser.set(row.owner, []);
      byUser.get(row.owner).push({
        edge: `${edge.table}.${edge.column}`,
        count: Number(row.count),
        digest: row.digest,
      });
    }
  }
  const users = (
    await client.query('SELECT id FROM public."User" ORDER BY id')
  ).rows.map((row) => ({
    localUserId: row.id,
    digest: createHash("sha256")
      .update(JSON.stringify(byUser.get(row.id) || []))
      .digest("hex"),
  }));
  const userIds = new Set(users.map((row) => row.localUserId));
  if ([...byUser.keys()].some((id) => !userIds.has(id)))
    refuse("orphan_user_ownership_edge");
  return { version: 1, edges, users };
}

export async function captureProductionOwnership(client) {
  return transaction(client, true, () => captureOwnershipRows(client));
}

async function lockAllSourceTables(client) {
  const names = (
    await client.query(`SELECT c.relname AS name
      FROM pg_class c JOIN pg_namespace n ON n.oid=c.relnamespace
      WHERE n.nspname='public' AND c.relkind IN ('r','p') ORDER BY c.relname`)
  ).rows.map((row) => row.name);
  if (names.length !== 51) refuse("source_table_count_mismatch");
  await client.query(
    `LOCK TABLE ${names.map((name) => `public.${quoteIdentifier(name)}`).join(", ")} IN SHARE ROW EXCLUSIVE MODE`,
  );
}

async function verifyManifestPopulation(client, manifest) {
  if (!Array.isArray(manifest?.rows) || manifest.rows.length < 1)
    refuse("invalid_mapping_manifest");
  const users = (await client.query('SELECT id, role FROM public."User"')).rows;
  const expected = new Map(manifest.rows.map((row) => [row.localUserId, row]));
  if (
    users.length !== manifest.rows.length ||
    expected.size !== manifest.rows.length ||
    users.some(
      (user) =>
        !expected.has(user.id) || expected.get(user.id).role !== user.role,
    )
  )
    refuse("user_id_role_or_population_changed");
  const subjects = new Set(manifest.rows.map((row) => row.subject));
  if (subjects.size !== manifest.rows.length)
    refuse("duplicate_mapping_subject");
}

async function verifyExactMappings(client, manifest, allowMissing) {
  const rows = (
    await client.query(
      'SELECT "userId", issuer, subject FROM public."SharedAuthIdentity" ORDER BY "userId"',
    )
  ).rows;
  const expected = new Map(manifest.rows.map((row) => [row.localUserId, row]));
  if (
    rows.some((row) => {
      const value = expected.get(row.userId);
      return (
        !value || value.issuer !== row.issuer || value.subject !== row.subject
      );
    })
  )
    refuse("existing_mapping_conflict");
  if (!allowMissing && rows.length !== manifest.rows.length)
    refuse("mapping_coverage_incomplete");
  return rows;
}

export async function inspectProductionMappings(client, manifest) {
  return transaction(client, true, async () => {
    await verifyManifestPopulation(client, manifest);
    const reconstructed = augmentManifestWithOwnership(
      {
        ...manifest,
        rows: manifest.rows.map(({ ownershipDigest: _ignored, ...row }) => row),
      },
      await captureOwnershipRows(client),
    );
    if (reconstructed.mappingDigest !== manifest.mappingDigest)
      refuse("complete_ownership_reconciliation_changed");
    await verifyExactMappings(client, manifest, false);
    const latch = (
      await client.query(
        'SELECT "mappingDigest" FROM public."AuthCutoverLatch" WHERE id=$1',
        ["accounts-shared-auth-v1"],
      )
    ).rows[0];
    if (latch && latch.mappingDigest !== manifest.mappingDigest)
      refuse("latch_digest_mismatch");
    return {
      count: manifest.rows.length,
      mappingDigest: manifest.mappingDigest,
      active: Boolean(latch),
    };
  });
}

async function mappingWrite(
  client,
  manifest,
  approvedPreservationDigest,
  activate,
) {
  await client.query("BEGIN");
  let committing = false;
  try {
    await client.query("SET LOCAL statement_timeout = '300s'");
    await client.query("SET LOCAL lock_timeout = '30s'");
    await client.query(
      "SELECT pg_advisory_xact_lock(hashtext('aegyo-local-mapping-v1'))",
    );
    await lockAllSourceTables(client);
    const before = await capturePreservationRows(client);
    if (preservationDigest(before) !== approvedPreservationDigest)
      refuse("source_content_or_local_ids_changed");
    await verifyManifestPopulation(client, manifest);
    const reconstructed = augmentManifestWithOwnership(
      {
        ...manifest,
        rows: manifest.rows.map(({ ownershipDigest: _ignored, ...row }) => row),
      },
      await captureOwnershipRows(client),
    );
    if (reconstructed.mappingDigest !== manifest.mappingDigest)
      refuse("complete_ownership_reconciliation_changed");
    const existing = await verifyExactMappings(client, manifest, !activate);
    if (!activate) {
      const existingUsers = new Set(existing.map((row) => row.userId));
      for (const row of manifest.rows)
        if (!existingUsers.has(row.localUserId))
          await client.query(
            `INSERT INTO public."SharedAuthIdentity"
          (id,"userId",issuer,subject,"updatedAt") VALUES ($1,$2,$3,$4,clock_timestamp())`,
            [randomUUID(), row.localUserId, row.issuer, row.subject],
          );
      await verifyExactMappings(client, manifest, false);
    } else {
      const current = (
        await client.query(
          'SELECT "mappingDigest" FROM public."AuthCutoverLatch" WHERE id=$1',
          ["accounts-shared-auth-v1"],
        )
      ).rows[0];
      if (current && current.mappingDigest !== manifest.mappingDigest)
        refuse("latch_digest_mismatch");
      if (!current)
        await client.query(
          'INSERT INTO public."AuthCutoverLatch" (id,"mappingDigest") VALUES ($1,$2)',
          ["accounts-shared-auth-v1", manifest.mappingDigest],
        );
    }
    const after = await capturePreservationRows(client);
    if (preservationDigest(after) !== approvedPreservationDigest)
      refuse("source_content_or_local_ids_changed");
    committing = true;
    await client.query("COMMIT");
    return {
      count: manifest.rows.length,
      mappingDigest: manifest.mappingDigest,
      active: activate,
    };
  } catch (error) {
    await client.query("ROLLBACK").catch(() => {});
    if (committing) refuse("mapping_commit_outcome_unknown_run_status");
    throw error;
  }
}

export const applyProductionMappings = (client, manifest, digest) =>
  mappingWrite(client, manifest, digest, false);
export const activateProductionMappings = (client, manifest, digest) =>
  mappingWrite(client, manifest, digest, true);
