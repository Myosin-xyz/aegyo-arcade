import { createHash } from "node:crypto";

export class RealImportRehearsalRefusal extends Error {}
const refuse = (code) => {
  throw new RealImportRehearsalRefusal(code);
};
const name = /^[a-z_][a-z0-9_]{0,62}$/;
const hex = /^[0-9a-f]{64}$/;
const opaqueId = /^[^\u0000-\u001f]{1,200}$/u;

export const EXPECTED = Object.freeze({
  projectId: "a719c26e-33b9-4a1c-8759-d5401c1e181a",
  environmentId: "27e2f29a-5846-48f8-9727-694a97c36ef6",
  restoredPostgresServiceId: "af639001-c6cd-417c-941b-c84c657c7c83",
  operatorServiceId: "57406cd0-f9ae-4000-b893-684aa2e0db16",
  sourceServiceId: "726d0c13-88e6-4167-b1ac-521b4a7b1216",
  aegyoCommit: "e9e0468fe7dc477e3188d18d0ab769d5bddb990e",
});

export function validateRealImportRehearsal(input) {
  if (!['inspect', 'apply'].includes(input.phase)) refuse('invalid_phase');
  if (input.confirm !== `restored-data-accounts-import-reconciliation-${input.phase}`)
    refuse('confirmation_missing');
  for (const key of ['projectId', 'environmentId', 'restoredPostgresServiceId', 'operatorServiceId', 'sourceServiceId', 'aegyoCommit'])
    if (input[key] !== EXPECTED[key]) refuse(`unexpected_${key}`);
  if (input.trafficEnabled !== 'false' || input.signupEnabled !== 'false')
    refuse('rehearsal_traffic_and_signup_must_be_off');
  if (input.ordinaryDatabaseUrl) refuse('ordinary_DATABASE_URL_forbidden');
  if (input.sourceDatabase !== 'kpopdb') refuse('unexpected_source_database');
  if (input.expectedTables !== 48) refuse('unexpected_source_table_count');
  if (input.sourceNamespace !== `railway:${EXPECTED.projectId}/${EXPECTED.environmentId}/${EXPECTED.sourceServiceId}`)
    refuse('unexpected_source_namespace');
  if (input.accountsBaseURL !== 'https://account.aegyoarena.com' || input.aegyoBaseURL !== input.accountsBaseURL)
    refuse('unexpected_accounts_issuer');
  for (const [key, value] of Object.entries({ legacyDatabase: input.legacyDatabase, accountsDatabase: input.accountsDatabase, sourceRole: input.sourceRole, legacyOwnerRole: input.legacyOwnerRole, accountsRuntimeRole: input.accountsRuntimeRole }))
    if (!name.test(value ?? '')) refuse(`invalid_${key}`);
  if (!/^aegyo_auth_rehearsal_[0-9]{8}_[a-z0-9]{6,16}$/.test(input.legacyDatabase)) refuse('legacy_database_not_new_rehearsal_target');
  if (!/^accounts_rehearsal_[0-9]{8}_[a-z0-9]{6,16}$/.test(input.accountsDatabase)) refuse('accounts_database_not_new_rehearsal_target');
  if (input.legacyDatabase === input.accountsDatabase) refuse('database_names_must_differ');
  if (!Number.isSafeInteger(input.expectedUsers) || input.expectedUsers < 1) refuse('invalid_expected_users');
  const requiredUrls = input.phase === 'inspect' ? ['source', 'legacyOwner'] : ['legacyReader', 'legacyOwner', 'accounts'];
  const presentUrls = Object.keys(input.urls ?? {}).filter((key) => input.urls[key]);
  if (presentUrls.length !== requiredUrls.length || requiredUrls.some((key) => !presentUrls.includes(key))) refuse('unexpected_phase_database_connections');
  if (input.phase === 'apply') {
    if (!opaqueId.test(input.canarySourceUserId ?? '')) refuse('invalid_canary_source_user_id');
    if (!hex.test(input.approvedSnapshotDigest ?? '')) refuse('invalid_approved_snapshot_digest');
    if (!hex.test(input.deployedPepperDigest ?? '')) refuse('invalid_deployed_pepper_digest');
  }
  for (const [key, value] of Object.entries(input.urls ?? {})) {
    if (!value) continue;
    let parsed;
    try { parsed = new URL(value); } catch { refuse(`invalid_${key}`); }
    if (parsed.protocol !== 'postgresql:' || !parsed.hostname.endsWith('.railway.internal') || parsed.search) refuse(`${key}_must_be_query_free_private_railway_url`);
  }
  return true;
}

export function sanitizedFailure(error, phase) {
  if (error instanceof RealImportRehearsalRefusal) return error.message;
  const code = typeof error?.code === "string" && /^[A-Z0-9]{5}$/.test(error.code) ? error.code : "internal";
  return `real_import_rehearsal_failed(${code},${/^[a-z0-9-]+$/.test(phase) ? phase : "unknown"})`;
}

export function digest(value) {
  return createHash("sha256").update(value).digest("hex");
}
