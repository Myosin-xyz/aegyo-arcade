import test from "node:test";
import assert from "node:assert/strict";
import {
  RehearsalRefusal,
  assertInventory,
  validatePrivateSource,
} from "../scripts/real-rehearsal-preflight-lib.mjs";

const valid = {
  confirm: "read-only-restored-clone-preflight",
  sourceUrl: "postgresql://reader:secret@clone.railway.internal:5432/rehearsal",
  caCertificate: "-----BEGIN CERTIFICATE-----\nsynthetic\n-----END CERTIFICATE-----",
  expectedTables: 48,
  expectedUsers: 52,
  expectedSessions: 25,
};

test("requires a query-free Railway-private source and exact inventory", () => {
  assert.deepEqual(validatePrivateSource(valid), { canaryProvided: false });
  for (const sourceUrl of [
    "postgresql://reader@public.example/rehearsal",
    valid.sourceUrl + "?sslmode=disable",
  ]) assert.throws(() => validatePrivateSource({ ...valid, sourceUrl }), RehearsalRefusal);
  assert.doesNotThrow(() => assertInventory({ tableCount: 48, userCount: 52, sessionCount: 25 }, { tableCount: 48, userCount: 52, sessionCount: 25 }));
  assert.throws(() => assertInventory({ tableCount: 48, userCount: 51, sessionCount: 25 }, { tableCount: 48, userCount: 52, sessionCount: 25 }), /user_count_mismatch/);
});

test("canary handoff is all-or-none and never inferred", () => {
  assert.throws(() => validatePrivateSource({ ...valid, canaryPassword: "not-printed" }), /incomplete_canary_handoff/);
  assert.deepEqual(validatePrivateSource({ ...valid, canarySourceUserId: "staff-id", canaryPassword: "not-printed", legacyPepper: "private", deployedPepperDigest: "a".repeat(64), credentialProofOutput: "/private/proof.json" }), { canaryProvided: true });
});
