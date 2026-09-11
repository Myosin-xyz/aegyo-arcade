# Accounts provider proof

Independent package inside the Arcade repo, intended to become a separate Railway service in the **existing Myosin account and aegyo-arcade project**, with its own Postgres. It is not imported by Arcade and has no deployed routes or automatic production migrations.

See [provider decision](../../docs/BETTER_AUTH_PROVIDER_DECISION.md). This package currently proves the maintained provider's behavior with synthetic records. Login UI, production configuration, persistent cutoff/rehash transactions, client adapters, Mailjet and Privy integration remain outstanding.

```sh
cd services/accounts
npm ci
npm test
npm run proof
```

Node 24+ and local PostgreSQL binaries (`initdb`, `pg_ctl`) are required. `npm test` runs password component checks; `npm run proof` starts a disposable PostgreSQL cluster and runs the provider checks. The latter uses the actual Better Auth request handler and verified JWT signatures with three synthetic HTTPS client origins; it does not substitute for a real-browser staging test. It never reads `DATABASE_URL`, loads `.env`, contacts a production database or sends email.

Local cluster data/logs remain in ignored `.proof` directories with private permissions; the server stops afterward. The socket is private and local, with no TCP listener. The short socket path under `/tmp` accommodates macOS path limits. No existing PostgreSQL service is started, stopped or modified.

Pinned versions and the lockfile belong only to this package. Do not add it to Arcade's Vercel startup/build or run schema changes automatically on an application build. Create separate Railway deploy/watch paths and release migration steps after G1 design review. No Railway resource or hostname is provisioned by these scripts.
