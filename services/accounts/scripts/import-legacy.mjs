import "./check-runtime.mjs";
import { constants } from "node:fs";
import { open, realpath } from "node:fs/promises";
import { dirname, relative, resolve } from "node:path";
import { fileURLToPath } from "node:url";
import pg from "pg";
import { databaseOptions } from "../src/database-options.mjs";
import {
  ImportRefusal,
  validateSnapshot,
  captureLegacySnapshot,
  installImportJournal,
  applyLegacySnapshot,
  inspectImport,
  MAX_IMPORT_ARTIFACT_BYTES,
  serializeImportArtifact,
} from "../src/legacy-import.mjs";

const fail = (code) => {
  throw new ImportRefusal(code);
};
const required = (key) => process.env[key] || fail(`missing_${key}`);
const pools = [];
const clients = [];
const root = fileURLToPath(new URL("../.proof", import.meta.url));

async function privatePath(value) {
  const path = resolve(value);
  const parent = await realpath(dirname(path));
  const rel = relative(await realpath(root), parent);
  if (rel.startsWith("..") || rel.startsWith("/"))
    fail("file_outside_private_proof_directory");
  return path;
}
async function readPrivate(value) {
  const file = await open(
    await privatePath(value),
    constants.O_RDONLY | constants.O_NOFOLLOW,
  );
  try {
    const stat = await file.stat();
    if (
      !stat.isFile() ||
      stat.mode & 0o077 ||
      stat.uid !== process.getuid() ||
      stat.size > MAX_IMPORT_ARTIFACT_BYTES
    )
      fail("unsafe_input_file");
    return JSON.parse(await file.readFile("utf8"));
  } finally {
    await file.close();
  }
}
async function writePrivate(value, data) {
  const serialized = serializeImportArtifact(data);
  const file = await open(await privatePath(value), "wx", 0o600);
  try {
    await file.writeFile(serialized);
    await file.sync();
  } finally {
    await file.close();
  }
}
async function connect(prefix) {
  const pool = new pg.Pool({
    ...databaseOptions(required(`${prefix}_DATABASE_URL`), {
      caCertificate: process.env[`${prefix}_DATABASE_CA_CERT`],
      serverSHA256: process.env[`${prefix}_DATABASE_SERVER_SHA256`],
    }),
    max: 1,
    connectionTimeoutMillis: 5000,
    statement_timeout: 30000,
    application_name: "aegyo-legacy-import-operator",
  });
  pools.push(pool);
  const client = await pool.connect();
  clients.push(client);
  const name = (await client.query("SELECT current_database() AS name")).rows[0]
    ?.name;
  if (name !== required(`${prefix}_DATABASE_NAME`))
    fail("database_name_mismatch");
  return client;
}
async function sourceSnapshot() {
  const source = await connect("ACCOUNTS_IMPORT_SOURCE");
  return captureLegacySnapshot(source, {
    sourceNamespace: required("ACCOUNTS_IMPORT_SOURCE_NAMESPACE"),
    sourceDatabase: required("ACCOUNTS_IMPORT_SOURCE_DATABASE_NAME"),
    issuer: required("ACCOUNTS_IMPORT_ISSUER"),
  });
}
try {
  if (process.env.DATABASE_URL) fail("ordinary_DATABASE_URL_forbidden");
  const command = process.argv[2];
  if (!["snapshot", "init-journal", "apply", "status"].includes(command))
    fail("expected_snapshot_init-journal_apply_or_status");
  if (command === "snapshot") {
    if (
      required("ACCOUNTS_IMPORT_CONFIRM") !==
      "read-only-private-source-snapshot"
    )
      fail("snapshot_confirmation_missing");
    const result = await sourceSnapshot();
    if (
      result.snapshot.count !==
      Number(required("ACCOUNTS_IMPORT_EXPECTED_COUNT"))
    )
      fail("population_count_mismatch");
    await writePrivate(required("ACCOUNTS_IMPORT_OUTPUT"), result.snapshot);
    console.info(
      JSON.stringify({
        count: result.snapshot.count,
        snapshotDigest: result.snapshotDigest,
      }),
    );
  } else {
    const target = await connect("ACCOUNTS_IMPORT_TARGET");
    if (command === "init-journal") {
      if (
        required("ACCOUNTS_IMPORT_CONFIRM") !== "install-operator-only-journal"
      )
        fail("journal_confirmation_missing");
      await installImportJournal(target, required("ACCOUNTS_DATABASE_ROLE"));
      console.info("Installed operator-only import journal.");
    } else {
      const { snapshot, snapshotDigest } = validateSnapshot(
        await readPrivate(required("ACCOUNTS_IMPORT_INPUT")),
      );
      if (
        snapshotDigest !== required("ACCOUNTS_IMPORT_APPROVED_DIGEST") ||
        snapshot.issuer !== required("ACCOUNTS_IMPORT_ISSUER") ||
        snapshot.sourceNamespace !==
          required("ACCOUNTS_IMPORT_SOURCE_NAMESPACE")
      )
        fail("approved_snapshot_mismatch");
      let result;
      if (command === "apply") {
        if (
          required("ACCOUNTS_IMPORT_CONFIRM") !==
          "source-writers-and-target-traffic-frozen"
        )
          fail("freeze_confirmation_missing");
        // Re-read the complete source immediately before importing. This detects
        // drift; the separately audited application freeze still must stay on.
        const fresh = await sourceSnapshot();
        if (fresh.snapshotDigest !== snapshotDigest)
          fail("source_changed_since_snapshot");
        const credentialProof = await readPrivate(
          required("ACCOUNTS_IMPORT_CREDENTIAL_PROOF"),
        );
        result = await applyLegacySnapshot(target, snapshot, snapshotDigest, {
          sourceUserId: credentialProof.sourceUserId,
          password: credentialProof.password,
          deployedPepperDigest: credentialProof.deployedPepperDigest,
          legacyPepper: required("ACCOUNTS_LEGACY_PEPPER"),
        });
      } else {
        const pairs = await inspectImport(target, snapshot, snapshotDigest);
        if (!pairs) fail("batch_not_committed");
        result = { alreadyCommitted: true, pairs };
      }
      // No email or credential hashes in these reconciliation inputs. If writing
      // fails after commit, use status with a NEW output path; never undo users.
      await writePrivate(required("ACCOUNTS_IMPORT_OUTPUT"), {
        version: 1,
        issuer: snapshot.issuer,
        sourceNamespace: snapshot.sourceNamespace,
        snapshotDigest,
        mapping: { version: 1, pairs: result.pairs },
        accounts: {
          version: 1,
          issuer: snapshot.issuer,
          subjects: result.pairs.map((pair) => pair.subject),
        },
      });
      console.info(
        JSON.stringify({
          count: result.pairs.length,
          alreadyCommitted: result.alreadyCommitted,
        }),
      );
    }
  }
} catch (error) {
  console.error(
    error instanceof ImportRefusal
      ? error.message
      : "Import operation failed; inspect the journal before retrying. No source or provider error details are logged.",
  );
  process.exitCode = 1;
} finally {
  for (const client of clients) client.release();
  await Promise.allSettled(pools.map((pool) => pool.end()));
}
