# ADR 0004 — Railway PostgreSQL replaces Neon

**Date**: 2026-07-17
**Status**: Accepted (provisioning pending — EXT-OPS)
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
4. Two connection strings: the app uses the **managed PgBouncer** URL;
   migrations (`pnpm db:migrate`) use the **direct** URL.
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
- [ ] Redeploy and repeat the counted API smoke
      (session → attempt → play → replay → consumed-attempt 409)

## References

- Railway PostgreSQL: https://docs.railway.com/databases/postgresql
- Railway PgBouncer: https://docs.railway.com/databases/postgresql-pgbouncer
- Vercel attachDatabasePool:
  https://vercel.com/docs/functions/functions-api-reference/vercel-functions-package
