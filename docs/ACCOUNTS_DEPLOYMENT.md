# Accounts deployment contract

Accounts is an isolated service in the existing Railway `aegyo-arcade` project (`8229f87c-908d-426d-9562-4b01b0e89a50`). Railway lists that project under **Mateo Daza's Projects**, not the Myosin workspace. Keep that account-location distinction in operator checks even though the project name remains `aegyo-arcade`.

## Railway service settings

Create the Accounts application service and its staging PostgreSQL service in an isolated staging environment before any production work. Do not attach or inspect the Arcade production database.

Configure the Accounts application service with:

| Setting                     | Required value                                                                                |
| --------------------------- | --------------------------------------------------------------------------------------------- |
| Source repository           | this `aegyo-arcade` repository                                                                |
| Root Directory              | `/services/accounts`                                                                          |
| Config as Code              | Existing legacy `services/accounts/railway.toml`; revalidate before any future Git connection |
| Dockerfile                  | `Dockerfile` (resolved inside the Root Directory)                                             |
| Watch Paths                 | `/services/accounts/**`                                                                       |
| Build                       | Docker production target; `npm ci --omit=dev`, with no schema change                          |
| Start                       | `npm start` → plain Node `src/server.mjs`                                                     |
| Port                        | Railway-provided `PORT`; bind on `0.0.0.0`                                                    |
| Liveness                    | `GET /healthz` (runtime monitoring)                                                           |
| Railway deploy health check | `GET /readyz` (database/schema/guard readiness)                                               |
| Restart                     | on failure, at most 10 retries                                                                |

Railway rejected a newly assigned `railwayConfigFile` setting as deprecated during this staging pass. The current preview services were configured through the scoped service API; the existing Accounts `railway.toml` remains as a legacy source artifact. Before a future Git-connected deployment, revalidate Railway's then-current repository-root, Dockerfile and watch-path behavior instead of silently requiring the deprecated field. Keep the build context narrow enough that the service-level `.dockerignore` prevents unrelated repository files from entering the image.

Railway deploy health checks use `/readyz`, which checks the database connection and the expected schema/credential guards before a deployment can become active. `/healthz` remains the process liveness endpoint for runtime monitoring. A live but unready instance must not receive authentication traffic.

### Dormant production service

Production traffic is closed unless `ACCOUNTS_TRAFFIC_ENABLED=true` exactly. A dormant production instance needs only `ACCOUNTS_ENVIRONMENT=production`, a bare HTTPS `ACCOUNTS_BASE_URL`, and Railway's `PORT`. It does not create a database pool, initialize Better Auth, or configure an email provider. `GET /healthz` returns 200; every other path, including `/readyz`, account pages, assets, discovery and auth APIs, returns 503. Configure Railway's deployment health check as `/healthz` while the service is dormant.

Keep the latch absent while provisioning the isolated service and private database. Migration, application-role configuration, OAuth clients, email delivery, proxy-header proof and product acceptance are separate prerequisites. After they pass, change the Railway health check to `/readyz` and set `ACCOUNTS_TRAFFIC_ENABLED=true` in the same reviewed activation. Active production then requires the complete strict configuration below. `ACCOUNTS_SIGNUP_ENABLED=true` remains a separate decision and is not implied by activating traffic. Staging remains active by default for compatibility; setting `ACCOUNTS_TRAFFIC_ENABLED=false` explicitly makes it dormant under the same health-only contract.

### Current staging source layout

The first staging upload used an explicit 26-file, approximately 121 KB allowlisted source bundle containing only the Accounts service. For that historical CLI-uploaded cutout, paths inside the bundle began at the Accounts package root and deployment `03a0f7a0-3530-49db-91bb-b66d57c2effc` used the bundle-root layout. This remains historical image/source evidence, not the current deployment identifier or a template for future service configuration.

Do not copy the historical bundle-root `/` setting into a full-repository source configuration. A future Git connection should begin by revalidating `/services/accounts` as the intended source boundary and `/services/accounts/**` as the intended watch boundary, then record the concrete settings Railway accepts at that time.

The current Accounts staging deployment is `4546e488-b42c-43dd-b602-94fda7271c81` from guarded fixture source `13b920a`; Aegyo `d6844960-0524-4314-b4a6-7e31a7959e02`, Arcade `42427b71-3db6-4ce2-9d29-1053bbb7486e`, and Daebak `cad82133-f3ca-4251-8530-b25e589decb8` remain the recorded product previews. Their origins are listed in [the cross-product staging proof](CROSS_APP_STAGING_PROOF.md). The current pinned proof passes 29 unit/runtime/UI/email checks and 45 real-PostgreSQL checks. The product previews use separate logical databases and restricted roles on the same isolated staging Postgres service.

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
- `ACCOUNTS_TRAFFIC_ENABLED`: production traffic opens only when this is exactly `true`; leave absent for a dormant production service. Staging defaults to active, while explicit `false` makes either environment health-only.
- `DATABASE_URL`: runtime application-role reference to the new Accounts PostgreSQL service.
- `ACCOUNTS_MIGRATION_DATABASE_URL`: separate migration-owner reference, exposed only to the reviewed migration job/operator and not the running application.
- `ACCOUNTS_MIGRATION_DATABASE_CA_CERT`: the authenticated Railway database root CA PEM for an operator connection through a public TCP proxy.
- `ACCOUNTS_MIGRATION_DATABASE_SERVER_SHA256`: the reviewed SHA-256 fingerprint of the CA-validated database leaf certificate.
- `ACCOUNTS_MIGRATION_CONFIRM`: exactly `dedicated-accounts-database`; the command otherwise exits before connecting.
- `ACCOUNTS_MIGRATION_DATABASE_NAME`: the exact database name, verified against the live connection before any schema write. Production preparation additionally requires `accounts_production`, `ACCOUNTS_TRAFFIC_ENABLED=false` and `ACCOUNTS_SIGNUP_ENABLED=false`.
- `ACCOUNTS_DATABASE_ROLE`: application login role name, default `aegyo_accounts_app`.
- `ACCOUNTS_DATABASE_ROLE_PASSWORD`: required only when the application role does not yet exist. An idempotent rerun never rotates an existing role password.
- `ACCOUNTS_BASE_URL`: the Accounts HTTPS origin for this environment.
- `BETTER_AUTH_SECRET`: an environment-specific generated secret.
- `ACCOUNTS_STATE_READERS_JSON`: per-application state-reader keys for the three administered clients.
- `ACCOUNTS_MAIL_MODE`: `disabled` by default. Resend is selected; use `resend` with a scoped `RESEND_API_KEY` and `RESEND_FROM_EMAIL`. Mailjet remains an explicit alternative through `mailjet` and the three `MAILJET_*` variables, but its suspension is historical and it is not the selected rollout path. Signup remains closed until Resend DNS, delivery and capacity are proven.
- `ACCOUNTS_LEGACY_PEPPER`: only for an authorized migration rehearsal; remove it when no retained legacy credential needs it.

Accounts must not receive Arcade production database URLs, wallet private keys, minter/paymaster credentials, production peppers in staging, or unrelated application secrets.

Staging currently uses Resend with a sending-only key kept privately in Railway, the temporary `onboarding@resend.dev` sandbox sender restricted to the authorized `mateo@myosin.xyz` mailbox, and signup disabled. Runtime verification and reset messages were delivered, but both went to Gmail Spam. Consuming the delivered verification link updated both existing synthetic provider sessions to verified email. This is sandbox transport evidence only; branded-domain delivery and inbox placement remain pending the DNS handoff. No paid plan or production configuration changed.

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

Staging has passed the final synthetic four-origin browser journey, including Aegyo identity continuity and Daebak's local shared-auth boundary. It has not passed actual email delivery, real Privy identity linking, a full-data restore/import/reconciliation rehearsal, or any production cutover. Production migration or deployment remains blocked on those gates, DNS and mail readiness, backup/restore proof, and explicit release approval. A read-only public check found all three production homepages healthy with HTTP 200 while their shared-session routes returned 404, consistent with the adapters not being active there. No command in this contract authorizes contact with the production Arcade database.

## References

- [Railway monorepo deployment](https://docs.railway.com/deployments/monorepo)
- [Railway Dockerfiles](https://docs.railway.com/builds/dockerfiles)
- [Railway health checks](https://docs.railway.com/reference/healthchecks)
