# Aegyo Accounts service

Separate Better Auth service inside the Arcade repository. Deploy it independently from Arcade, in the existing `aegyo-arcade` Railway project and a dedicated Accounts environment/database. Its OIDC issuer is `<ACCOUNTS_BASE_URL>/api/auth`. The three products keep their own local data and product sessions.

The service now includes EN/ES account pages, Mailjet delivery support, database-backed rate limiting, atomic password/reset session guards, an authenticated session-state endpoint, restricted-role readiness checks, and explicit migration/synthetic bootstrap commands. Arcade has a feature-flagged client adapter with a real staging browser proof. The main-site adapter and Daebak binding foundation are being developed in separate repository branches; production migration/rehash and full cross-product browser acceptance remain unfinished. See [deployment runbook](../../docs/ACCOUNTS_DEPLOYMENT.md) and [current evidence](../../docs/AUTH_PROOF_PROGRESS.md).

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
