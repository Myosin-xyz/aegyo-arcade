# Legacy Accounts importer

September 12, 2026. Executable operator tooling, tested with synthetic data in isolated PostgreSQL. **Not approval to copy production users or open shared login.** The existing backup/restore, email, three-origin browser and cutover acceptance gates still apply.

The tool is `services/accounts/scripts/import-legacy.mjs`, using the pinned Node 24.21.0 runtime. It does not load environment files. An ordinary `DATABASE_URL` is rejected. No importer runs during Accounts startup or an application build.

## What it does

`snapshot` reads the complete Aegyo `User` population in a repeatable-read, read-only transaction and rolls it back. It checks the expected database name and expected user count. It copies only the fields necessary for identity and legacy password verification. Existing local records, roles, newsletter subscriptions, wallets and activity remain untouched. The separate ownership reconciler remains necessary to verify those records.

`init-journal` explicitly installs `aegyo_import.batches` and `aegyo_import.identities` in a separate, operator-only schema. This leaves the provider's recorded public schema inventory unchanged. It requires the supported Accounts schema marker, denies runtime access, and refuses an already-existing journal schema for operator inspection. Do not grant the application access later. Journal foreign keys intentionally prevent deleting imported users or their credential accounts behind the journal's back; a future deletion policy must account for this explicitly.

`apply` re-reads the complete source and requires its digest to match the privately reviewed snapshot. It serializes concurrent imports, locks target user/credential/journal writes and commits all imported users, credential accounts and exact source-ID mappings together. Accounts subjects are new opaque IDs. Imported users receive the Accounts `user` role, never Aegyo's owner/admin role. A normalized email collision aborts; email is never a linking rule.

Before any target insert, `apply` also verifies a known staff/canary user's password against that user's actual source hash using the chosen legacy pepper, and checks that pepper against a privately recorded SHA-256 fingerprint from the reviewed target deployment configuration. This prevents a successful copy with unusable legacy passwords due to a mismatched pepper. The deployment fingerprint must come from the target environment, not be invented by hashing an unverified local value. The CLI cannot independently attest remote Railway variables; config provenance and a staged real sign-in remain required evidence.

Only one complete source population can be imported into an Accounts database. An exact repeated batch returns its stored mappings without writing credentials or security state. A changed source, issuer or namespace fails closed. Interrupted commit acknowledgement is explicitly reported as uncertain. `status` resolves that uncertainty from the journal; no operator should infer rollback from a disconnected process.

## Preparation and freeze

1. Rehearse with an isolated restored source and an isolated Accounts target. Confirm the restore and ownership reconciliation separately. Use the reviewed exact source namespace (Railway project/environment/service), issuer and connection bindings. A database name alone does not distinguish Railway projects.
2. Initialize Accounts with the reviewed schema migration and a separate runtime role. Initialize the import journal using the owner/operator connection, never the runtime connection. Keep target public signup, login and recovery traffic closed.
3. Deploy the Aegyo adapter with all legacy credential writers closed and no cutover latch. Verify signup, recovery, old reset tokens, login and any operator password writer cannot change credentials. The freeze must cover every deployed writer, including old application instances. Preserve existing read access where the reviewed application policy permits it.
4. Keep that freeze in place throughout snapshot, copy, mapping installation, reconciliation and final latch activation. The CLI confirmation acknowledges this external condition; it does **not** establish or prove the freeze. Re-reading the source detects drift before the copy but cannot prevent an un-frozen writer racing the target commit. Any freeze violation requires stopping the cutover and reconciling, never reimporting over changed Accounts credentials.

## Operator environment

Use an authorized private shell/environment. Never paste secrets or a snapshot into chat or commit them. Input/output files must live under the ignored `services/accounts/.proof` directory, within the authorized environment. Pre-create their parent directory with mode 0700. The CLI creates output files exclusively with mode 0600, refuses symlinks or broadly readable inputs, and never prints identities, passwords, raw database errors or connection URLs.

Common configuration:

- `ACCOUNTS_IMPORT_ISSUER`: exact final HTTPS OIDC issuer including `/api/auth`, with no trailing slash; this must equal the served discovery document and each adapter’s configured issuer.
- `ACCOUNTS_IMPORT_SOURCE_NAMESPACE`: reviewed source project/environment/service identifier.
- `ACCOUNTS_IMPORT_SOURCE_DATABASE_URL` and `ACCOUNTS_IMPORT_SOURCE_DATABASE_NAME`: source read-only connection and expected database.
- `ACCOUNTS_IMPORT_TARGET_DATABASE_URL` and `ACCOUNTS_IMPORT_TARGET_DATABASE_NAME`: dedicated Accounts operator connection and expected database.
- Each connection family accepts its own `_DATABASE_CA_CERT` and `_DATABASE_SERVER_SHA256`. Use the existing reviewed Railway certificate/pin procedure for public TCP proxies; do not disable certificate verification.
- `ACCOUNTS_LEGACY_PEPPER`: the exact value privately transferred into the target deployment. `ACCOUNTS_IMPORT_CREDENTIAL_PROOF`: a private 0600 JSON file containing `sourceUserId`, the known canary `password`, and `deployedPepperDigest` read from the reviewed target configuration. This file is required only for `apply`, contains a password, and must have short restricted retention. Do not obtain an ordinary user's password; use an authorized staff/canary identity included in the frozen source population.

Run the script from the Accounts service directory. Required per-command fields:

| Command                                       | Additional fields                                                                                                                                                     |
| --------------------------------------------- | --------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| `node scripts/import-legacy.mjs init-journal` | `ACCOUNTS_DATABASE_ROLE`; `ACCOUNTS_IMPORT_CONFIRM=install-operator-only-journal`                                                                                     |
| `node scripts/import-legacy.mjs snapshot`     | `ACCOUNTS_IMPORT_EXPECTED_COUNT`; new `ACCOUNTS_IMPORT_OUTPUT`; `ACCOUNTS_IMPORT_CONFIRM=read-only-private-source-snapshot`                                           |
| `node scripts/import-legacy.mjs apply`        | `ACCOUNTS_IMPORT_INPUT`; reviewed `ACCOUNTS_IMPORT_APPROVED_DIGEST`; new `ACCOUNTS_IMPORT_OUTPUT`; `ACCOUNTS_IMPORT_CONFIRM=source-writers-and-target-traffic-frozen` |
| `node scripts/import-legacy.mjs status`       | `ACCOUNTS_IMPORT_INPUT`; reviewed `ACCOUNTS_IMPORT_APPROVED_DIGEST`; new `ACCOUNTS_IMPORT_OUTPUT`                                                                     |

`snapshot` prints only the population count and digest for review. Snapshot files contain credential hashes and personal data and require restricted retention. The copy output contains only exact mapping pairs and Accounts subjects, with no emails/hashes. Its `mapping` and `accounts` objects match the inputs to Aegyo's existing reconciliation CLI. Keep the output private as it still contains identifiers.

The importer deliberately does not install mappings or activate the Aegyo latch. That is a separately reviewed local-database transaction after complete role/ownership reconciliation. It also does not migrate Daebak identities: those require explicit proof of both existing sessions.

## Recovery

- Before commit, a failed batch rolls back every target insert. Source rows are never modified.
- After a connection failure during commit, leave the freeze on and run `status` with the same approved snapshot and a fresh output path. A complete matching journal is evidence of commit. No journal means that batch is absent; inspect the failed operation before an authorized retry.
- If the output path is already present or disk writing fails after commit, use `status` with a fresh output path. Do not delete imported users to recreate an output file.
- An exact retry after a successful password recovery returns the prior mapping and leaves the new password, reset timestamp and security versions unchanged. Source drift or partial journal integrity failures require investigation; the tool never repairs them by overwriting credentials.

## Evidence

Pinned Linux Node 24.21.0: `docker build --target proof -t aegyo-accounts-proof:importer-reviewed-20260912 services/accounts`, then `docker run --rm --network none aegyo-accounts-proof:importer-reviewed-20260912`. Passed 26 unit/runtime/UI/email tests and 39 PostgreSQL tests, zero skips. Image `sha256:47ed98120c7ab28912e5a2ef4d228368d19951b5af3651356127dcdfa7bcf6d1`.

The new tests execute the actual importer and CLI: complete read-only source capture, database pinning, private files, runtime journal denial, normalized email collision, rollback after the first user, lost commit acknowledgement, concurrent exact retries, actual legacy sign-in, actual provider recovery, no credential/security overwrite, namespace changes, source drift and sanitized output. An initial local test run hung during test teardown because a checked-out client was released after pool shutdown; the cleanup order was corrected before the passing Linux run. The later issuer assertion initially ran discovery before creating the disposable provider schema; moving it after the migration resolved that test setup failure. The final passing image above verifies the actual discovery issuer, not just a fixture string. Review also found that a large valid population could serialize beyond the reader’s 16 MiB limit; capture and writing now enforce the same UTF-8 byte limit before producing an artifact, with an exact-boundary test. The final image includes that fix and the verification-link UI change. No production snapshot, user copy, migration or deployment was performed.
