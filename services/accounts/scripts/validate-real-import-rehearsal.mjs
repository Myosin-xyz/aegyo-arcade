#!/usr/bin/env node
import { sanitizedFailure, validateRealImportRehearsal } from "./real-import-rehearsal-lib.mjs";

const required = (name) => process.env[name] ?? "";
try {
  validateRealImportRehearsal({
    confirm: required("ACCOUNTS_REAL_IMPORT_REHEARSAL_CONFIRM"),
    projectId: required("RAILWAY_PROJECT_ID"),
    environmentId: required("RAILWAY_ENVIRONMENT_ID"),
    restoredPostgresServiceId: required("REHEARSAL_POSTGRES_SERVICE_ID"),
    operatorServiceId: required("RAILWAY_SERVICE_ID"),
    sourceServiceId: required("SOURCE_DATABASE_SERVICE_ID"),
    aegyoCommit: required("AEGYO_SOURCE_COMMIT"),
    trafficEnabled: required("ACCOUNTS_TRAFFIC_ENABLED"),
    signupEnabled: required("ACCOUNTS_SIGNUP_ENABLED"),
    ordinaryDatabaseUrl: process.env.DATABASE_URL,
    sourceDatabase: required("SOURCE_DATABASE_NAME"),
    expectedTables: Number(required("ACCOUNTS_REAL_EXPECTED_TABLES")),
    sourceNamespace: required("ACCOUNTS_IMPORT_SOURCE_NAMESPACE"),
    accountsBaseURL: required("ACCOUNTS_BASE_URL"),
    aegyoBaseURL: required("AEGYO_AUTH_BASE_URL"),
    legacyDatabase: required("REHEARSAL_LEGACY_DATABASE_NAME"),
    accountsDatabase: required("REHEARSAL_ACCOUNTS_DATABASE_NAME"),
    sourceRole: required("SOURCE_READ_ONLY_ROLE"),
    accountsRuntimeRole: required("ACCOUNTS_DATABASE_ROLE"),
    expectedUsers: Number(required("ACCOUNTS_IMPORT_EXPECTED_COUNT")),
    canarySourceUserId: required("ACCOUNTS_REAL_CANARY_SOURCE_USER_ID"),
    approvedSnapshotDigest: required("ACCOUNTS_IMPORT_APPROVED_DIGEST"),
    deployedPepperDigest: required("ACCOUNTS_REAL_DEPLOYED_PEPPER_DIGEST"),
    urls: {
      source: required("SOURCE_DATABASE_URL"),
      legacy: required("REHEARSAL_LEGACY_DATABASE_URL"),
      accounts: required("ACCOUNTS_IMPORT_TARGET_DATABASE_URL"),
    },
  });
  console.info("real_import_rehearsal_configuration_valid=true");
} catch (error) {
  console.error(sanitizedFailure(error, "configuration"));
  process.exitCode = 2;
}
