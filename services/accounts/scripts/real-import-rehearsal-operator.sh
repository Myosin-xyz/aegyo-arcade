#!/bin/bash
set -eu
set -o pipefail
umask 077
fail() { echo "operator_error=$1" >&2; exit "${2:-4}"; }
required() { eval "v=\${$1-}"; [ -n "$v" ] || fail missing_configuration 2; }
for n in ACCOUNTS_REAL_IMPORT_REHEARSAL_PHASE SOURCE_DATABASE_NAME SOURCE_READ_ONLY_ROLE \
 REHEARSAL_LEGACY_DATABASE_NAME REHEARSAL_DATABASE_OWNER_ROLE REHEARSAL_POSTGRES_SERVICE_ID \
 REHEARSAL_ACCOUNTS_DATABASE_NAME ACCOUNTS_DATABASE_ROLE ACCOUNTS_REAL_EXPECTED_TABLES \
 ACCOUNTS_IMPORT_SOURCE_NAMESPACE ACCOUNTS_IMPORT_EXPECTED_COUNT ACCOUNTS_BASE_URL AEGYO_AUTH_BASE_URL \
 AEGYO_SOURCE_COMMIT RAILWAY_PROJECT_ID RAILWAY_ENVIRONMENT_ID RAILWAY_SERVICE_ID SOURCE_DATABASE_SERVICE_ID; do required "$n"; done
phase="$ACCOUNTS_REAL_IMPORT_REHEARSAL_PHASE"
case "$phase" in
 inspect) for n in SOURCE_DATABASE_URL REHEARSAL_LEGACY_OWNER_DATABASE_URL SOURCE_DATABASE_CA_CERT REHEARSAL_DATABASE_CA_CERT REHEARSAL_DATABASE_SERVER_SHA256; do required "$n"; done ;;
 apply) for n in REHEARSAL_LEGACY_OWNER_DATABASE_URL REHEARSAL_LEGACY_READER_DATABASE_URL ACCOUNTS_IMPORT_TARGET_DATABASE_URL REHEARSAL_DATABASE_CA_CERT ACCOUNTS_IMPORT_TARGET_DATABASE_CA_CERT REHEARSAL_DATABASE_SERVER_SHA256 ACCOUNTS_IMPORT_TARGET_DATABASE_SERVER_SHA256 ACCOUNTS_IMPORT_APPROVED_DIGEST ACCOUNTS_REAL_DEPLOYED_PEPPER_DIGEST ACCOUNTS_LEGACY_PEPPER ACCOUNTS_REAL_CANARY_PASSWORD ACCOUNTS_REAL_CANARY_EMAIL ACCOUNTS_REAL_CANARY_SOURCE_USER_ID ACCOUNTS_DATABASE_ROLE_PASSWORD BETTER_AUTH_SECRET; do required "$n"; done ;;
 *) fail invalid_phase 2 ;;
esac
work="/operator/accounts/.proof/real-import-$phase"
[ ! -e "$work" ] || fail prior_operator_artifacts_require_inspection 2
mkdir -m 700 "$work"
trap 'code=$?; [ "$code" = 0 ] || echo operator_error=real_import_rehearsal_failed >&2' EXIT HUP INT TERM
node /operator/accounts/scripts/validate-real-import-rehearsal.mjs >"$work/validate.log" 2>&1 || fail configuration_refused 2

if [ "$phase" = inspect ]; then
# The proven Aegyo restore operator compares every original table row under one
# exported snapshot before this process touches either rehearsal database.
SOURCE_DATABASE_NAME="${SOURCE_DATABASE_NAME}" \
TARGET_DATABASE_URL="$REHEARSAL_LEGACY_OWNER_DATABASE_URL" \
SOURCE_DATABASE_TLS_HOST=localhost TARGET_DATABASE_TLS_HOST=localhost \
TARGET_DATABASE_NAME="$REHEARSAL_LEGACY_DATABASE_NAME" \
TARGET_DATABASE_CA_CERT="$REHEARSAL_DATABASE_CA_CERT" \
TARGET_OWNER_ROLE="$REHEARSAL_DATABASE_OWNER_ROLE" \
AEGYO_REAL_RESTORE_CONFIRM=private-read-only-source-to-empty-clone \
bash /operator/aegyo/scripts/shared-auth/real-restore-operator.sh >"$work/restore.log" 2>&1 || fail restore_or_fingerprint_failed
grep -qx 'full_row_fingerprints_match=true' "$work/restore.log" || fail restore_fingerprint_missing
grep -qx "verified_table_count=$ACCOUNTS_REAL_EXPECTED_TABLES" "$work/restore.log" || fail restored_table_count_mismatch

export ACCOUNTS_IMPORT_SOURCE_DATABASE_URL="$REHEARSAL_LEGACY_OWNER_DATABASE_URL"
export ACCOUNTS_IMPORT_SOURCE_DATABASE_NAME="$REHEARSAL_LEGACY_DATABASE_NAME"
export ACCOUNTS_IMPORT_SOURCE_DATABASE_CA_CERT="$REHEARSAL_DATABASE_CA_CERT"
export ACCOUNTS_IMPORT_SOURCE_DATABASE_SERVER_SHA256="$REHEARSAL_DATABASE_SERVER_SHA256"
export ACCOUNTS_IMPORT_ISSUER="$ACCOUNTS_BASE_URL/api/auth"
export ACCOUNTS_IMPORT_OUTPUT="$work/snapshot.json"
export ACCOUNTS_IMPORT_CONFIRM=read-only-private-source-snapshot
snapshot_result="$(node /operator/accounts/scripts/import-legacy.mjs snapshot 2>"$work/snapshot.err")" || fail source_snapshot_failed
printf '%s' "$snapshot_result" | node -e 'let s="";process.stdin.on("data",d=>s+=d).on("end",()=>{const x=JSON.parse(s.trim().split(/\n/).at(-1));console.log(JSON.stringify({count:x.count,snapshotDigest:x.snapshotDigest}))})' || fail snapshot_result_invalid
echo 'immutable_clone_ready=true'
echo 'operator_complete=true'
exit 0
fi

export ACCOUNTS_MIGRATION_DATABASE_URL="$ACCOUNTS_IMPORT_TARGET_DATABASE_URL"
export ACCOUNTS_MIGRATION_DATABASE_NAME="$REHEARSAL_ACCOUNTS_DATABASE_NAME"
export ACCOUNTS_MIGRATION_DATABASE_CA_CERT="$ACCOUNTS_IMPORT_TARGET_DATABASE_CA_CERT"
export ACCOUNTS_MIGRATION_DATABASE_SERVER_SHA256="$ACCOUNTS_IMPORT_TARGET_DATABASE_SERVER_SHA256"
export ACCOUNTS_MIGRATION_CONFIRM=dedicated-accounts-database
export ACCOUNTS_ENVIRONMENT=staging
node /operator/accounts/scripts/migrate.mjs >"$work/migrate.log" 2>&1 || fail accounts_migration_failed

export ACCOUNTS_IMPORT_SOURCE_DATABASE_URL="$REHEARSAL_LEGACY_READER_DATABASE_URL"
export ACCOUNTS_IMPORT_SOURCE_DATABASE_NAME="$REHEARSAL_LEGACY_DATABASE_NAME"
export ACCOUNTS_IMPORT_ISSUER="$ACCOUNTS_BASE_URL/api/auth"
export ACCOUNTS_IMPORT_SOURCE_DATABASE_CA_CERT="$REHEARSAL_DATABASE_CA_CERT"
export ACCOUNTS_IMPORT_SOURCE_DATABASE_SERVER_SHA256="$REHEARSAL_DATABASE_SERVER_SHA256"
export ACCOUNTS_IMPORT_TARGET_DATABASE_NAME="$REHEARSAL_ACCOUNTS_DATABASE_NAME"
export ACCOUNTS_IMPORT_OUTPUT="$work/snapshot.json"
export ACCOUNTS_IMPORT_CONFIRM=read-only-private-source-snapshot
snapshot_result="$(node /operator/accounts/scripts/import-legacy.mjs snapshot 2>"$work/snapshot.err")" || fail source_snapshot_failed
actual_digest="$(printf '%s' "$snapshot_result" | node -e 'let s="";process.stdin.on("data",d=>s+=d).on("end",()=>{try{process.stdout.write(JSON.parse(s.trim().split(/\n/).at(-1)).snapshotDigest)}catch{process.exit(2)}})')" || fail snapshot_result_invalid
[ "$actual_digest" = "$ACCOUNTS_IMPORT_APPROVED_DIGEST" ] || fail reviewed_snapshot_digest_mismatch

node -e 'const fs=require("fs");fs.writeFileSync(process.argv[1],JSON.stringify({sourceUserId:process.env.ACCOUNTS_REAL_CANARY_SOURCE_USER_ID,password:process.env.ACCOUNTS_REAL_CANARY_PASSWORD,deployedPepperDigest:process.env.ACCOUNTS_REAL_DEPLOYED_PEPPER_DIGEST})+"\n",{mode:0o600,flag:"wx"})' "$work/credential.json"
chmod 600 "$work/credential.json"
export ACCOUNTS_IMPORT_CREDENTIAL_PROOF="$work/credential.json"
export ACCOUNTS_IMPORT_INPUT="$work/snapshot.json"
export ACCOUNTS_IMPORT_OUTPUT="$work/imported.json"
export ACCOUNTS_IMPORT_CONFIRM=install-operator-only-journal
node /operator/accounts/scripts/import-legacy.mjs init-journal >"$work/journal.log" 2>&1 || fail journal_install_failed
export ACCOUNTS_IMPORT_CONFIRM=source-writers-and-target-traffic-frozen
node /operator/accounts/scripts/import-legacy.mjs apply >"$work/import.log" 2>&1 || fail import_failed_or_uncertain

# Build the real Aegyo reconciliation inputs privately. Full-row preservation is
# already established above; this snapshot adds exact ID/role coverage.
export ACCOUNTS_REAL_LOCAL_STATE_OUTPUT="$work/local-before.json"
node /operator/accounts/scripts/snapshot-aegyo-local-state.mjs >"$work/local-before.log" 2>"$work/aegyo.err" || fail local_snapshot_failed
cp "$work/local-before.json" "$work/local-after.json"
cp "$work/imported.json" "$work/transfer.json"
node -e 'const fs=require("fs"),x=JSON.parse(fs.readFileSync(process.argv[1]));fs.writeFileSync(process.argv[2],JSON.stringify(x.accounts));fs.writeFileSync(process.argv[3],JSON.stringify(x.mapping))' "$work/transfer.json" "$work/accounts.json" "$work/mapping.json"
node /operator/aegyo/scripts/shared-auth/reconcile.mjs "$work/local-before.json" "$work/accounts.json" "$work/mapping.json" "$work/local-after.json" "$work/manifest.json" >"$work/reconcile.log" 2>&1 || fail reconciliation_failed

# Apply the additive Aegyo schema through libpq TLS with certificate identity localhost.
printf '%s\n' "$REHEARSAL_DATABASE_CA_CERT" >"$work/legacy-ca.pem"
legacy_host="$(node -e 'process.stdout.write(new URL(process.env.REHEARSAL_LEGACY_OWNER_DATABASE_URL).hostname)')"
legacy_addr="$(getent ahosts "$legacy_host" | awk 'NR==1{print $1}')"
[ -n "$legacy_addr" ] || fail private_database_resolution_failed
legacy_psql_url="${REHEARSAL_LEGACY_OWNER_DATABASE_URL}?host=localhost&hostaddr=${legacy_addr}"
PGSSLMODE=verify-full PGSSLROOTCERT="$work/legacy-ca.pem" psql -X -q "$legacy_psql_url" -v ON_ERROR_STOP=1 -f /operator/aegyo/prisma/migrations/20260911200000_add_shared_auth/migration.sql >"$work/additive.log" 2>&1 || fail additive_schema_failed

# Prisma connects to localhost through a raw TCP relay. TLS and SCRAM channel
# binding remain end-to-end between Prisma and PostgreSQL; the relay never
# terminates or decrypts the connection and listens only on container loopback.
export AEGYO_RELAY_TARGET_HOST="$legacy_host" AEGYO_RELAY_TARGET_PORT=5432
node /operator/accounts/scripts/private-tcp-relay.mjs >"$work/relay.log" 2>&1 & bridge=$!
trap 'kill ${bridge-} 2>/dev/null || true; code=$?; [ "$code" = 0 ] || echo operator_error=real_import_rehearsal_failed >&2' EXIT HUP INT TERM
sleep 1; kill -0 "$bridge" 2>/dev/null || fail verified_tcp_relay_failed
export AEGYO_MAPPING_DATABASE_URL="$(node -e 'const u=new URL(process.env.REHEARSAL_LEGACY_OWNER_DATABASE_URL);u.hostname="localhost";u.port="6543";u.search="?sslmode=require&sslaccept=strict&sslcert="+encodeURIComponent(process.argv[1]);process.stdout.write(u.href)' "$work/legacy-ca.pem")"
export AEGYO_MAPPING_DATABASE_NAME="$REHEARSAL_LEGACY_DATABASE_NAME" AEGYO_AUTH_BASE_URL
export AEGYO_MAPPING_MANIFEST="$work/manifest.json"
export AEGYO_MAPPING_APPROVED_DIGEST="$(node -e 'const x=require(process.argv[1]);process.stdout.write(x.mappingDigest)' "$work/manifest.json")"
export AEGYO_MAPPING_CONFIRM=install-reviewed-mappings-without-latch
(cd /operator/aegyo && node scripts/shared-auth/install-mappings.mjs apply) >"$work/mapping.log" 2>&1 || fail mapping_install_failed
export AEGYO_MAPPING_CONFIRM=activate-reviewed-shared-auth-cutover
(cd /operator/aegyo && node scripts/shared-auth/install-mappings.mjs activate) >"$work/activate.log" 2>&1 || fail rehearsal_activation_failed
(cd /operator/aegyo && node scripts/shared-auth/install-mappings.mjs status) >"$work/status.log" 2>&1 || fail mapping_status_failed
node -e 'const fs=require("fs"),x=JSON.parse(fs.readFileSync(process.argv[1],"utf8"));if(x.count!==Number(process.env.ACCOUNTS_IMPORT_EXPECTED_COUNT)||x.mappingDigest!==process.env.AEGYO_MAPPING_APPROVED_DIGEST||x.active!==true)process.exit(2)' "$work/status.log" || fail mapping_coverage_or_activation_mismatch

export ACCOUNTS_REAL_LOCAL_STATE_OUTPUT="$work/local-after-actual.json"
node /operator/accounts/scripts/snapshot-aegyo-local-state.mjs >"$work/local-after.log" 2>>"$work/aegyo.err" || fail post_mapping_snapshot_failed
node /operator/aegyo/scripts/shared-auth/reconcile.mjs "$work/local-before.json" "$work/accounts.json" "$work/mapping.json" "$work/local-after-actual.json" "$work/manifest-after.json" >"$work/reconcile-after.log" 2>&1 || fail post_mapping_reconciliation_failed
cmp -s "$work/manifest.json" "$work/manifest-after.json" || fail reconciliation_digest_changed

export ACCOUNTS_REAL_CANARY_CONFIRM=verify-imported-team-canary
node /operator/accounts/scripts/verify-real-canary-signin.mjs >"$work/canary.log" 2>&1 || fail imported_canary_signin_failed
rm -f "$work/credential.json"
kill "$bridge" 2>/dev/null || true; wait "$bridge" 2>/dev/null || true; bridge=
echo 'restore_fingerprints=true'
echo 'mapping_coverage=true'
echo 'rehearsal_activation=true'
echo 'imported_canary_signin=true'
echo 'operator_complete=true'
