#!/usr/bin/env node
import { execFile } from "node:child_process";
import { open, readFile, stat } from "node:fs/promises";
import { promisify } from "node:util";
import { PRODUCTION } from "./production-cutover-lib.mjs";

const execute = promisify(execFile);
const [phase, output] = process.argv.slice(2);
if (
  !phase ||
  !output ||
  !["inspect", "apply", "activate", "status"].includes(phase)
)
  throw new Error("usage: PHASE PRIVATE_OUTPUT_JSON");
const cli = process.env.RAILWAY_CLI || "railway";
const environmentId = PRODUCTION.environmentId;
async function railway(args) {
  const { stdout } = await execute(cli, args, {
    env: { PATH: process.env.PATH, RAILWAY_TOKEN: process.env.RAILWAY_TOKEN },
    timeout: 30_000,
    maxBuffer: 1024 * 1024,
  });
  return JSON.parse(stdout);
}
const variables = (service) =>
  railway([
    "variables",
    "--json",
    "--service",
    service,
    "--environment",
    environmentId,
  ]);
const deployment = async (service) => {
  const value = await railway([
    "deployment",
    "list",
    "--json",
    "--service",
    service,
    "--environment",
    environmentId,
  ]);
  const row = Array.isArray(value) ? value[0] : value.deployments?.[0];
  if (!row || row.status !== "SUCCESS")
    throw new Error("live_deployment_not_successful");
  return row;
};
const [aegyoVariables, accountsVariables, aegyoDeployment, accountsDeployment] =
  await Promise.all([
    variables(PRODUCTION.aegyoServiceId),
    variables(PRODUCTION.accountsServiceId),
    deployment(PRODUCTION.aegyoServiceId),
    deployment(PRODUCTION.accountsServiceId),
  ]);
const databaseHost = (value) => {
  const parsed = new URL(value);
  if (!parsed.hostname.endsWith(".railway.internal"))
    throw new Error("non_private_database_host");
  return parsed.hostname;
};
const meta = (row, ...names) =>
  names.map((name) => row[name] ?? row.meta?.[name]).find(Boolean);
const serviceManifest = (row) => row.meta?.serviceManifest || {};
const attestation = {
  version: 1,
  capturedAt: new Date().toISOString(),
  phase,
  projectId: PRODUCTION.projectId,
  environmentId,
  operatorServiceId: PRODUCTION.operatorServiceId,
  aegyoServiceId: PRODUCTION.aegyoServiceId,
  sourceDatabaseServiceId: PRODUCTION.sourceDatabaseServiceId,
  accountsServiceId: PRODUCTION.accountsServiceId,
  accountsDatabaseServiceId: PRODUCTION.accountsDatabaseServiceId,
  sourceDatabase: PRODUCTION.sourceDatabase,
  accountsDatabase: PRODUCTION.accountsDatabase,
  accountsBaseURL: PRODUCTION.accountsBaseURL,
  aegyoBaseURL: PRODUCTION.aegyoBaseURL,
  sourceNamespace: PRODUCTION.sourceNamespace,
  aegyoDeploymentId: aegyoDeployment.id,
  aegyoRevision: meta(aegyoDeployment, "commitHash", "commitSha"),
  aegyoBuildCommand: serviceManifest(aegyoDeployment).build?.buildCommand,
  aegyoStartCommand: serviceManifest(aegyoDeployment).deploy?.startCommand,
  aegyoPredeployCommand:
    serviceManifest(aegyoDeployment).deploy?.preDeployCommand || "none",
  accountsDeploymentId: accountsDeployment.id,
  accountsImageDigest: meta(accountsDeployment, "imageDigest"),
  accountsEnvironment: accountsVariables.ACCOUNTS_ENVIRONMENT,
  accountsTrafficEnabled: accountsVariables.ACCOUNTS_TRAFFIC_ENABLED,
  accountsSignupEnabled: accountsVariables.ACCOUNTS_SIGNUP_ENABLED,
  aegyoFreezeEnabled: aegyoVariables.AEGYO_AUTH_CUTOVER_FREEZE,
  aegyoSharedAuthEnabled: aegyoVariables.AEGYO_SHARED_AUTH_ENABLED,
  aegyoRequestsDrained: aegyoVariables.AEGYO_CUTOVER_REQUESTS_DRAINED,
  directWritersPaused: aegyoVariables.AEGYO_DIRECT_DATABASE_WRITERS_PAUSED,
  sourceDatabaseHost: databaseHost(aegyoVariables.DATABASE_URL),
  accountsDatabaseHost: databaseHost(accountsVariables.DATABASE_URL),
};
if (phase === "activate") {
  const evidencePath = process.env.ACCOUNTS_PRODUCTION_RECOVERY_EVIDENCE;
  if (!evidencePath) throw new Error("production_recovery_evidence_required");
  const evidenceStat = await stat(evidencePath);
  if (
    !evidenceStat.isFile() ||
    evidenceStat.mode & 0o077 ||
    evidenceStat.uid !== process.getuid()
  )
    throw new Error("unsafe_production_recovery_evidence");
  attestation.recoveryEvidence = JSON.parse(
    await readFile(evidencePath, "utf8"),
  );
  attestation.recoveryProviderIdDigest =
    accountsVariables.ACCOUNTS_PRODUCTION_RECOVERY_PROVIDER_ID_DIGEST;
}
const file = await open(output, "wx", 0o600);
try {
  await file.writeFile(`${JSON.stringify(attestation, null, 2)}\n`);
  await file.sync();
} finally {
  await file.close();
}
console.info(
  JSON.stringify({
    attested: true,
    phase,
    capturedAt: attestation.capturedAt,
    aegyoDeploymentId: attestation.aegyoDeploymentId,
    accountsDeploymentId: attestation.accountsDeploymentId,
  }),
);
