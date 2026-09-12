import { URL } from "node:url";

export class RehearsalRefusal extends Error {}
const refuse = (code) => {
  throw new RehearsalRefusal(code);
};

export function validatePrivateSource(input) {
  if (input.confirm !== "read-only-restored-clone-preflight")
    refuse("preflight_confirmation_missing");
  if (input.ordinaryDatabaseUrl) refuse("ordinary_DATABASE_URL_forbidden");
  let url;
  try {
    url = new URL(input.sourceUrl);
  } catch {
    refuse("invalid_source_database_url");
  }
  if (
    url.protocol !== "postgresql:" ||
    !url.hostname.endsWith(".railway.internal") ||
    url.search
  )
    refuse("source_must_be_query_free_railway_private_url");
  if (!input.caCertificate?.includes("BEGIN CERTIFICATE"))
    refuse("source_ca_required");
  if (!/^[A-Fa-f0-9]{64}$/.test(input.serverSHA256?.replaceAll(":", "") ?? ""))
    refuse("source_server_certificate_pin_required");
  for (const [name, value] of Object.entries({
    expectedTables: input.expectedTables,
    expectedUsers: input.expectedUsers,
    expectedSessions: input.expectedSessions,
  })) {
    if (!Number.isSafeInteger(value) || value < 0) refuse(`invalid_${name}`);
  }
  const canary = [
    input.canarySourceUserId,
    input.canaryPassword,
    input.legacyPepper,
    input.deployedPepperDigest,
    input.credentialProofOutput,
  ];
  if (canary.some(Boolean) && !canary.every(Boolean))
    refuse("incomplete_canary_handoff");
  return { canaryProvided: canary.every(Boolean) };
}

export function assertInventory(actual, expected) {
  if (actual.tableCount !== expected.tableCount) refuse("table_count_mismatch");
  if (actual.userCount !== expected.userCount) refuse("user_count_mismatch");
  if (actual.sessionCount !== expected.sessionCount)
    refuse("session_count_mismatch");
}
