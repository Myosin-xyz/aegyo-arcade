# ADR 0004 — Railway PostgreSQL replaces Neon

**Date**: 2026-07-17
**Status**: Accepted — PROVISIONED 2026-07-19 (see amendment below)
**Supersedes**: the Neon references in TECH_SPEC §4/§18 and ADR 0001.

## Decision

The arcade database runs on **Railway PostgreSQL**, not Neon. No application
rewrite: the code already uses plain `pg`, Drizzle, and `DATABASE_URL`.

## Rationale

- M1 reviewer recommendation; the team already operates Railway for the
  Daebak indexer stack, so it's one fewer vendor.
- Standard Postgres over TCP — the M1 code (advisory locks, `FOR UPDATE`,
  transactions) is exercised against real Postgres in CI and locally with
  zero driver differences.

## Requirements (learned from daebak's Railway history)

1. **Myosin-owned Railway project** — NOT a personal account (the daebak
   deployment started on Mateo's personal Railway and still owes a
   transfer; the arcade does not repeat that).
2. Separate **dev / test / production** PostgreSQL services.
3. Vercel connects via Railway's **external TCP URL** while Next stays on
   Vercel.
4. ~~Two connection strings: the app uses the **managed PgBouncer**
   URL; migrations use the **direct** URL.~~ **Amended at
   provisioning**: the selected Railway Postgres template ships no
   managed PgBouncer — the app AND migrations both use
   `DATABASE_PUBLIC_URL` directly; `attachDatabasePool` releases
   pooled connections before Fluid suspension. Revisit dedicated
   pooling only if connection counts become a real problem.
5. `attachDatabasePool` from `@vercel/functions` is already wired into
   [src/db/client.ts](../../src/db/client.ts) so Fluid Compute releases
   pooled connections before suspension.

## Provisioning checklist (operator)

- [ ] Create Myosin Railway project + 3 Postgres services (dev/test/prod)
- [ ] Set Vercel `DATABASE_URL` (pooled) for production/preview
- [ ] Run `DATABASE_URL=<direct> pnpm db:migrate` against prod
- [ ] Activate the demo promotion via
      `scripts/ops/activate-demo-claw.mjs --reason "..." --yes`
      (audited; writes `ops_audit`)
- [ ] Redeploy and run the counted API smoke (one command, 12 checks:
      generic loop + replay + OD-1 slot + board + streak + claw
      play/replay):
      `SMOKE_URL=https://<deployment> SMOKE_DATABASE_URL=postgres://… node scripts/ops/prod-smoke.mjs`
      (the DB URL is REQUIRED — the script pre-seeds its two devices
      with known UUIDs and deletes them by exact UUID in a `finally`
      block on every exit path; add
      `VERCEL_AUTOMATION_BYPASS_SECRET` to reach SSO-protected
      previews — see the script header)

## References

- Railway PostgreSQL: https://docs.railway.com/databases/postgresql
- Railway PgBouncer: https://docs.railway.com/databases/postgresql-pgbouncer
- Vercel attachDatabasePool:
  https://vercel.com/docs/functions/functions-api-reference/vercel-functions-package

## Amendment — provisioned 2026-07-19

- **Provisioned on Mateo's PERSONAL Railway workspace** (project
  `aegyo-arcade`, id `8229f87c-908d-426d-9562-4b01b0e89a50`) — Mateo's
  explicit call after his Hivemind workspace role denied project
  creation. **This knowingly repeats the daebak transfer debt:
  MIGRATE TO A MYOSIN-OWNED WORKSPACE BEFORE PUBLIC LAUNCH.**
- Services renamed in the dashboard: `postgres-prod` (production),
  `postgres-dev` (staging/preview), `postgres-test` (spare).
- No managed PgBouncer on the current Railway Postgres template; the
  app uses `DATABASE_PUBLIC_URL` directly with `attachDatabasePool`.
  Revisit pooling if Fluid connection counts ever bite.
- Checklist state: migrate ✅ (prod AND staging), demo promotion ✅ on
  both (audited `ops_audit` rows), smoke ✅ **12/12 GREEN against a
  live production deployment** — and every row that smoke created
  (plus the provisioning probe device) was afterwards deleted
  transactionally; production tables are EMPTY.
- Vercel env: `DATABASE_URL` → `postgres-prod` for **Production**;
  `DATABASE_URL` → `postgres-dev` for **Preview** (set via the REST
  API — the CLI's all-branches env add loops on its own suggested
  command). **Environments are isolated**: previews never touch
  production data (M4 ops review P1).
- **Deployment-protection facts**: this Vercel plan CANNOT protect
  production deployments (API rejects with 428 "not available on your
  plan") — protection covers previews only. A production deploy is
  therefore a PUBLIC LAUNCH ACT. The first production deploy was
  publicly reachable at aegyo-arcade.vercel.app for ~3 minutes before
  removal (register gates: BTS art + member names are preview-only).
  Rule: NO production deploys until the release gates clear.
- **Smoke policy** (M4 ops review P1, rev 3): the smoke PRE-SEEDS its
  two devices + sessions in ONE transaction over `SMOKE_DATABASE_URL`
  (required — no DB-less mode), with the UUIDs registered for cleanup
  BEFORE the first insert; a read-only PREFLIGHT (`GET /api/streak`
  with each seeded cookie, must be 200) proves `SMOKE_URL` and
  `SMOKE_DATABASE_URL` refer to the SAME database before any mutating
  request; every fetch carries a bounded timeout; cleanup deletes by
  exact UUID in a `finally` block on every exit path and is
  UNCONDITIONAL (no opt-out flag). Display handles are never used as
  identifiers (non-unique, low-entropy). Routine runs go against
  STAGING; SSO-protected previews are reachable via
  `VERCEL_AUTOMATION_BYPASS_SECRET` (`x-vercel-protection-bypass`);
  production runs are reserved for launch verification. Pinned by
  `tests/e2e/smoke-cleanup.spec.ts`: green path,
  abort-after-first-commit crash, and preflight-mismatch abort all
  leave zero rows for the seeded UUIDs. Rehearsed live against the
  protected preview: 12/12 GREEN on the matched pair, and a REAL
  mismatch drill (preview URL + production DB) aborted at preflight
  with production back to zero rows.
- **Credential rotation (2026-07-19)**: the postgres-prod password
  that had surfaced in provisioning debug output was rotated
  (`ALTER USER` + Railway `POSTGRES_PASSWORD` sync); new URL verified,
  old password confirmed rejected, Vercel Production `DATABASE_URL`
  updated. The Vercel automation-bypass secret used in the first
  rehearsal was likewise revoked + regenerated the same day; the
  replacement lives only in Vercel project settings (injected into
  deployments as `VERCEL_AUTOMATION_BYPASS_SECRET`) and was never
  echoed. Rotate both again at the Myosin-workspace migration as
  routine hygiene.
