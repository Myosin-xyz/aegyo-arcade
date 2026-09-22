import { createHash } from "node:crypto";

export class ProductionCutoverRefusal extends Error {}

const refuse = (code) => {
  throw new ProductionCutoverRefusal(code);
};
const hex64 = /^[a-f0-9]{64}$/;
const uuid = /^[a-f0-9]{8}-(?:[a-f0-9]{4}-){3}[a-f0-9]{12}$/;
const roleName = /^[a-z_][a-z0-9_]{0,62}$/;
const runId = /^[0-9]{8}t[0-9]{6}z-[a-z0-9]{6,16}$/;

export const PRODUCTION = Object.freeze({
  projectId: "a719c26e-33b9-4a1c-8759-d5401c1e181a",
  environmentId: "27e2f29a-5846-48f8-9727-694a97c36ef6",
  operatorServiceId: "57406cd0-f9ae-4000-b893-684aa2e0db16",
  aegyoServiceId: "de8a769d-5ca0-4c80-a8c1-877860ca9e6e",
  sourceDatabaseServiceId: "726d0c13-88e6-4167-b1ac-521b4a7b1216",
  accountsServiceId: "4f32c9f4-4ff6-4e81-8bda-f93f71e5011b",
  accountsDatabaseServiceId: "baa2ac26-0ff1-4a0e-86c2-dbf5ef6d20de",
  sourceDatabase: "kpopdb",
  accountsDatabase: "accounts_production",
  accountsRuntimeRole: "aegyo_accounts_production_app",
  accountsBaseURL: "https://account.aegyoarena.com",
  aegyoBaseURL: "https://aegyoarena.com",
  sourceNamespace:
    "railway:a719c26e-33b9-4a1c-8759-d5401c1e181a/27e2f29a-5846-48f8-9727-694a97c36ef6/726d0c13-88e6-4167-b1ac-521b4a7b1216",
  requiredFreezeAncestor: "a01aa0fcbcb654dc16f3bb0e7b76909de20b823d",
  aegyoBuildCommand: "npx prisma generate && next build",
  aegyoStartCommand: "npm start",
  aegyoPredeployCommand: "none",
  accountsImageDigest:
    "sha256:324869c98dd05b91be542bebd94896303b0586ec76808df92c9bd1b7294bfc8a",
});

const confirmations = Object.freeze({
  inspect: "inspect-frozen-production-cutover",
  apply: "import-frozen-production-users-and-install-reviewed-mappings",
  activate: "activate-reviewed-production-mappings",
  status: "inspect-production-cutover-status",
});

function privateDatabaseUrl(value, database, host, label) {
  let parsed;
  try {
    parsed = new URL(value);
  } catch {
    refuse(`invalid_${label}_database_url`);
  }
  if (
    parsed.protocol !== "postgresql:" ||
    !parsed.username ||
    !parsed.password ||
    parsed.hostname !== host ||
    parsed.port !== "5432" ||
    parsed.search ||
    parsed.hash ||
    decodeURIComponent(parsed.pathname) !== `/${database}`
  )
    refuse(`${label}_must_be_exact_private_production_database`);
}

export function validateProductionCutoverConfig(input) {
  if (!Object.hasOwn(confirmations, input.phase)) refuse("invalid_phase");
  if (input.confirm !== confirmations[input.phase])
    refuse("confirmation_missing");
  const attestationAge =
    Date.now() - Date.parse(input.attestationCapturedAt ?? "");
  if (
    input.attestationPhase !== input.phase ||
    !Number.isFinite(attestationAge) ||
    attestationAge < 0 ||
    attestationAge > 30 * 60_000
  )
    refuse("stale_or_wrong_phase_live_attestation");
  const exact = {
    projectId: PRODUCTION.projectId,
    environmentId: PRODUCTION.environmentId,
    operatorServiceId: PRODUCTION.operatorServiceId,
    sourceDatabaseServiceId: PRODUCTION.sourceDatabaseServiceId,
    accountsServiceId: PRODUCTION.accountsServiceId,
    accountsDatabaseServiceId: PRODUCTION.accountsDatabaseServiceId,
    sourceDatabase: PRODUCTION.sourceDatabase,
    accountsDatabase: PRODUCTION.accountsDatabase,
    accountsRuntimeRole: PRODUCTION.accountsRuntimeRole,
    accountsBaseURL: PRODUCTION.accountsBaseURL,
    aegyoBaseURL: PRODUCTION.aegyoBaseURL,
    sourceNamespace: PRODUCTION.sourceNamespace,
    aegyoBuildCommand: PRODUCTION.aegyoBuildCommand,
    aegyoStartCommand: PRODUCTION.aegyoStartCommand,
    aegyoPredeployCommand: PRODUCTION.aegyoPredeployCommand,
    accountsImageDigest: PRODUCTION.accountsImageDigest,
  };
  for (const [key, expected] of Object.entries(exact))
    if (input[key] !== expected) refuse(`unexpected_${key}`);
  if (
    !uuid.test(input.aegyoDeploymentId ?? "") ||
    !/^[a-f0-9]{40}$/.test(input.aegyoRevision ?? "") ||
    input.aegyoRevision !== input.reviewedAegyoRevision ||
    input.requiredFreezeAncestor !== PRODUCTION.requiredFreezeAncestor ||
    input.reviewedRevisionIncludesFreeze !== true
  )
    refuse("unreviewed_aegyo_deployment_or_revision");
  if (
    input.attestedOperatorServiceId !== PRODUCTION.operatorServiceId ||
    input.attestedAegyoServiceId !== PRODUCTION.aegyoServiceId ||
    input.attestedAegyoDeploymentId !== input.aegyoDeploymentId ||
    input.attestedAegyoRevision !== input.aegyoRevision ||
    input.attestedAccountsServiceId !== PRODUCTION.accountsServiceId ||
    !uuid.test(input.accountsDeploymentId ?? "") ||
    input.attestedAccountsDeploymentId !== input.accountsDeploymentId ||
    input.attestedAccountsImageDigest !== PRODUCTION.accountsImageDigest ||
    input.attestedFreezeEnabled !== "true" ||
    input.attestedSharedAuthEnabled !== input.aegyoSharedAuthEnabled ||
    input.attestedAccountsTrafficEnabled !== input.accountsTrafficEnabled ||
    input.attestedAccountsSignupEnabled !== "false"
  )
    refuse("live_railway_attestation_mismatch");
  if (input.environment !== "production") refuse("production_mode_required");
  if (
    (input.phase === "activate" && input.accountsTrafficEnabled !== "true") ||
    (["inspect", "apply"].includes(input.phase) &&
      input.accountsTrafficEnabled !== "false") ||
    (input.phase === "status" &&
      !["true", "false"].includes(input.accountsTrafficEnabled))
  )
    refuse(
      input.phase === "activate"
        ? "accounts_traffic_must_be_enabled_before_latch"
        : "accounts_traffic_must_be_disabled",
    );
  if (input.accountsSignupEnabled !== "false")
    refuse("accounts_signup_must_be_disabled");
  if (input.aegyoFreezeEnabled !== "true")
    refuse("aegyo_credential_freeze_not_observed");
  if (
    (input.phase === "activate" && input.aegyoSharedAuthEnabled !== "true") ||
    (["inspect", "apply"].includes(input.phase) &&
      input.aegyoSharedAuthEnabled !== "false") ||
    (input.phase === "status" &&
      !["true", "false"].includes(input.aegyoSharedAuthEnabled))
  )
    refuse("aegyo_shared_auth_phase_configuration_invalid");
  if (input.aegyoRequestsDrained !== "true")
    refuse("aegyo_requests_not_drained");
  if (input.directWritersPaused !== "true")
    refuse("direct_database_writers_not_paused");
  if (input.ordinaryDatabaseUrl) refuse("ordinary_DATABASE_URL_forbidden");
  if (!runId.test(input.runId ?? "")) refuse("invalid_run_id");
  if (!roleName.test(input.sourceReadOnlyRole ?? ""))
    refuse("invalid_source_read_only_role");
  if (!roleName.test(input.sourceOwnerRole ?? ""))
    refuse("invalid_source_owner_role");
  if (!roleName.test(input.accountsOwnerRole ?? ""))
    refuse("invalid_accounts_owner_role");
  if (!Number.isSafeInteger(input.expectedUsers) || input.expectedUsers < 1)
    refuse("fresh_expected_user_count_required");
  if (
    !Number.isSafeInteger(input.expectedSourceTables) ||
    input.expectedSourceTables < 1
  )
    refuse("expected_source_table_count_required");
  if (input.expectedSourceTables !== 51)
    refuse("unexpected_source_schema_table_count");
  if (input.sourceSchemaStatus !== "additive-v1")
    refuse("production_additive_schema_required");
  if (!uuid.test(input.accountsDeploymentId))
    refuse("invalid_deployment_identity");
  privateDatabaseUrl(
    input.sourceReaderUrl,
    PRODUCTION.sourceDatabase,
    input.attestedSourceDatabaseHost,
    "source_reader",
  );
  privateDatabaseUrl(
    input.sourceOwnerUrl,
    PRODUCTION.sourceDatabase,
    input.attestedSourceDatabaseHost,
    "source_owner",
  );
  privateDatabaseUrl(
    input.accountsOwnerUrl,
    PRODUCTION.accountsDatabase,
    input.attestedAccountsDatabaseHost,
    "accounts_owner",
  );
  if (
    new Set([
      input.sourceReaderUrl,
      input.sourceOwnerUrl,
      input.accountsOwnerUrl,
    ]).size !== 3
  )
    refuse("database_connections_must_be_distinct");
  if (
    input.phase !== "inspect" &&
    !hex64.test(input.approvedSnapshotDigest ?? "")
  )
    refuse("approved_snapshot_digest_required");
  if (
    input.phase !== "inspect" &&
    !hex64.test(input.approvedPreservationDigest ?? "")
  )
    refuse("approved_preservation_digest_required");
  if (
    input.phase === "activate" &&
    !hex64.test(input.approvedMappingDigest ?? "")
  )
    refuse("approved_mapping_digest_required");
  return true;
}

export function validateRecoveryEvidence(input, config) {
  const age = Date.now() - Date.parse(input?.capturedAt ?? "");
  if (
    input?.version !== 1 ||
    !Number.isFinite(age) ||
    age < 0 ||
    age > 24 * 60 * 60_000 ||
    input.sourceSnapshotDigest !== config.approvedSnapshotDigest ||
    input.mappingDigest !== config.approvedMappingDigest ||
    !hex64.test(input.deliveryProviderIdDigest ?? "") ||
    input.deliveryProviderIdDigest !== config.recoveryProviderIdDigest ||
    input.publicRecoveryRequested !== true ||
    input.delivered !== true ||
    input.resetCompleted !== true ||
    input.legacyPasswordSignin !== true ||
    input.oldPasswordRejected !== true ||
    input.priorSessionsRevoked !== true ||
    input.replayRejected !== true ||
    input.newPasswordSignin !== true
  )
    refuse("production_recovery_evidence_missing_or_invalid");
  return true;
}

export function assertFreshSnapshot(result, config, approvedDigest) {
  if (
    result?.count !== config.expectedUsers ||
    !hex64.test(result?.snapshotDigest ?? "")
  )
    refuse("fresh_source_population_mismatch");
  if (approvedDigest && result.snapshotDigest !== approvedDigest)
    refuse("frozen_source_snapshot_not_approved");
  return true;
}

export function assertEmptyAccountsTarget(state) {
  if (
    state?.database !== PRODUCTION.accountsDatabase ||
    state.schemaVersion !== 1 ||
    state.guardRevision !== 2 ||
    state.clients !== 3 ||
    state.users !== 0 ||
    state.accounts !== 0 ||
    state.sessions !== 0 ||
    state.accessTokens !== 0 ||
    state.refreshTokens !== 0 ||
    state.jwks !== 0 ||
    state.importBatches !== 0
  )
    refuse("accounts_target_not_empty_prepared_production");
  return true;
}

export function assertImportedAccountsTarget(state, expectedUsers) {
  if (
    state?.database !== PRODUCTION.accountsDatabase ||
    state.schemaVersion !== 1 ||
    state.guardRevision !== 2 ||
    state.clients !== 3 ||
    state.users !== expectedUsers ||
    state.accounts !== expectedUsers ||
    state.importBatches !== 1
  )
    refuse("accounts_imported_population_not_exact");
  return true;
}

export function assertActivationAccountsTarget(state, expectedUsers) {
  assertImportedAccountsTarget(state, expectedUsers);
  if (
    state.sessions !== 0 ||
    state.accessTokens !== 0 ||
    state.refreshTokens !== 0 ||
    !Number.isSafeInteger(state.jwks) ||
    state.jwks < 1
  )
    refuse("accounts_activation_runtime_state_not_clean");
  return true;
}

export function preservationDigest(snapshot) {
  if (
    snapshot?.version !== 1 ||
    snapshot.database !== PRODUCTION.sourceDatabase ||
    !Array.isArray(snapshot.tables) ||
    snapshot.tables.length !== 49
  )
    refuse("invalid_preservation_snapshot");
  const names = new Set();
  for (const row of snapshot.tables) {
    if (
      !/^public\.[A-Za-z_][A-Za-z0-9_]*$/.test(row?.table ?? "") ||
      !Number.isSafeInteger(row.count) ||
      row.count < 0 ||
      !hex64.test(row.digest ?? "") ||
      names.has(row.table)
    )
      refuse("invalid_preservation_snapshot");
    names.add(row.table);
  }
  return createHash("sha256")
    .update(JSON.stringify(snapshot.tables))
    .digest("hex");
}

function canonicalJson(value) {
  if (Array.isArray(value)) return `[${value.map(canonicalJson).join(",")}]`;
  if (value && typeof value === "object")
    return `{${Object.keys(value)
      .sort()
      .map((key) => `${JSON.stringify(key)}:${canonicalJson(value[key])}`)
      .join(",")}}`;
  return JSON.stringify(value);
}
const sha256 = (value) =>
  createHash("sha256").update(canonicalJson(value)).digest("hex");

export function augmentManifestWithOwnership(manifest, ownership) {
  if (
    ownership?.version !== 1 ||
    !Array.isArray(ownership.edges) ||
    !Array.isArray(ownership.users)
  )
    refuse("invalid_complete_ownership_snapshot");
  const userOwnership = new Map(
    ownership.users.map((row) => [row.localUserId, row.digest]),
  );
  if (
    userOwnership.size !== manifest.rows.length ||
    manifest.rows.some(
      (row) => !hex64.test(userOwnership.get(row.localUserId) ?? ""),
    )
  )
    refuse("complete_ownership_population_mismatch");
  const rows = manifest.rows.map((row) => ({
    ...row,
    ownershipDigest: userOwnership.get(row.localUserId),
  }));
  const core = {
    ...Object.fromEntries(
      Object.entries(manifest).filter(
        ([key]) => key !== "mappingDigest" && key !== "rows",
      ),
    ),
    ownershipCatalogDigest: sha256(ownership.edges),
    rows,
  };
  return { ...core, mappingDigest: sha256(core) };
}

export function classifyProductionCutoverState({
  targetUsers,
  importBatches,
  mappings,
  latches,
  expectedUsers,
}) {
  if (
    targetUsers === 0 &&
    importBatches === 0 &&
    mappings === 0 &&
    latches === 0
  )
    return "not_started";
  if (
    targetUsers === expectedUsers &&
    importBatches === 1 &&
    mappings === 0 &&
    latches === 0
  )
    return "imported_not_mapped";
  if (
    targetUsers === expectedUsers &&
    importBatches === 1 &&
    mappings === expectedUsers &&
    latches === 0
  )
    return "mapped_not_active";
  if (
    targetUsers === expectedUsers &&
    importBatches === 1 &&
    mappings === expectedUsers &&
    latches === 1
  )
    return "active";
  refuse("cutover_state_uncertain_run_status");
}

export function assertPreserved(before, after) {
  if (preservationDigest(before) !== preservationDigest(after))
    refuse("source_content_or_local_ids_changed");
  return true;
}

export function sanitizedFailure(error, phase) {
  if (error instanceof ProductionCutoverRefusal) return error.message;
  const code =
    typeof error?.code === "string" && /^[A-Z0-9]{5}$/.test(error.code)
      ? error.code
      : "internal";
  const safePhase = /^[a-z-]+$/.test(phase ?? "") ? phase : "unknown";
  return `production_cutover_failed(${code},${safePhase});run_status_before_retry`;
}

export function publicEvidence(input) {
  const evidence = {
    version: 1,
    phase: input.phase,
    status: input.status,
    runId: input.runId,
    sourceCount: input.sourceCount,
    sourceSnapshotDigest: input.sourceSnapshotDigest,
    preservationDigest: input.preservationDigest,
    mappingDigest: input.mappingDigest,
    importedCount: input.importedCount,
    mappingsInstalled: input.mappingsInstalled,
    activationLatched: input.activationLatched,
    sourceQuietVerified: input.sourceQuietVerified,
    freezeVerified: input.freezeVerified,
    deploymentVerified: input.deploymentVerified,
  };
  const allowedStatus = new Set([
    "review_required",
    "ready_for_activation",
    "active",
    "not_started",
    "imported_not_mapped",
    "mapped_not_active",
    "commit_outcome_uncertain",
  ]);
  if (
    !Object.hasOwn(confirmations, evidence.phase) ||
    !allowedStatus.has(evidence.status)
  )
    refuse("invalid_public_evidence");
  if (!runId.test(evidence.runId ?? "")) refuse("invalid_public_evidence");
  for (const key of ["sourceSnapshotDigest", "preservationDigest"])
    if (!hex64.test(evidence[key] ?? "")) refuse("invalid_public_evidence");
  if (evidence.mappingDigest != null && !hex64.test(evidence.mappingDigest))
    refuse("invalid_public_evidence");
  for (const key of ["sourceCount", "importedCount", "mappingsInstalled"])
    if (
      evidence[key] != null &&
      (!Number.isSafeInteger(evidence[key]) || evidence[key] < 0)
    )
      refuse("invalid_public_evidence");
  for (const key of [
    "activationLatched",
    "sourceQuietVerified",
    "freezeVerified",
    "deploymentVerified",
  ])
    if (evidence[key] != null && typeof evidence[key] !== "boolean")
      refuse("invalid_public_evidence");
  return evidence;
}

export const productionCutoverConfirmations = confirmations;
