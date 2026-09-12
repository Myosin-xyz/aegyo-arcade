# Accounts deployment contract

Accounts is an isolated service in the existing Railway `aegyo-arcade` project (`8229f87c-908d-426d-9562-4b01b0e89a50`). Railway lists that project under **Mateo Daza's Projects**, not the Myosin workspace. Keep that account-location distinction in operator checks even though the project name remains `aegyo-arcade`.

## Railway service settings

Create the Accounts application service and its staging PostgreSQL service in an isolated staging environment before any production work. Do not attach or inspect the Arcade production database.

Configure the Accounts application service with:

| Setting                     | Required value                                                       |
| --------------------------- | -------------------------------------------------------------------- |
| Source repository           | this `aegyo-arcade` repository                                       |
| Root Directory              | `/services/accounts`                                                 |
| Config as Code path         | `/services/accounts/railway.toml`                                    |
| Dockerfile                  | `Dockerfile` (resolved inside the Root Directory)                    |
| Watch Paths                 | `/services/accounts/**`                                              |
| Build                       | Docker production target; `npm ci --omit=dev`, with no schema change |
| Start                       | `npm start` → plain Node `src/server.mjs`                            |
| Port                        | Railway-provided `PORT`; bind on `0.0.0.0`                           |
| Liveness                    | `GET /healthz` (runtime monitoring)                                  |
| Railway deploy health check | `GET /readyz` (database/schema/guard readiness)                      |
| Restart                     | on failure, at most 10 retries                                       |

Railway's current monorepo documentation says Root Directory restricts the downloaded build source, while the Config as Code path must remain repository-absolute. That makes the service-level `.dockerignore` effective and prevents the Accounts image from receiving unrelated repository files. No repository-root `.dockerignore` is required with this setup.

Railway deploy health checks use `/readyz`, which checks the database connection and the expected schema/credential guards before a deployment can become active. `/healthz` remains the process liveness endpoint for runtime monitoring. A live but unready instance must not receive authentication traffic.

### Current staging source layout

The first staging upload used an explicit 26-file, approximately 121 KB allowlisted source bundle containing only the Accounts service. For that CLI-uploaded cutout, the service source root is `/` and Config as Code is `/railway.toml`; paths inside the bundle already begin at the Accounts package root. Deployment `03a0f7a0-3530-49db-91bb-b66d57c2effc` was created from that layout in the isolated staging environment.

That cutout layout is specific to the current CLI upload. A future Git-connected deployment from the full repository must use `/services/accounts` as Root Directory, `/services/accounts/railway.toml` as Config as Code, and `/services/accounts/**` as its watch path, as specified in the table above. Do not copy the bundle-root `/` setting into a full-repository source configuration.

Current Accounts deployment is `1a22dee3-44a5-46f0-89ca-f7322b9fb272` at `https://aegyo-accounts-accounts-staging.up.railway.app`. The separate Arcade preview is `https://arcade-auth-preview-accounts-staging.up.railway.app`, service `01e424b3-6137-4ef6-b8fc-94def7963b48`. It uses a separate `arcade_auth_staging` logical database and restricted role on the same new staging Postgres instance. Both services passed the real Chromium reset/SSO/guest-preservation proof; Aegyo and Daebak remain unintegrated protocol fixtures.

The temporary public Postgres proxy was deleted after the browser proof; zero TCP proxies remain on the new database service. Readiness was rechecked after removal. The private credential fixture's public URL is now stale and must not be treated as an active connection. Reopening access is a separate, explicitly targeted operator action, followed by removal after the next proof. No migration-owner credentials were added to the runtime services.

Railway's observed `x-real-ip` header passed four authenticated tests, including spoofed forwarding headers, before `ACCOUNTS_RAILWAY_IP_VERIFIED=true` was enabled. `/api/internal/proxy-proof` exposes only the observed and normalized IP, requires a reader key, and returns 404 outside staging. Keep evidence free of IPs, tokens and secrets.

## Runtime and image

The Dockerfile pins the official Node `24.21.0-bookworm-slim` multi-platform image index to digest `sha256:2fe369e969550cde8e867afc3fe370b260140cab4a23d467074295b42163d553`, observed on 2026-09-11. The application runs as the image's unprivileged `node` user. The production target contains application production dependencies only; it does not contain a PostgreSQL server.

The `proof` target adds Debian PostgreSQL binaries solely to run the disposable proof as a non-root Linux user. The proof creates fresh synthetic data, uses a private Unix socket with TCP disabled, ignores `DATABASE_URL`, and never mounts host environment files or existing volumes.

```sh
cd services/accounts
docker build --target proof -t aegyo-accounts-proof:local .
docker run --rm --network none aegyo-accounts-proof:local
docker build --target production -t aegyo-accounts:local .
docker run --rm --entrypoint node aegyo-accounts:local \
  -e 'console.log(JSON.stringify({platform:process.platform,arch:process.arch,node:process.versions.node,uid:process.getuid()}))'
```

The Linux proof result belongs in the deployment review. Re-run it after any runtime, dependency, Dockerfile or credential-transition change.

Observed locally on 2026-09-11 with Docker Desktop's Linux ARM64 engine: the default build before the staging proxy diagnostic addition produced production image ID `sha256:0100b1b192c3c74a674c5ee6eed0a8eaa8ed01742391aae7245e72b96492b23b`. It reported Node 24.21.0 as UID 1000 with no PostgreSQL server binary. After the diagnostic addition, the proof image passed 17 unit/runtime/UI tests and 21 serial PostgreSQL provider/migration/seed tests. The migration coverage includes empty initialization, unchanged rerun, restricted-role readiness, rejected security-column updates, working signup/sign-in/reset through the restricted role, fail-closed disabled-guard readiness, refusal of a database containing an unrelated table, and bounded one-time synthetic staging seeding. The image ID identifies that earlier local build; a registry digest must be recorded separately if an image is pushed.

The isolated proof is also defined in `.github/workflows/accounts-proof.yml`. It runs for service changes in pull requests and main-branch pushes, builds the proof target and runs it without networking, secrets or deployment actions.

## Variables and secret boundaries

Set only scoped Accounts staging variables. Their values must stay in Railway and an approved secret manager; never print or copy them into Git, CI logs or review notes.

- `ACCOUNTS_ENVIRONMENT`: exactly `staging` or `production`; use `staging` for the isolated proof environment.
- `DATABASE_URL`: runtime application-role reference to the new Accounts PostgreSQL service.
- `ACCOUNTS_MIGRATION_DATABASE_URL`: separate migration-owner reference, exposed only to the reviewed migration job/operator and not the running application.
- `ACCOUNTS_MIGRATION_DATABASE_CA_CERT`: the authenticated Railway database root CA PEM for an operator connection through a public TCP proxy.
- `ACCOUNTS_MIGRATION_DATABASE_SERVER_SHA256`: the reviewed SHA-256 fingerprint of the CA-validated database leaf certificate.
- `ACCOUNTS_MIGRATION_CONFIRM`: exactly `dedicated-accounts-database`; the command otherwise exits before connecting.
- `ACCOUNTS_DATABASE_ROLE`: application login role name, default `aegyo_accounts_app`.
- `ACCOUNTS_DATABASE_ROLE_PASSWORD`: required only when the application role does not yet exist. An idempotent rerun never rotates an existing role password.
- `ACCOUNTS_BASE_URL`: the Accounts HTTPS origin for this environment.
- `BETTER_AUTH_SECRET`: an environment-specific generated secret.
- `ACCOUNTS_STATE_READERS_JSON`: per-application state-reader keys for the three administered clients.
- `ACCOUNTS_MAIL_MODE`: `disabled` by default; choose `resend` with `RESEND_API_KEY` and `RESEND_FROM_EMAIL`, or `mailjet` with `MAILJET_API_KEY`, `MAILJET_SECRET_KEY` and `MAILJET_FROM_EMAIL`. Use scoped staging credentials. Signup remains closed until delivery and capacity are proven. The existing Mailjet account is blocked as of September 12; see the [email decision](TRANSACTIONAL_EMAIL_DECISION.md).
- `ACCOUNTS_LEGACY_PEPPER`: only for an authorized migration rehearsal; remove it when no retained legacy credential needs it.

Accounts must not receive Arcade production database URLs, wallet private keys, minter/paymaster credentials, production peppers in staging, or unrelated application secrets.

The staging runtime currently uses the same authenticated root CA and pinned leaf-certificate contract as the migration connection. Never replace it with `rejectUnauthorized: false`. When Railway rotates either certificate, retrieve the new public CA and fingerprint through authenticated access to the explicitly selected Accounts database, verify the chain, update the scoped variables, and repeat readiness checks.

## Migration and release sequence

The image build and application start perform no migration. Schema changes are a separate, reviewed operator action against an explicitly selected Accounts database:

```sh
npm run migrate
```

The migration command reads `ACCOUNTS_MIGRATION_DATABASE_URL`; the server reads `DATABASE_URL`. The owner connection must target a dedicated, empty Accounts database. The command refuses any unmarked database containing public tables, records schema version 1 and its exact generated-table inventory, and refuses table inventory or generated-schema drift on rerun. It creates or verifies a non-elevated application role, removes public schema creation, grants ordinary table access, denies updates to security-managed user columns, gives read-only access to the schema marker for readiness, and denies execution of the owner-only revocation function.

For a temporary public Railway TCP proxy, retrieve the public root certificate and leaf fingerprint through authenticated Railway SSH to the explicitly selected Accounts database. The current Railway database certificate names its private endpoints rather than the public proxy hostname. The shared database options therefore verify the root CA and pin the leaf SHA-256 identity; they never set `rejectUnauthorized: false`. Treat certificate renewal or rotation as an explicit reviewed configuration update. Remove the temporary proxy and its migration TLS variables when the operator work is complete. Internal Railway runtime connections may use the standard private `DATABASE_URL` without these public-proxy pins.

Before running it, record the selected Railway project, environment, application service and Accounts database service without displaying variables; verify a restorable backup; review the additive SQL and lock impact; and prove restore/rollback in isolated staging. Set the dedicated-database confirmation only after those checks. Run the migration once using the reviewed image and scoped migration owner. Remove both migration-owner variables and the role bootstrap password from the long-running application service, require `/readyz`, execute the all-client staging acceptance checks, and only then consider routing staging traffic.

Schema version 1 was installed successfully in the new isolated Accounts staging database. The staging seed remains a separate explicit operator command. It requires `ACCOUNTS_ENVIRONMENT=staging`, `ACCOUNTS_STAGING_SEED_CONFIRM=synthetic-only`, exactly three distinct HTTPS client definitions, an empty Accounts user table, and a private output path under `services/accounts/.proof`. It creates synthetic identities only, writes generated credentials with private permissions, and refuses a second run without altering its prior output. These gates do not authorize real-member import.

Staging still has no configured email delivery and has not passed real Aegyo or Daebak browser/identity continuity checks. Production migration or deployment remains blocked on the documented G1 evidence, restored legacy-data rehearsal, backup/restore proof, DNS and mail configuration, Privy continuity, and explicit release approval. No command in this contract authorizes contact with the production Arcade database.

## References

- [Railway monorepo deployment](https://docs.railway.com/deployments/monorepo)
- [Railway Dockerfiles](https://docs.railway.com/builds/dockerfiles)
- [Railway health checks](https://docs.railway.com/reference/healthchecks)
