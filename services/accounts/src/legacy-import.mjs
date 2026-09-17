import { createHash, randomUUID, timingSafeEqual } from "node:crypto";
import { LEGACY_PREFIX } from "./passwords.mjs";

export class ImportRefusal extends Error {}
export const MAX_IMPORT_ARTIFACT_BYTES = 16 * 1024 * 1024;
const refuse = (code) => {
  throw new ImportRefusal(code);
};
export function serializeImportArtifact(data) {
  const serialized = JSON.stringify(data) + "\n";
  if (Buffer.byteLength(serialized, "utf8") > MAX_IMPORT_ARTIFACT_BYTES)
    refuse("import_artifact_too_large");
  return serialized;
}
const digest = (value) =>
  createHash("sha256").update(JSON.stringify(value)).digest("hex");
const text = (value, limit = 500) =>
  typeof value === "string" &&
  value.length > 0 &&
  value.length <= limit &&
  !/[\u0000-\u001f]/u.test(value);

// Only these credential fields enter Accounts. Roles and all application data
// remain in Aegyo; their preservation is checked by the separate reconciler.
export function validateSnapshot(input) {
  if (
    input?.version !== 1 ||
    input?.source !== "aegyo-legacy" ||
    !text(input.sourceNamespace, 200) ||
    !text(input.sourceDatabase, 200) ||
    !Array.isArray(input.users) ||
    input.users.length < 1 ||
    input.users.length > 100000 ||
    input.count !== input.users.length
  )
    refuse("invalid_snapshot");
  let issuer;
  try {
    issuer = new URL(input.issuer);
  } catch {
    refuse("invalid_issuer");
  }
  if (
    issuer.protocol !== "https:" ||
    issuer.username ||
    issuer.password ||
    issuer.search ||
    issuer.hash ||
    `${issuer.origin}/api/auth` !== input.issuer
  )
    refuse("invalid_issuer");
  const ids = new Set();
  const emails = new Set();
  const users = input.users
    .map((row) => {
      if (
        !text(row?.id, 200) ||
        !text(row.email, 320) ||
        !/^[^\s@]+@[^\s@]+$/.test(row.email.trim()) ||
        !(
          row.name === null ||
          (typeof row.name === "string" && row.name.length <= 500)
        ) ||
        typeof row.emailVerified !== "boolean" ||
        !/^[a-f0-9]{64}$/.test(row.passwordHash ?? "") ||
        typeof row.createdAt !== "string" ||
        !Number.isFinite(Date.parse(row.createdAt))
      )
        refuse("invalid_source_user");
      const email = row.email.trim().toLowerCase();
      if (ids.has(row.id) || emails.has(email))
        refuse("duplicate_source_identity");
      ids.add(row.id);
      emails.add(email);
      return {
        id: row.id,
        email,
        name: row.name,
        emailVerified: row.emailVerified,
        passwordHash: row.passwordHash,
        createdAt: new Date(row.createdAt).toISOString(),
      };
    })
    .sort((a, b) => (a.id < b.id ? -1 : a.id > b.id ? 1 : 0));
  const snapshot = {
    version: 1,
    source: "aegyo-legacy",
    sourceNamespace: input.sourceNamespace,
    sourceDatabase: input.sourceDatabase,
    issuer: input.issuer,
    count: users.length,
    users,
  };
  serializeImportArtifact(snapshot);
  return { snapshot, snapshotDigest: digest(snapshot) };
}

/** Caller supplies a dedicated source connection. This never writes the source. */
export async function captureLegacySnapshot(
  client,
  { sourceNamespace, sourceDatabase, issuer },
) {
  await client.query("BEGIN ISOLATION LEVEL REPEATABLE READ READ ONLY");
  try {
    await client.query("SET LOCAL statement_timeout = '30s'");
    await client.query("SET LOCAL lock_timeout = '5s'");
    const actual = (await client.query("SELECT current_database() AS name"))
      .rows[0]?.name;
    if (actual !== sourceDatabase) refuse("source_database_mismatch");
    const rows = (
      await client.query(`SELECT id, email, "displayName" AS name,
      "emailVerified", "passwordHash", "createdAt" FROM public."User" ORDER BY id`)
    ).rows;
    const result = validateSnapshot({
      version: 1,
      source: "aegyo-legacy",
      sourceNamespace,
      sourceDatabase,
      issuer,
      count: rows.length,
      users: rows.map((row) => ({
        ...row,
        createdAt: row.createdAt.toISOString(),
      })),
    });
    await client.query("ROLLBACK");
    return result;
  } catch (error) {
    await client.query("ROLLBACK").catch(() => {});
    throw error;
  }
}

// Operator-only schema: deliberately outside the provider's public schema
// inventory. Installing it is explicit, never part of the runtime startup.
export async function installImportJournal(client, appRole) {
  if (!text(appRole, 63)) refuse("invalid_runtime_role");
  await client.query("BEGIN");
  try {
    await client.query("SET LOCAL lock_timeout = '5s'");
    await client.query(
      "SELECT pg_advisory_xact_lock(hashtext('aegyo-import-v1'))",
    );
    if (
      !(
        await client.query(
          "SELECT to_regclass('public.aegyo_schema_version') AS marker",
        )
      ).rows[0]?.marker
    )
      refuse("accounts_schema_missing");
    const marker = await client.query(
      "SELECT version FROM public.aegyo_schema_version",
    );
    if (marker.rowCount !== 1 || marker.rows[0].version !== 1)
      refuse("accounts_schema_version_unsupported");
    const role = (
      await client.query(
        `SELECT rolname FROM pg_roles WHERE rolname=$1 AND NOT rolsuper AND NOT rolcreaterole AND NOT rolbypassrls`,
        [appRole],
      )
    ).rows[0];
    if (!role) refuse("invalid_runtime_role");
    if (
      (await client.query("SELECT to_regnamespace('aegyo_import') AS schema"))
        .rows[0]?.schema
    )
      refuse("journal_already_exists_inspect_before_use");
    await client.query(`CREATE SCHEMA aegyo_import;
      REVOKE ALL ON SCHEMA aegyo_import FROM PUBLIC;
      CREATE TABLE aegyo_import.batches (
        source_namespace text PRIMARY KEY,
        source_database text NOT NULL,
        issuer text NOT NULL,
        snapshot_digest text NOT NULL CHECK (snapshot_digest ~ '^[a-f0-9]{64}$'),
        user_count integer NOT NULL CHECK (user_count > 0),
        created_at timestamptz NOT NULL DEFAULT clock_timestamp()
      );
      CREATE TABLE aegyo_import.identities (
        source_namespace text NOT NULL REFERENCES aegyo_import.batches(source_namespace),
        local_user_id text NOT NULL,
        subject text UNIQUE NOT NULL REFERENCES public."user"(id) ON DELETE RESTRICT,
        credential_id text UNIQUE NOT NULL REFERENCES public."account"(id) ON DELETE RESTRICT,
        PRIMARY KEY (source_namespace, local_user_id)
      );
      REVOKE ALL ON ALL TABLES IN SCHEMA aegyo_import FROM PUBLIC;`);
    if (
      (
        await client.query(
          "SELECT has_schema_privilege($1, 'aegyo_import', 'USAGE') AS access",
          [appRole],
        )
      ).rows[0]?.access
    )
      refuse("runtime_can_access_import_journal");
    await client.query("COMMIT");
  } catch (error) {
    await client.query("ROLLBACK").catch(() => {});
    throw error;
  }
}

async function existingBatch(client, snapshot, snapshotDigest) {
  const batch = (
    await client.query(
      "SELECT * FROM aegyo_import.batches WHERE source_namespace=$1",
      [snapshot.sourceNamespace],
    )
  ).rows[0];
  if (!batch) return null;
  if (
    batch.snapshot_digest !== snapshotDigest ||
    batch.issuer !== snapshot.issuer ||
    batch.source_database !== snapshot.sourceDatabase ||
    batch.user_count !== snapshot.count
  )
    refuse("source_changed_after_import");
  const rows = (
    await client.query(
      `SELECT i.local_user_id AS "localUserId", i.subject,
      a."userId" AS owner, a."providerId" AS provider, a."accountId" AS account
    FROM aegyo_import.identities i JOIN public."account" a ON a.id=i.credential_id
    JOIN public."user" u ON u.id=i.subject
    WHERE i.source_namespace=$1 ORDER BY i.local_user_id`,
      [snapshot.sourceNamespace],
    )
  ).rows;
  const actualIds = new Set(rows.map((row) => row.localUserId));
  if (
    rows.length !== snapshot.count ||
    snapshot.users.some((row) => !actualIds.has(row.id)) ||
    rows.some(
      (row) =>
        row.owner !== row.subject ||
        row.account !== row.subject ||
        row.provider !== "credential",
    )
  )
    refuse("import_journal_integrity_failure");
  return rows.map(({ localUserId, subject }) => ({ localUserId, subject }));
}

export async function inspectImport(client, input, expectedDigest) {
  const { snapshot, snapshotDigest } = validateSnapshot(input);
  if (snapshotDigest !== expectedDigest) refuse("snapshot_digest_mismatch");
  return existingBatch(client, snapshot, snapshotDigest);
}

export function verifyCredentialProof(snapshot, proof) {
  if (
    !text(proof?.legacyPepper, 10000) ||
    !text(proof?.sourceUserId, 200) ||
    typeof proof?.password !== "string" ||
    proof.password.length < 1 ||
    proof.password.length > 10000 ||
    !/^[a-f0-9]{64}$/.test(proof?.deployedPepperDigest ?? "")
  )
    refuse("credential_proof_required");
  const pepperDigest = createHash("sha256")
    .update(proof.legacyPepper, "utf8")
    .digest();
  if (
    !timingSafeEqual(
      pepperDigest,
      Buffer.from(proof.deployedPepperDigest, "hex"),
    )
  )
    refuse("deployed_pepper_mismatch");
  const user = snapshot.users.find((row) => row.id === proof.sourceUserId);
  const expectedHash = createHash("sha256")
    .update(proof.password + proof.legacyPepper, "utf8")
    .digest();
  if (
    !user ||
    !timingSafeEqual(expectedHash, Buffer.from(user.passwordHash, "hex"))
  )
    refuse("legacy_canary_password_mismatch");
}

/** Atomic target insert. An identical retry reads the journal, never credentials.
 * Source credential writers and target public traffic MUST be frozen externally;
 * no database transaction can manufacture that cross-service guarantee.
 */
export async function applyLegacySnapshot(
  client,
  input,
  expectedDigest,
  credentialProof,
) {
  const { snapshot, snapshotDigest } = validateSnapshot(input);
  if (snapshotDigest !== expectedDigest) refuse("snapshot_digest_mismatch");
  verifyCredentialProof(snapshot, credentialProof);
  await client.query("BEGIN");
  let committing = false;
  try {
    await client.query("SET LOCAL statement_timeout = '30s'");
    await client.query("SET LOCAL lock_timeout = '5s'");
    await client.query(
      "SELECT pg_advisory_xact_lock(hashtext('aegyo-import-v1'))",
    );
    await client.query(
      'LOCK TABLE public."user", public."account", aegyo_import.batches, aegyo_import.identities IN SHARE ROW EXCLUSIVE MODE',
    );
    const previous = await existingBatch(client, snapshot, snapshotDigest);
    if (previous) {
      await client.query("ROLLBACK");
      return { alreadyCommitted: true, pairs: previous };
    }
    // One complete Aegyo population per Accounts database. Changing a namespace
    // must never be a way to bypass the one-time import guard.
    if (
      (await client.query("SELECT 1 FROM aegyo_import.batches LIMIT 1"))
        .rowCount
    )
      refuse("different_source_already_imported");
    const collision = await client.query(
      'SELECT 1 FROM public."user" WHERE lower(btrim(email))=ANY($1::text[]) LIMIT 1',
      [snapshot.users.map((row) => row.email)],
    );
    if (collision.rowCount) refuse("email_collision_requires_review");
    await client.query(
      `INSERT INTO aegyo_import.batches
      (source_namespace, source_database, issuer, snapshot_digest, user_count) VALUES ($1,$2,$3,$4,$5)`,
      [
        snapshot.sourceNamespace,
        snapshot.sourceDatabase,
        snapshot.issuer,
        snapshotDigest,
        snapshot.count,
      ],
    );
    const pairs = [];
    for (const row of snapshot.users) {
      const subject = randomUUID();
      const credentialId = randomUUID();
      await client.query(
        `INSERT INTO public."user"
        (id, name, email, "emailVerified", "createdAt", "updatedAt", role, "credentialVersion", "securityVersion")
        VALUES ($1,$2,$3,$4,$5,$5,'user',0,0)`,
        [
          subject,
          row.name || "Aegyo member",
          row.email,
          row.emailVerified,
          row.createdAt,
        ],
      );
      await client.query(
        `INSERT INTO public."account"
        (id, "accountId", "providerId", "userId", password, "createdAt", "updatedAt")
        VALUES ($1,$2,'credential',$2,$3,$4,$4)`,
        [
          credentialId,
          subject,
          LEGACY_PREFIX + row.passwordHash,
          row.createdAt,
        ],
      );
      await client.query(
        `INSERT INTO aegyo_import.identities
        (source_namespace, local_user_id, subject, credential_id) VALUES ($1,$2,$3,$4)`,
        [snapshot.sourceNamespace, row.id, subject, credentialId],
      );
      pairs.push({ localUserId: row.id, subject });
    }
    committing = true;
    await client.query("COMMIT");
    return { alreadyCommitted: false, pairs };
  } catch (error) {
    await client.query("ROLLBACK").catch(() => {});
    if (committing) refuse("commit_outcome_unknown_inspect_journal");
    throw error;
  }
}
