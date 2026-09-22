#!/usr/bin/env node
import "./check-runtime.mjs";
import { execFile } from "node:child_process";
import { mkdir, open, readFile, rm } from "node:fs/promises";
import { join, resolve } from "node:path";
import { setTimeout as delay } from "node:timers/promises";
import { fileURLToPath, pathToFileURL } from "node:url";
import { promisify } from "node:util";
import pg from "pg";
import { databaseOptions } from "../src/database-options.mjs";
import { productionCutoverConfig } from "./production-cutover-config.mjs";
import {
  ProductionCutoverRefusal,
  augmentManifestWithOwnership,
  assertActivationAccountsTarget,
  assertEmptyAccountsTarget,
  assertFreshSnapshot,
  assertImportedAccountsTarget,
  assertPreserved,
  classifyProductionCutoverState,
  preservationDigest,
  publicEvidence,
  sanitizedFailure,
  validateProductionCutoverConfig,
  validateRecoveryEvidence,
} from "./production-cutover-lib.mjs";
import {
  activateProductionMappings,
  applyProductionMappings,
  captureProductionPreservation,
  captureProductionOwnership,
  inspectAccountsProduction,
  inspectAegyoProduction,
  inspectProductionMappings,
  verifyProductionConnections,
} from "./production-cutover-db.mjs";

const execute = promisify(execFile);
const root = fileURLToPath(new URL("..", import.meta.url));
const aegyoRoot = resolve(
  process.env.PRODUCTION_AEGYO_OPERATOR_ROOT || "/operator/aegyo",
);
const bundlePath = resolve(
  process.env.PRODUCTION_CUTOVER_SOURCE_MANIFEST ||
    "/operator/production-source-manifest.json",
);
const pools = [];
class Completed extends Error {}
const required = (name) =>
  process.env[name] ||
  (() => {
    throw new ProductionCutoverRefusal(`missing_${name}`);
  })();
const lastJson = (value) => JSON.parse(value.trim().split("\n").at(-1));

async function writePrivate(path, value) {
  const file = await open(path, "wx", 0o600);
  try {
    await file.writeFile(`${JSON.stringify(value)}\n`);
    await file.sync();
  } finally {
    await file.close();
  }
}
async function child(script, args, environment) {
  const env = {
    PATH: process.env.PATH,
    TMPDIR: process.env.TMPDIR,
    ...environment,
  };
  delete env.DATABASE_URL;
  try {
    return await execute(process.execPath, [script, ...args], {
      cwd: root,
      env,
      timeout: 300_000,
      maxBuffer: 1024 * 1024,
    });
  } catch (error) {
    const safe = new Error("operator_child_failed");
    safe.code = typeof error?.code === "string" ? error.code : undefined;
    throw safe;
  }
}
async function connect(url, ca, pin, name) {
  const pool = new pg.Pool({
    ...databaseOptions(url, { caCertificate: ca, serverSHA256: pin }),
    max: 1,
    connectionTimeoutMillis: 5000,
    statement_timeout: 300_000,
    lock_timeout: 30_000,
    application_name: name,
  });
  pools.push(pool);
  return pool;
}
function importEnv(c, work, output) {
  return {
    ACCOUNTS_IMPORT_SOURCE_DATABASE_URL: c.sourceReaderUrl,
    ACCOUNTS_IMPORT_SOURCE_DATABASE_NAME: c.sourceDatabase,
    ACCOUNTS_IMPORT_SOURCE_DATABASE_CA_CERT: required("AEGYO_DATABASE_CA_CERT"),
    ACCOUNTS_IMPORT_SOURCE_DATABASE_SERVER_SHA256: required(
      "AEGYO_DATABASE_SERVER_SHA256",
    ),
    ACCOUNTS_IMPORT_SOURCE_NAMESPACE: c.sourceNamespace,
    ACCOUNTS_IMPORT_ISSUER: `${c.accountsBaseURL}/api/auth`,
    ACCOUNTS_IMPORT_EXPECTED_COUNT: String(c.expectedUsers),
    ACCOUNTS_IMPORT_TARGET_DATABASE_URL: c.accountsOwnerUrl,
    ACCOUNTS_IMPORT_TARGET_DATABASE_NAME: c.accountsDatabase,
    ACCOUNTS_IMPORT_TARGET_DATABASE_CA_CERT: required(
      "ACCOUNTS_DATABASE_CA_CERT",
    ),
    ACCOUNTS_IMPORT_TARGET_DATABASE_SERVER_SHA256: required(
      "ACCOUNTS_DATABASE_SERVER_SHA256",
    ),
    ACCOUNTS_IMPORT_INPUT: join(work, "snapshot.json"),
    ACCOUNTS_IMPORT_OUTPUT: output,
    ACCOUNTS_IMPORT_APPROVED_DIGEST: c.approvedSnapshotDigest || "",
    ACCOUNTS_DATABASE_ROLE: c.accountsRuntimeRole,
    ACCOUNTS_LEGACY_PEPPER: process.env.ACCOUNTS_LEGACY_PEPPER || "",
    ACCOUNTS_IMPORT_CREDENTIAL_PROOF: join(work, "credential.json"),
  };
}
async function snapshot(c, work) {
  const output = join(work, "snapshot.json");
  const result = await child(
    join(root, "scripts/import-legacy.mjs"),
    ["snapshot"],
    {
      ...importEnv(c, work, output),
      ACCOUNTS_IMPORT_OUTPUT: output,
      ACCOUNTS_IMPORT_CONFIRM: "read-only-private-source-snapshot",
    },
  );
  return lastJson(result.stdout);
}
async function importStatus(c, work) {
  const output = join(work, "transfer.json");
  await child(join(root, "scripts/import-legacy.mjs"), ["status"], {
    ...importEnv(c, work, output),
    ACCOUNTS_IMPORT_OUTPUT: output,
  });
  const transfer = JSON.parse(await readFile(output, "utf8"));
  if (
    transfer.snapshotDigest !== c.approvedSnapshotDigest ||
    transfer.mapping?.pairs?.length !== c.expectedUsers
  )
    throw new ProductionCutoverRefusal("import_status_not_exact");
  return transfer;
}
async function localSnapshot(c, work) {
  const output = join(work, "local.json");
  await child(join(root, "scripts/snapshot-aegyo-local-state.mjs"), [], {
    REHEARSAL_LEGACY_OWNER_DATABASE_URL: c.sourceOwnerUrl,
    REHEARSAL_LEGACY_DATABASE_NAME: c.sourceDatabase,
    REHEARSAL_DATABASE_CA_CERT: required("AEGYO_DATABASE_CA_CERT"),
    REHEARSAL_DATABASE_SERVER_SHA256: required("AEGYO_DATABASE_SERVER_SHA256"),
    ACCOUNTS_REAL_LOCAL_STATE_OUTPUT: output,
  });
  return JSON.parse(await readFile(output, "utf8"));
}
async function buildManifest(c, work, transfer, sourceReader) {
  const local = await localSnapshot(c, work);
  const { buildReconciliation } = await import(
    pathToFileURL(join(aegyoRoot, "scripts/shared-auth/reconciliation-lib.mjs"))
  );
  return augmentManifestWithOwnership(
    buildReconciliation(local, transfer.accounts, transfer.mapping),
    await captureProductionOwnership(sourceReader),
  );
}

let phase = process.argv[2] || "configuration";
try {
  const bundle = JSON.parse(await readFile(bundlePath, "utf8"));
  const c = productionCutoverConfig(bundle, process.env, process.argv[2] || "");
  phase = c.phase;
  validateProductionCutoverConfig(c);
  const work = join(root, ".proof", `production-${c.runId}-${phase}`);
  await mkdir(work, { recursive: false, mode: 0o700 });
  const sourceReader = await connect(
    c.sourceReaderUrl,
    required("AEGYO_DATABASE_CA_CERT"),
    required("AEGYO_DATABASE_SERVER_SHA256"),
    "production-cutover-reader",
  );
  const sourceOwner = await connect(
    c.sourceOwnerUrl,
    required("AEGYO_DATABASE_CA_CERT"),
    required("AEGYO_DATABASE_SERVER_SHA256"),
    "production-cutover-owner",
  );
  const accountsOwner = await connect(
    c.accountsOwnerUrl,
    required("ACCOUNTS_DATABASE_CA_CERT"),
    required("ACCOUNTS_DATABASE_SERVER_SHA256"),
    "production-cutover-accounts",
  );
  await verifyProductionConnections(
    sourceReader,
    sourceOwner,
    accountsOwner,
    c,
  );
  let source = await inspectAegyoProduction(sourceReader, 51);
  const beforeQuiet = await captureProductionPreservation(sourceReader);
  await delay(45_000);
  const afterQuiet = await captureProductionPreservation(sourceReader);
  assertPreserved(beforeQuiet, afterQuiet);
  const afterQuietState = await inspectAegyoProduction(sourceReader, 51);
  if (
    source.mappings !== afterQuietState.mappings ||
    source.latches !== afterQuietState.latches
  )
    throw new ProductionCutoverRefusal("concurrent_cutover_state_change");
  source = afterQuietState;
  const fresh = await snapshot(c, work);
  assertFreshSnapshot(fresh, c, c.approvedSnapshotDigest);
  const preservedDigest = preservationDigest(afterQuiet);
  if (
    c.approvedPreservationDigest &&
    preservedDigest !== c.approvedPreservationDigest
  )
    throw new ProductionCutoverRefusal("source_content_or_local_ids_changed");
  const target = await inspectAccountsProduction(accountsOwner);
  const cutoverState = classifyProductionCutoverState({
    targetUsers: target.users,
    importBatches: target.importBatches,
    mappings: source.mappings,
    latches: source.latches,
    expectedUsers: c.expectedUsers,
  });
  if (phase === "inspect") {
    if (cutoverState !== "not_started")
      throw new ProductionCutoverRefusal("production_cutover_already_started");
    assertEmptyAccountsTarget(target);
    console.info(
      JSON.stringify(
        publicEvidence({
          phase,
          status: "review_required",
          runId: c.runId,
          sourceCount: fresh.count,
          sourceSnapshotDigest: fresh.snapshotDigest,
          preservationDigest: preservedDigest,
          activationLatched: false,
          sourceQuietVerified: true,
          freezeVerified: true,
          deploymentVerified: true,
        }),
      ),
    );
  } else {
    let transfer;
    if (cutoverState === "not_started") {
      if (phase === "status") {
        console.info(
          JSON.stringify(
            publicEvidence({
              phase,
              status: "not_started",
              runId: c.runId,
              sourceCount: fresh.count,
              sourceSnapshotDigest: fresh.snapshotDigest,
              preservationDigest: preservedDigest,
              importedCount: 0,
              mappingsInstalled: source.mappings,
              activationLatched: false,
              sourceQuietVerified: true,
              freezeVerified: true,
              deploymentVerified: true,
            }),
          ),
        );
        throw new Completed();
      }
      if (phase !== "apply")
        throw new ProductionCutoverRefusal("import_not_committed");
      assertEmptyAccountsTarget(target);
      await writePrivate(join(work, "credential.json"), {
        sourceUserId: required("ACCOUNTS_REAL_CANARY_SOURCE_USER_ID"),
        password: required("ACCOUNTS_REAL_CANARY_PASSWORD"),
        deployedPepperDigest: required("ACCOUNTS_REAL_DEPLOYED_PEPPER_DIGEST"),
      });
      const env = importEnv(c, work, join(work, "imported.json"));
      try {
        if (!target.importJournalInstalled)
          await child(
            join(root, "scripts/import-legacy.mjs"),
            ["init-journal"],
            {
              ...env,
              ACCOUNTS_IMPORT_CONFIRM: "install-operator-only-journal",
            },
          );
        await child(join(root, "scripts/import-legacy.mjs"), ["apply"], {
          ...env,
          ACCOUNTS_IMPORT_CONFIRM: "source-writers-and-target-traffic-frozen",
        });
      } finally {
        await rm(join(work, "credential.json"), { force: true });
      }
      transfer = JSON.parse(
        await readFile(join(work, "imported.json"), "utf8"),
      );
    } else {
      assertImportedAccountsTarget(target, c.expectedUsers);
      if (phase === "activate")
        assertActivationAccountsTarget(target, c.expectedUsers);
      transfer = await importStatus(c, work);
    }
    const reviewedManifest = await buildManifest(
      c,
      work,
      transfer,
      sourceReader,
    );
    if (
      c.approvedMappingDigest &&
      reviewedManifest.mappingDigest !== c.approvedMappingDigest
    )
      throw new ProductionCutoverRefusal("approved_mapping_digest_mismatch");
    let state;
    if (source.mappings === 0 && source.latches === 0 && phase === "apply")
      state = await applyProductionMappings(
        sourceOwner,
        reviewedManifest,
        c.approvedPreservationDigest,
      );
    else if (
      source.mappings === 0 &&
      source.latches === 0 &&
      phase === "status"
    )
      state = {
        count: 0,
        mappingDigest: reviewedManifest.mappingDigest,
        active: false,
        importedOnly: true,
      };
    else if (source.mappings === c.expectedUsers)
      state = await inspectProductionMappings(sourceReader, reviewedManifest);
    else
      throw new ProductionCutoverRefusal("mapping_state_uncertain_run_status");
    if (phase === "apply" && state.active)
      throw new ProductionCutoverRefusal(
        "activation_already_latched_run_status",
      );
    if (phase === "activate") {
      if (state.active)
        throw new ProductionCutoverRefusal(
          "activation_already_latched_run_status",
        );
      validateRecoveryEvidence(c.recoveryEvidence, c);
      const sourceSnapshot = JSON.parse(
        await readFile(join(work, "snapshot.json"), "utf8"),
      );
      const canarySourceId = required("ACCOUNTS_REAL_CANARY_SOURCE_USER_ID");
      const canarySource = sourceSnapshot.users.find(
        (row) => row.id === canarySourceId,
      );
      if (
        !canarySource ||
        !reviewedManifest.rows.some((row) => row.localUserId === canarySourceId)
      )
        throw new ProductionCutoverRefusal("reviewed_canary_not_in_snapshot");
      const readiness = await child(
        join(root, "scripts/verify-production-activation-readiness.mjs"),
        [],
        {
          ...importEnv(c, work, join(work, "unused.json")),
          ACCOUNTS_PRODUCTION_ACTIVATION_CONFIRM:
            "prove-live-provider-before-irreversible-latch",
          ACCOUNTS_ENVIRONMENT: "production",
          ACCOUNTS_TRAFFIC_ENABLED: "true",
          ACCOUNTS_SIGNUP_ENABLED: "false",
          ACCOUNTS_BASE_URL: c.accountsBaseURL,
          ACCOUNTS_DATABASE_ROLE_PASSWORD: required(
            "ACCOUNTS_DATABASE_ROLE_PASSWORD",
          ),
          ACCOUNTS_REAL_CANARY_EMAIL: required("ACCOUNTS_REAL_CANARY_EMAIL"),
          ACCOUNTS_REAL_CANARY_PASSWORD: required(
            "ACCOUNTS_REAL_CANARY_PASSWORD",
          ),
          ACCOUNTS_REAL_CANARY_SOURCE_USER_ID: required(
            "ACCOUNTS_REAL_CANARY_SOURCE_USER_ID",
          ),
          ACCOUNTS_REAL_CANARY_EXPECTED_VERIFIED: String(
            canarySource.emailVerified,
          ),
          ACCOUNTS_PRODUCTION_CLIENTS_JSON: required(
            "ACCOUNTS_PRODUCTION_CLIENTS_JSON",
          ),
          ACCOUNTS_STATE_READERS_JSON: required("ACCOUNTS_STATE_READERS_JSON"),
        },
      );
      const proof = lastJson(readiness.stdout);
      if (
        !proof.runtimeReady ||
        !proof.discoveryVerified ||
        !proof.jwksVerified ||
        proof.callbacksVerified !== 3 ||
        !proof.importedCanaryVerified ||
        !proof.tokenVerified ||
        !proof.securityStateVerified ||
        !proof.canarySessionRemoved
      )
        throw new ProductionCutoverRefusal(
          "activation_readiness_proof_incomplete",
        );
      state = await activateProductionMappings(
        sourceOwner,
        reviewedManifest,
        c.approvedPreservationDigest,
      );
    }
    console.info(
      JSON.stringify(
        publicEvidence({
          phase,
          status:
            phase === "apply"
              ? "ready_for_activation"
              : state.importedOnly
                ? "imported_not_mapped"
                : state.active
                  ? "active"
                  : "mapped_not_active",
          runId: c.runId,
          sourceCount: fresh.count,
          sourceSnapshotDigest: fresh.snapshotDigest,
          preservationDigest: preservedDigest,
          mappingDigest: reviewedManifest.mappingDigest,
          importedCount: c.expectedUsers,
          mappingsInstalled: state.count,
          activationLatched: state.active,
          sourceQuietVerified: true,
          freezeVerified: true,
          deploymentVerified: true,
        }),
      ),
    );
  }
} catch (error) {
  if (!(error instanceof Completed)) {
    console.error(sanitizedFailure(error, phase));
    process.exitCode = error instanceof ProductionCutoverRefusal ? 2 : 4;
  }
} finally {
  await Promise.allSettled(pools.map((pool) => pool.end()));
}
