# Aegyo Accounts service

Separate Better Auth service inside the Arcade repository. Deploy it independently from Arcade, in the existing `aegyo-arcade` Railway project and a dedicated Accounts environment/database. Its OIDC issuer is `<ACCOUNTS_BASE_URL>/api/auth`. The three products keep their own local data and product sessions.

The service now includes EN/ES account pages, Mailjet delivery support, database-backed rate limiting, atomic password/reset session guards, an authenticated session-state endpoint, restricted-role readiness checks, and explicit migration/synthetic bootstrap commands. Arcade has a feature-flagged client adapter with a real staging browser proof. The main-site adapter and Daebak binding foundation are being developed in separate repository branches; production migration/rehash and full cross-product browser acceptance remain unfinished. See [deployment runbook](../../docs/ACCOUNTS_DEPLOYMENT.md) and [current evidence](../../docs/AUTH_PROOF_PROGRESS.md).

Production starts dormant unless `ACCOUNTS_TRAFFIC_ENABLED=true` exactly. Dormant mode initializes no database, provider, or mail client, serves only `/healthz`, and returns 503 for every other route. Use `/healthz` as Railway's deploy check during provisioning. Activation requires the complete production configuration and a simultaneous switch back to `/readyz`; it does not enable signup.

```sh
cd services/accounts
npm ci
npm test
npm run proof
```

Select **Node 24.21.0** (pinned in `.node-version` and `package.json`) before installing or running the package. Local PostgreSQL binaries (`initdb`, `pg_ctl`) are also required. Package installation and the test/proof commands reject other Node versions; the proof checks and prints the runtime before creating a database. `npm test` runs password, runtime and UI checks; `npm run proof` starts a disposable PostgreSQL cluster and runs the provider checks. The latter uses the actual Better Auth request handler and verified JWT signatures with three synthetic HTTPS client origins; it does not substitute for a real-browser staging test. It never reads `DATABASE_URL`, loads `.env`, contacts a production database or sends email.

The proof now installs an explicit PostgreSQL credential trigger after the empty database schema. A password update, its timestamp/version and revocation of IdP sessions commit together. A second trigger rejects sessions using an older credential version captured before verification. The proof includes hook/database failures and concurrent login/reset, in addition to signed claims for all three clients. See [credential transition evidence](../../docs/CREDENTIAL_TRANSITION_PROOF.md) for the exact boundary and remaining gates. Direct-change/admin password routes are disabled in this local candidate; recovery remains available. This is not a production UX change or approval to remove existing app features.

Local cluster data/logs remain in ignored `.proof` directories with private permissions; the server stops afterward. The socket is private and local, with no TCP listener. The short socket path under `/tmp` accommodates macOS path limits. No existing PostgreSQL service is started, stopped or modified.

Pinned versions and the lockfile belong only to this package. Do not add it to Arcade's Vercel startup/build or run schema changes automatically on an application build. Use the separate Railway deploy/watch paths and explicit owner migration documented in the runbook. These scripts never create Railway resources or mutate existing product databases.

The Docker runtime is pinned to the same version and has been tested on Linux ARM64. Browser acceptance is a separate staging gate. Node upgrades require updating both runtime pins and rerunning the proof.

`npm run mail:preflight -- --source accounts` checks Mailjet sender metadata using environment-injected credentials. Use `--source aegyo` for the existing site's variable names. The check is read-only, sends no email, loads no `.env`, and prints no credentials or addresses. A successful sender check does not prove delivery or quota headroom. The live September 12 check found the existing Mailjet account blocked. Resend is also supported through `ACCOUNTS_MAIL_MODE=resend`, `RESEND_API_KEY` and `RESEND_FROM_EMAIL`; it is not yet configured. Follow the [current email decision](../../docs/TRANSACTIONAL_EMAIL_DECISION.md) before enabling either transport in staging.

Legacy password verification remains available, but automatic first-login rehash is disabled. The [upgrade analysis](../../docs/LEGACY_PASSWORD_UPGRADE.md) records the guarded candidate, required race proofs and its possible one-time session revocation. Do not remove the legacy pepper while retained credentials require it.

`scripts/seed-staging.mjs` is an explicit, one-time synthetic bootstrap for an already migrated, empty dedicated staging database. It refuses production mode, ordinary `DATABASE_URL`, nonempty user tables, unregistered output locations, and reruns. It creates users and OAuth clients through Better Auth, records verification mail without network delivery, disables its temporary operator, and writes the synthetic member credentials and client secrets only to an exclusive `0600` file beneath `services/accounts/.proof`. Configure the three HTTPS product clients and all `ACCOUNTS_STAGING_*` gates documented by the script; run it only from the pinned Node runtime and never as service startup or deployment automation.

The [legacy account-copy rehearsal](../../docs/LEGACY_COPY_REHEARSAL.md) adds transactional copy/rollback, explicit source-ID mappings, email-collision rejection, and recovery-safe re-run checks using synthetic rows and the real provider handler. It is a local proof, not a production import CLI.

The subsequent [operator import tool](../../docs/LEGACY_IMPORT_RUNBOOK.md) is executable through `scripts/import-legacy.mjs`. It adds private read-only snapshots, an operator-only durable journal, exact OIDC issuer and password-configuration checks, atomic inserts, and recovery after uncertain commits. Its real CLI/database tests run in the disposable proof. Production use still requires the documented source freeze, restore, configuration and reconciliation gates; this tool neither activates Aegyo nor changes Daebak identities.

## Shared automatic account deletion (pending activation)

The web and mobile apps share `/delete-account?lang=en|es`. It requires a recent (15-minute) provider sign-in and explicit confirmation. `POST /api/account-deletion` checks same origin and policy version `2026-10-20.1`; it atomically creates a durable job and revokes/bans shared access. A Secure, HttpOnly, SameSite=Strict host cookie grants access to that request's status for 30 days. GET returns `processing`, `needs_review` or `completed`, product manifests and the original policy version. An active new account cannot consume a prior account's receipt.

The existing Accounts process runs a durable worker every five seconds. It claims jobs with a two-minute lease, retries failures after one minute and skips already acknowledged participants. Each product records its own idempotent receipt. Ambiguous Social records do not stop Arcade/Daebak processing or central credential removal. Once all products acknowledge, credentials, OAuth grants, recovery rows and profile PII are removed; a banned subject tombstone and deletion receipt remain. `needs_review` records require operator reconciliation, not automatic guesswork. The public UI shows readable scope/status; category/count manifests are available from the authenticated receipt API.

### Deployment order

1. Apply owning-product migrations first (Social account deletion, Arcade 0005, Daebak 0007). Configure distinct `AEGYO_ACCOUNT_DELETION_KEY` values and verify each participant's authenticated GET preflight. These keys must not be shipped to mobile.
2. With the pinned Node 24.21.0 runtime, run `scripts/install-deletion.mjs` using an owner `ACCOUNTS_MIGRATION_DATABASE_URL`, exact `ACCOUNTS_MIGRATION_DATABASE_NAME`, restricted `ACCOUNTS_DATABASE_ROLE` and `ACCOUNTS_DELETION_SCHEMA_CONFIRM=install-account-deletion`. Do not set `DATABASE_URL` for this installer. It checks the dedicated-database marker and grants only schema/job access and the two scoped SECURITY DEFINER functions. It does not activate deletion. The separate `account_deletion` schema avoids changing the existing public-table inventory.
3. Set `ACCOUNTS_DELETION_PARTICIPANTS_JSON` to an object with exactly `social`, `arcade`, `daebak`, each `{url:"https://<owning-host>/api/internal/account-deletion",key:"<separate-secret>"}`. Set `ACCOUNTS_DELETION_ENABLED=true` only after migration and participant checks. Every new request repeats the three preflights before revoking its login. Keep the Accounts process running for retries and monitor oldest processing jobs, retry counts and the `needs_review` queue.
4. Validate in staging with synthetic accounts. Restore procedures must replay deletion receipts/tombstones before restored data serves traffic. Publish approved retention durations for backup/export copies, minimal deletion receipts and retained wallet/financial data. A lost status cookie requires operator lookup; it does not cancel the durable request.

Daebak deliberately retains the wallet/Privy recovery identity and user association, financial records and onchain capabilities. Social records without reliable ownership and external newsletter copies are flagged with private reconciliation references. These retained categories are not anonymous and must be disclosed. Anonymous Arcade device history is separate from shared-account identity.

`AEGYO_DELETION_PG_TEST=1 npm run test:deletion` uses a fresh uniquely named local PostgreSQL database on `/tmp`; it checks the real pinned BetterAuth schema, revocation, retries and removal, plus HTTP consent/origin/recent-sign-in boundaries. It never opens the configured production database.

Owner decision (Oct 20): delete account-linked scores only. Anonymous device scores/history, including the device initiating deletion, are retained.

Participant HTTP 409 conflicts are recorded as `blocked` in the receipt manifest. Other products continue; provider credential finalization waits. The job keeps sign-in disabled, sets `last_error=participant_conflict` and `next_attempt_at=infinity`. An operator must investigate the conflicting request binding before correcting the manifest and resuming. No completed deletion is reported for this state.
