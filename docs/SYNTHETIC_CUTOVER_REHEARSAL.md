# Synthetic cross-repository cutover rehearsal

The importer and Aegyo mapping installer now run together against a disposable
PostgreSQL cluster. This exercises their actual command-line interfaces and
artifact formats, rather than substituting hand-written mapping subjects.

Run from the Arcade auth worktree with the pinned Node 24.21.0 binary:

```sh
services/accounts/.proof/runtime/node-v24.21.0-darwin-arm64/bin/node \
  services/accounts/scripts/rehearse-aegyo-cutover.mjs \
  /absolute/path/to/kpop-lyrics-shared-auth
```

The Aegyo checkout must contain the adapter, generated Prisma client and installed
dependencies. Local `initdb` and `pg_ctl` must be on PATH. The runner starts its own
empty cluster with TCP disabled and a private Unix socket; it does not accept
connection URLs, load environment files, or reuse any staging/production data.
Its child operators receive an explicit environment containing only local fixture
configuration. Private synthetic artifacts and the cluster are removed on normal
completion or handled failure; shutdown errors cause a failing result.

## Passing checks

1. Capture one synthetic legacy user through the actual snapshot CLI, verify a
   known non-ASCII password with the configured legacy pepper, initialize the
   operator journal, and execute the atomic import CLI.
2. Feed the importer's actual subject/mapping artifacts and database-derived local
   ownership snapshots into Aegyo's reconciliation CLI. Activation without mappings
   fails. Installing mappings leaves the latch off; the separate activation command
   turns it on only after complete mapping coverage.
3. Authenticate the old password through the real Better Auth handler and resolve
   its subject to the unchanged local user ID. The local moderator role, profile,
   hash, favorite and legacy session remain intact; the provider account receives
   the ordinary `user` role.
4. Retry both import and mapping installation after activation. Exactly one
   Accounts user and one Aegyo mapping remain.

Four checks passed on September 12, 2026 using Node 24.21.0. Syntax, scoped ESLint
and formatting checks passed. A separate Aegyo `auth:backup-restore-proof` command
exercises actual `pg_dump`/`pg_restore`, restored-data preservation and conflicting
mapping refusal; see that repository's adapter runbook.

## Production gate stays separate

These proofs establish tool interoperability and synthetic preservation. They do
not replace a protected production backup/restore rehearsal, actual full-population
reconciliation, a known authorized existing user's password proof, email delivery,
or a browser journey involving a real Privy identity.

The mapping installer checks user IDs, roles and exact identity mappings. It does
not independently recompute every dependent-content digest. Maintain the writer
freeze across the final database-derived ownership snapshot, reconciliation,
mapping installation, activation and final preservation check. Activation by itself
is not proof that content ownership stayed unchanged.

Legacy reset records can be retained for history while the old reset endpoint is
disabled at cutover; preserving a record does not authorize using its old token.
