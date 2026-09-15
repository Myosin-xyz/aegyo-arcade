import test from "node:test";
import assert from "node:assert/strict";
import {
  EXPECTED,
  RealImportRehearsalRefusal,
  sanitizedFailure,
  validateRealImportRehearsal,
} from "../scripts/real-import-rehearsal-lib.mjs";

const valid = () => ({
  ...EXPECTED,
  confirm: "restored-data-accounts-import-reconciliation-rehearsal",
  trafficEnabled: "false",
  signupEnabled: "false",
  sourceDatabase: "kpopdb",
  expectedTables: 48,
  sourceNamespace: `railway:${EXPECTED.projectId}/${EXPECTED.environmentId}/${EXPECTED.sourceServiceId}`,
  accountsBaseURL: "https://account.aegyoarena.com",
  aegyoBaseURL: "https://account.aegyoarena.com",
  legacyDatabase: "aegyo_auth_rehearsal_20260915_a1b2c3",
  accountsDatabase: "accounts_rehearsal_20260915_a1b2c3",
  sourceRole: "aegyo_rehearsal_reader_a1b2c3",
  accountsRuntimeRole: "accounts_rehearsal_app_a1b2c3",
  expectedUsers: 53,
  canarySourceUserId: "123e4567-e89b-42d3-a456-426614174000",
  approvedSnapshotDigest: "a".repeat(64),
  deployedPepperDigest: "b".repeat(64),
  urls: {
    source: "postgresql://reader:secret@postgres.railway.internal:5432/kpopdb",
    legacy: "postgresql://owner:secret@restore.railway.internal:5432/aegyo_auth_rehearsal_20260915_a1b2c3",
    accounts: "postgresql://owner:secret@restore.railway.internal:5432/accounts_rehearsal_20260915_a1b2c3",
  },
});

test("accepts only the pinned closed private rehearsal topology", () => {
  assert.equal(validateRealImportRehearsal(valid()), true);
});

for (const mutate of [
  (x) => (x.projectId = "00000000-0000-4000-8000-000000000000"),
  (x) => (x.trafficEnabled = "true"),
  (x) => (x.accountsDatabase = "accounts_production"),
  (x) => (x.urls.accounts = "postgresql://owner:secret@public.proxy:5432/accounts"),
  (x) => (x.ordinaryDatabaseUrl = "postgresql://forbidden"),
  (x) => (x.aegyoCommit = "main"),
]) test("refuses a changed identity, target, network or traffic gate", () => {
  const input = valid(); mutate(input);
  assert.throws(() => validateRealImportRehearsal(input), RealImportRehearsalRefusal);
});

test("sanitizes unexpected failures without reflecting messages or URLs", () => {
  const failure = new Error("postgresql://user:password@host/private email@example.test");
  failure.code = "08006";
  assert.equal(sanitizedFailure(failure, "restore"), "real_import_rehearsal_failed(08006,restore)");
});
