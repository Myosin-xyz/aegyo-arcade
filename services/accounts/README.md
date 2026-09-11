# Accounts provider proof

Independent package inside the Arcade repo, intended to become a separate Railway service in the **existing Myosin account and aegyo-arcade project**, with its own Postgres. It is not imported by Arcade and has no deployed routes or automatic production migrations.

See [provider decision](../../docs/BETTER_AUTH_PROVIDER_DECISION.md). This package currently proves the maintained provider's behavior with synthetic records. Login UI, production configuration, atomic credential/cutoff/rehash transactions, client adapters, Mailjet and Privy integration remain outstanding.

```sh
cd services/accounts
npm ci
npm test
npm run proof
```

Select **Node 24.21.0** (pinned in `.node-version` and `package.json`) before installing or running the package. Local PostgreSQL binaries (`initdb`, `pg_ctl`) are also required. Package installation and the test/proof commands reject other Node versions; the proof checks and prints the runtime before creating a database. `npm test` runs password component checks; `npm run proof` starts a disposable PostgreSQL cluster and runs the provider checks. The latter uses the actual Better Auth request handler and verified JWT signatures with three synthetic HTTPS client origins; it does not substitute for a real-browser staging test. It never reads `DATABASE_URL`, loads `.env`, contacts a production database or sends email.

The reset hook now persists a server-owned timestamp, and the proof verifies the changed signed claim for all three clients, persistence after provider recreation, a second reset, and rejection of a profile-field override. This is a sequential recovery proof: failed hooks, concurrent login/reset, other password-writing APIs and already-issued product sessions still need the complete staging design.

Local cluster data/logs remain in ignored `.proof` directories with private permissions; the server stops afterward. The socket is private and local, with no TCP listener. The short socket path under `/tmp` accommodates macOS path limits. No existing PostgreSQL service is started, stopped or modified.

Pinned versions and the lockfile belong only to this package. Do not add it to Arcade's Vercel startup/build or run schema changes automatically on an application build. Create separate Railway deploy/watch paths and release migration steps after G1 design review. No Railway resource or hostname is provisioned by these scripts.

Pin the future Railway image/runtime to the same version and rerun these checks inside its Linux environment before deployment. The local macOS proof does not establish container or browser compatibility. Node upgrades require updating both runtime pins and rerunning the proof.
