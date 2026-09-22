import test from "node:test";
import assert from "node:assert/strict";
import {
  PRODUCTION,
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
} from "../scripts/production-cutover-lib.mjs";
import { productionCutoverConfig } from "../scripts/production-cutover-config.mjs";
import {
  LOGICAL_USER_OWNERSHIP_EDGES,
  REQUIRED_USER_OWNERSHIP_EDGES,
} from "../scripts/production-cutover-db.mjs";

const reviewedRevision = "c".repeat(40);
const base = (phase = "inspect") => ({
  phase,
  attestationPhase: phase,
  attestationCapturedAt: new Date().toISOString(),
  confirm: {
    inspect: "inspect-frozen-production-cutover",
    apply: "import-frozen-production-users-and-install-reviewed-mappings",
    activate: "activate-reviewed-production-mappings",
    status: "inspect-production-cutover-status",
  }[phase],
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
  aegyoDeploymentId: "11111111-2222-3333-4444-555555555555",
  aegyoRevision: reviewedRevision,
  reviewedAegyoRevision: reviewedRevision,
  requiredFreezeAncestor: PRODUCTION.requiredFreezeAncestor,
  reviewedRevisionIncludesFreeze: true,
  aegyoBuildCommand: PRODUCTION.aegyoBuildCommand,
  aegyoStartCommand: PRODUCTION.aegyoStartCommand,
  aegyoPredeployCommand: PRODUCTION.aegyoPredeployCommand,
  accountsDeploymentId: "66666666-7777-8888-9999-aaaaaaaaaaaa",
  accountsImageDigest: PRODUCTION.accountsImageDigest,
  environment: "production",
  accountsTrafficEnabled: "false",
  accountsSignupEnabled: "false",
  aegyoFreezeEnabled: "true",
  aegyoSharedAuthEnabled: "false",
  aegyoRequestsDrained: "true",
  directWritersPaused: "true",
  runId: "20260921t140000z-abcdef",
  sourceReadOnlyRole: "aegyo_cutover_reader_abcdef",
  sourceOwnerRole: "postgres",
  accountsOwnerRole: "postgres",
  expectedUsers: 55,
  expectedSourceTables: 51,
  sourceSchemaStatus: "additive-v1",
  sourceReaderUrl:
    "postgresql://reader:secret@aegyo-postgres.railway.internal:5432/kpopdb",
  sourceOwnerUrl:
    "postgresql://owner:secret@aegyo-postgres.railway.internal:5432/kpopdb",
  accountsOwnerUrl:
    "postgresql://owner:secret@accounts-postgres.railway.internal:5432/accounts_production",
  approvedSnapshotDigest: "a".repeat(64),
  approvedPreservationDigest: "c".repeat(64),
  approvedMappingDigest: "b".repeat(64),
  attestedOperatorServiceId: PRODUCTION.operatorServiceId,
  attestedAegyoServiceId: PRODUCTION.aegyoServiceId,
  attestedAegyoDeploymentId: "11111111-2222-3333-4444-555555555555",
  attestedAegyoRevision: reviewedRevision,
  attestedAccountsServiceId: PRODUCTION.accountsServiceId,
  attestedAccountsDeploymentId: "66666666-7777-8888-9999-aaaaaaaaaaaa",
  attestedAccountsImageDigest: PRODUCTION.accountsImageDigest,
  attestedFreezeEnabled: "true",
  attestedSharedAuthEnabled: "false",
  attestedAccountsTrafficEnabled: "false",
  attestedAccountsSignupEnabled: "false",
  attestedSourceDatabaseHost: "aegyo-postgres.railway.internal",
  attestedAccountsDatabaseHost: "accounts-postgres.railway.internal",
});

test("accepts an explicitly frozen production configuration and build-reviewed SHA", () => {
  assert.equal(validateProductionCutoverConfig(base()), true);
});

test("the runtime parser carries attestation and approvals into every valid phase", () => {
  for (const phase of ["inspect", "apply", "activate", "status"]) {
    const expected = base(phase);
    if (phase === "activate") {
      expected.accountsTrafficEnabled = "true";
      expected.attestedAccountsTrafficEnabled = "true";
      expected.aegyoSharedAuthEnabled = "true";
      expected.attestedSharedAuthEnabled = "true";
    }
    const bundle = {
      reviewedAegyoRevision: expected.reviewedAegyoRevision,
      requiredFreezeAncestor: expected.requiredFreezeAncestor,
      reviewedRevisionIncludesFreeze: true,
      liveAttestation: {
        phase,
        capturedAt: new Date().toISOString(),
        projectId: expected.projectId,
        environmentId: expected.environmentId,
        operatorServiceId: expected.operatorServiceId,
        aegyoServiceId: expected.attestedAegyoServiceId,
        sourceDatabaseServiceId: expected.sourceDatabaseServiceId,
        accountsServiceId: expected.accountsServiceId,
        accountsDatabaseServiceId: expected.accountsDatabaseServiceId,
        sourceDatabase: expected.sourceDatabase,
        accountsDatabase: expected.accountsDatabase,
        accountsBaseURL: expected.accountsBaseURL,
        aegyoBaseURL: expected.aegyoBaseURL,
        sourceNamespace: expected.sourceNamespace,
        aegyoDeploymentId: expected.aegyoDeploymentId,
        aegyoRevision: expected.aegyoRevision,
        aegyoBuildCommand: expected.aegyoBuildCommand,
        aegyoStartCommand: expected.aegyoStartCommand,
        aegyoPredeployCommand: expected.aegyoPredeployCommand,
        accountsDeploymentId: expected.accountsDeploymentId,
        accountsImageDigest: expected.accountsImageDigest,
        accountsEnvironment: "production",
        accountsTrafficEnabled: expected.accountsTrafficEnabled,
        accountsSignupEnabled: "false",
        aegyoFreezeEnabled: "true",
        aegyoSharedAuthEnabled: expected.aegyoSharedAuthEnabled,
        aegyoRequestsDrained: "true",
        directWritersPaused: "true",
        sourceDatabaseHost: expected.attestedSourceDatabaseHost,
        accountsDatabaseHost: expected.attestedAccountsDatabaseHost,
      },
    };
    const env = {
      RAILWAY_SERVICE_ID: PRODUCTION.operatorServiceId,
      ACCOUNTS_PRODUCTION_CUTOVER_CONFIRM: expected.confirm,
      ACCOUNTS_DATABASE_ROLE: expected.accountsRuntimeRole,
      ACCOUNTS_PRODUCTION_CUTOVER_RUN_ID: expected.runId,
      AEGYO_CUTOVER_READ_ONLY_ROLE: expected.sourceReadOnlyRole,
      AEGYO_CUTOVER_OWNER_ROLE: expected.sourceOwnerRole,
      ACCOUNTS_CUTOVER_OWNER_ROLE: expected.accountsOwnerRole,
      ACCOUNTS_IMPORT_EXPECTED_COUNT: String(expected.expectedUsers),
      AEGYO_CUTOVER_READER_DATABASE_URL: expected.sourceReaderUrl,
      AEGYO_CUTOVER_OWNER_DATABASE_URL: expected.sourceOwnerUrl,
      ACCOUNTS_CUTOVER_OWNER_DATABASE_URL: expected.accountsOwnerUrl,
      ACCOUNTS_IMPORT_APPROVED_DIGEST: expected.approvedSnapshotDigest,
      AEGYO_APPROVED_PRESERVATION_DIGEST: expected.approvedPreservationDigest,
      AEGYO_MAPPING_APPROVED_DIGEST: expected.approvedMappingDigest,
    };
    const actual = productionCutoverConfig(bundle, env, phase);
    assert.equal(
      actual.approvedPreservationDigest,
      expected.approvedPreservationDigest,
    );
    assert.equal(
      actual.attestedSourceDatabaseHost,
      expected.attestedSourceDatabaseHost,
    );
    assert.equal(validateProductionCutoverConfig(actual), true);
  }
});

test("refuses stale attestations and attestations captured for another phase", () => {
  const stale = base();
  stale.attestationCapturedAt = new Date(
    Date.now() - 31 * 60_000,
  ).toISOString();
  assert.throws(() => validateProductionCutoverConfig(stale));
  const wrongPhase = base("apply");
  wrongPhase.attestationPhase = "inspect";
  assert.throws(() => validateProductionCutoverConfig(wrongPhase));
});

for (const [label, mutate] of [
  ["project", (x) => (x.projectId = "wrong")],
  ["operator service", (x) => (x.operatorServiceId = "wrong")],
  ["source database service", (x) => (x.sourceDatabaseServiceId = "wrong")],
  ["Accounts database service", (x) => (x.accountsDatabaseServiceId = "wrong")],
  ["source database", (x) => (x.sourceDatabase = "clone")],
  ["Accounts traffic", (x) => (x.accountsTrafficEnabled = "true")],
  ["credential freeze", (x) => (x.aegyoFreezeEnabled = "false")],
  ["request drain", (x) => (x.aegyoRequestsDrained = "false")],
  ["direct writers", (x) => (x.directWritersPaused = "false")],
  ["shared auth", (x) => (x.aegyoSharedAuthEnabled = "true")],
  ["deployed SHA", (x) => (x.aegyoRevision = "d".repeat(40))],
  ["freeze ancestry", (x) => (x.reviewedRevisionIncludesFreeze = false)],
  [
    "public database",
    (x) =>
      (x.accountsOwnerUrl =
        "postgresql://u:p@proxy.example:5432/accounts_production"),
  ],
  [
    "wrong target",
    (x) =>
      (x.accountsOwnerUrl =
        "postgresql://u:p@accounts-postgres.railway.internal:5432/staging"),
  ],
  [
    "ordinary runtime URL",
    (x) => (x.ordinaryDatabaseUrl = "postgresql://forbidden"),
  ],
])
  test(`refuses ${label} drift`, () => {
    const input = base();
    mutate(input);
    assert.throws(
      () => validateProductionCutoverConfig(input),
      ProductionCutoverRefusal,
    );
  });

test("requires a reviewed digest for writes but permits status without a mapping digest", () => {
  const apply = base("apply");
  delete apply.approvedSnapshotDigest;
  assert.throws(() => validateProductionCutoverConfig(apply));
  const status = base("status");
  delete status.approvedMappingDigest;
  assert.equal(validateProductionCutoverConfig(status), true);
  const activate = base("activate");
  activate.accountsTrafficEnabled = "true";
  activate.attestedAccountsTrafficEnabled = "true";
  activate.aegyoSharedAuthEnabled = "true";
  activate.attestedSharedAuthEnabled = "true";
  delete activate.approvedMappingDigest;
  assert.throws(() => validateProductionCutoverConfig(activate));
});

test("uses the operator-reviewed fresh count rather than a historical population", () => {
  const config = base();
  assert.equal(
    assertFreshSnapshot({ count: 55, snapshotDigest: "a".repeat(64) }, config),
    true,
  );
  assert.throws(() =>
    assertFreshSnapshot({ count: 54, snapshotDigest: "a".repeat(64) }, config),
  );
  assert.throws(() =>
    assertFreshSnapshot(
      { count: 55, snapshotDigest: "b".repeat(64) },
      config,
      "a".repeat(64),
    ),
  );
});

test("accepts only the empty prepared production Accounts population", () => {
  const state = {
    database: "accounts_production",
    schemaVersion: 1,
    guardRevision: 2,
    clients: 3,
    users: 0,
    accounts: 0,
    sessions: 0,
    accessTokens: 0,
    refreshTokens: 0,
    jwks: 0,
    importBatches: 0,
  };
  assert.equal(assertEmptyAccountsTarget(state), true);
  assert.throws(() => assertEmptyAccountsTarget({ ...state, users: 1 }));
  assert.throws(() => assertEmptyAccountsTarget({ ...state, clients: 2 }));
  assert.throws(() =>
    assertEmptyAccountsTarget({ ...state, guardRevision: 1 }),
  );
});

test("accepts only the exact committed import population when resuming", () => {
  const state = {
    database: "accounts_production",
    schemaVersion: 1,
    guardRevision: 2,
    clients: 3,
    users: 55,
    accounts: 55,
    importBatches: 1,
  };
  assert.equal(assertImportedAccountsTarget(state, 55), true);
  assert.throws(() =>
    assertImportedAccountsTarget({ ...state, accounts: 54 }, 55),
  );
  assert.throws(() =>
    assertImportedAccountsTarget({ ...state, importBatches: 2 }, 55),
  );
});

test("activation requires persistent JWKS and no existing sessions or tokens", () => {
  const state = {
    database: "accounts_production",
    schemaVersion: 1,
    guardRevision: 2,
    clients: 3,
    users: 55,
    accounts: 55,
    importBatches: 1,
    sessions: 0,
    accessTokens: 0,
    refreshTokens: 0,
    jwks: 1,
  };
  assert.equal(assertActivationAccountsTarget(state, 55), true);
  for (const field of ["sessions", "accessTokens", "refreshTokens"])
    assert.throws(() =>
      assertActivationAccountsTarget({ ...state, [field]: 1 }, 55),
    );
  assert.throws(() =>
    assertActivationAccountsTarget({ ...state, jwks: 0 }, 55),
  );
});

const preservation = () => ({
  version: 1,
  database: "kpopdb",
  tables: Array.from({ length: 49 }, (_, index) => ({
    table: `public.Table${index}`,
    count: index,
    digest: index.toString(16).padStart(64, "0"),
  })),
});

test("detects content changes even when table counts and local IDs stay equal", () => {
  const before = preservation();
  const after = structuredClone(before);
  assert.equal(assertPreserved(before, after), true);
  after.tables[20].digest = "f".repeat(64);
  assert.throws(() => assertPreserved(before, after));
});

test("complete ownership changes are bound into the reviewed mapping digest", () => {
  const manifest = {
    version: 1,
    issuer: "https://account.aegyoarena.com/api/auth",
    localSnapshotDigest: "1".repeat(64),
    accountsSubjectsDigest: "2".repeat(64),
    rows: [
      {
        localUserId: "user-1",
        issuer: "https://account.aegyoarena.com/api/auth",
        subject: "subject-1",
        role: "admin",
        linkedRecordsDigest: "3".repeat(64),
      },
    ],
  };
  const edges = [
    { table: "KimchiRating", column: "userId" },
    { table: "PointEvent", column: "userId" },
    { table: "SuggestedEdit", column: "reviewedById" },
  ];
  const first = augmentManifestWithOwnership(manifest, {
    version: 1,
    edges,
    users: [{ localUserId: "user-1", digest: "4".repeat(64) }],
  });
  const changed = augmentManifestWithOwnership(manifest, {
    version: 1,
    edges,
    users: [{ localUserId: "user-1", digest: "5".repeat(64) }],
  });
  assert.notEqual(first.mappingDigest, changed.mappingDigest);
  assert.equal(first.rows[0].role, "admin");
  assert.throws(() =>
    augmentManifestWithOwnership(manifest, {
      version: 1,
      edges,
      users: [],
    }),
  );
});

test("the complete live User FK inventory is mandatory", () => {
  for (const edge of [
    "AnnotationComment.userId",
    "AnnotationVote.userId",
    "AuditLog.userId",
    "KimchiRating.userId",
    "LyricAnnotation.userId",
    "PointEvent.userId",
    "SuggestedEdit.reviewedById",
  ])
    assert.ok(REQUIRED_USER_OWNERSHIP_EDGES.includes(edge));
});

test("runtime user-id columns without legacy foreign keys remain ownership edges", () => {
  assert.deepEqual(LOGICAL_USER_OWNERSHIP_EDGES, [
    { table: "Follow", column: "followerId" },
    { table: "SlangVote", column: "userId" },
  ]);
  for (const { table, column } of LOGICAL_USER_OWNERSHIP_EDGES)
    assert.ok(REQUIRED_USER_OWNERSHIP_EDGES.includes(`${table}.${column}`));
});

test("restart status resumes committed import and mapping states without reimport", () => {
  const input = { expectedUsers: 55, latches: 0 };
  assert.equal(
    classifyProductionCutoverState({
      ...input,
      targetUsers: 0,
      importBatches: 0,
      mappings: 0,
    }),
    "not_started",
  );
  assert.equal(
    classifyProductionCutoverState({
      ...input,
      targetUsers: 55,
      importBatches: 1,
      mappings: 0,
    }),
    "imported_not_mapped",
  );
  assert.equal(
    classifyProductionCutoverState({
      ...input,
      targetUsers: 55,
      importBatches: 1,
      mappings: 55,
    }),
    "mapped_not_active",
  );
  assert.equal(
    classifyProductionCutoverState({
      ...input,
      latches: 1,
      targetUsers: 55,
      importBatches: 1,
      mappings: 55,
    }),
    "active",
  );
  assert.throws(() =>
    classifyProductionCutoverState({
      ...input,
      targetUsers: 12,
      importBatches: 1,
      mappings: 0,
    }),
  );
});

const recoveryEvidence = () => ({
  version: 1,
  capturedAt: new Date().toISOString(),
  sourceSnapshotDigest: "a".repeat(64),
  mappingDigest: "b".repeat(64),
  deliveryProviderIdDigest: "d".repeat(64),
  publicRecoveryRequested: true,
  delivered: true,
  resetCompleted: true,
  legacyPasswordSignin: true,
  oldPasswordRejected: true,
  priorSessionsRevoked: true,
  replayRejected: true,
  newPasswordSignin: true,
});

test("activation binds fresh public recovery evidence to the reviewed cutover", () => {
  const config = {
    approvedSnapshotDigest: "a".repeat(64),
    approvedMappingDigest: "b".repeat(64),
    recoveryProviderIdDigest: "d".repeat(64),
  };
  assert.equal(validateRecoveryEvidence(recoveryEvidence(), config), true);
  for (const field of [
    "publicRecoveryRequested",
    "delivered",
    "resetCompleted",
    "legacyPasswordSignin",
    "oldPasswordRejected",
    "priorSessionsRevoked",
    "replayRejected",
    "newPasswordSignin",
  ]) {
    const invalid = recoveryEvidence();
    invalid[field] = false;
    assert.throws(() => validateRecoveryEvidence(invalid, config));
  }
  for (const field of [
    "sourceSnapshotDigest",
    "mappingDigest",
    "deliveryProviderIdDigest",
  ]) {
    const invalid = recoveryEvidence();
    invalid[field] = "e".repeat(64);
    assert.throws(() => validateRecoveryEvidence(invalid, config));
  }
  const stale = recoveryEvidence();
  stale.capturedAt = new Date(Date.now() - 25 * 60 * 60_000).toISOString();
  assert.throws(() => validateRecoveryEvidence(stale, config));
});

test("emits an allowlisted aggregate evidence shape and sanitized failures", () => {
  const snapshot = preservation();
  const result = publicEvidence({
    phase: "inspect",
    status: "review_required",
    runId: "20260921t140000z-abcdef",
    sourceCount: 55,
    sourceSnapshotDigest: "a".repeat(64),
    preservationDigest: preservationDigest(snapshot),
    activationLatched: false,
    sourceQuietVerified: true,
    freezeVerified: true,
    deploymentVerified: true,
    password: "must-not-appear",
  });
  assert.equal(Object.hasOwn(result, "password"), false);
  assert.equal(result.sourceQuietVerified, true);
  const error = new Error("postgresql://user:password@private");
  error.code = "08006";
  assert.equal(
    sanitizedFailure(error, "mapping"),
    "production_cutover_failed(08006,mapping);run_status_before_retry",
  );
});
