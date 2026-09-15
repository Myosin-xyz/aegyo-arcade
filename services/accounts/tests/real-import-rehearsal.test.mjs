import test from "node:test";
import assert from "node:assert/strict";
import {
  EXPECTED,
  RealImportRehearsalRefusal,
  sanitizedFailure,
  validateRealImportRehearsal,
} from "../scripts/real-import-rehearsal-lib.mjs";
const base = (phase) => ({
  ...EXPECTED,
  phase,
  confirm: `restored-data-accounts-import-reconciliation-${phase}`,
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
  legacyOwnerRole: "aegyo_rehearsal_owner_a1b2c3",
  accountsRuntimeRole: "accounts_rehearsal_app_a1b2c3",
  expectedUsers: 54,
  canarySourceUserId: "canary-id",
  approvedSnapshotDigest: "a".repeat(64),
  deployedPepperDigest: "b".repeat(64),
  urls:
    phase === "inspect"
      ? {
          source: "postgresql://reader:x@source.railway.internal:5432/kpopdb",
          legacyOwner:
            "postgresql://owner:x@restore.railway.internal:5432/aegyo_auth_rehearsal_20260915_a1b2c3",
        }
      : {
          legacyReader:
            "postgresql://reader:x@restore.railway.internal:5432/aegyo_auth_rehearsal_20260915_a1b2c3",
          legacyOwner:
            "postgresql://owner:x@restore.railway.internal:5432/aegyo_auth_rehearsal_20260915_a1b2c3",
          accounts:
            "postgresql://owner:x@restore.railway.internal:5432/accounts_rehearsal_20260915_a1b2c3",
        },
});
test("inspect accepts only production source and empty clone owner", () =>
  assert.equal(validateRealImportRehearsal(base("inspect")), true));
test("apply accepts only immutable clone reader, clone owner and Accounts target", () =>
  assert.equal(validateRealImportRehearsal(base("apply")), true));
test("resume inspect accepts only the preserved clone owner", () => {
  const x = base("resume-inspect");
  x.urls = {
    legacyOwner:
      "postgresql://owner:x@restore.railway.internal:5432/aegyo_auth_rehearsal_20260915_a1b2c3",
  };
  assert.equal(validateRealImportRehearsal(x), true);
});
test("resume inspect refuses a production source connection", () => {
  const x = base("resume-inspect");
  x.urls = {
    legacyOwner:
      "postgresql://owner:x@restore.railway.internal:5432/aegyo_auth_rehearsal_20260915_a1b2c3",
    source: "postgresql://r:x@source.railway.internal:5432/kpopdb",
  };
  assert.throws(
    () => validateRealImportRehearsal(x),
    RealImportRehearsalRefusal,
  );
});
test("apply refuses a production source connection", () => {
  const x = base("apply");
  x.urls.source = "postgresql://r:x@source.railway.internal:5432/kpopdb";
  assert.throws(
    () => validateRealImportRehearsal(x),
    RealImportRehearsalRefusal,
  );
});
test("inspect does not require a reviewed digest before emitting it", () => {
  const x = base("inspect");
  delete x.approvedSnapshotDigest;
  assert.equal(validateRealImportRehearsal(x), true);
});
for (const mutate of [
  (x) => (x.projectId = "bad"),
  (x) => (x.trafficEnabled = "true"),
  (x) => (x.accountsDatabase = "accounts_production"),
  (x) => (x.urls.accounts = "postgresql://owner:x@public.proxy:5432/accounts"),
  (x) => (x.ordinaryDatabaseUrl = "postgresql://forbidden"),
  (x) => (x.aegyoCommit = "main"),
])
  test("refuses changed identity, target, network or traffic gate", () => {
    const x = base("apply");
    mutate(x);
    assert.throws(
      () => validateRealImportRehearsal(x),
      RealImportRehearsalRefusal,
    );
  });
test("sanitizes failures", () => {
  const e = new Error("postgresql://secret");
  e.code = "08006";
  assert.equal(
    sanitizedFailure(e, "restore"),
    "real_import_rehearsal_failed(08006,restore)",
  );
});
