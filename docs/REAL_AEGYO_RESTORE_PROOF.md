# Real Aegyo backup and restore proof — September 12, 2026

The real production snapshot restored successfully into a separate private Railway
database. Full-row SHA-256 fingerprints matched for all **48 non-system ordinary
and partitioned tables**. The restored copy contains **52 users, 25 sessions and
four completed Prisma migrations**.

This is a backup/restore proof. It is not an Accounts import, credential cutover,
live identity mapping or returning-user password acceptance.

## Resources and evidence

| Item                            | Observed value                             |
| ------------------------------- | ------------------------------------------ |
| Existing Aegyo Railway project  | `a719c26e-33b9-4a1c-8759-d5401c1e181a`     |
| Existing production environment | `27e2f29a-5846-48f8-9727-694a97c36ef6`     |
| Source PostgreSQL service       | `726d0c13-88e6-4167-b1ac-521b4a7b1216`     |
| Source database                 | `kpopdb`                                   |
| Private rehearsal service       | `af639001-c6cd-417c-941b-c84c657c7c83`     |
| Private rehearsal volume        | `e4a73105-38f7-4173-8ead-74e52268f928`     |
| Rehearsal database              | `aegyo_auth_rehearsal_20260912`            |
| Operator source, Aegyo worktree | `e9e0468fe7dc477e3188d18d0ab769d5bddb990e` |
| Successful operator deployment  | `f26529b1-4de2-453d-ab01-371d2c06ba8c`     |
| Completion time                 | `2026-09-12T19:56:15Z`                     |

The operator used pinned PostgreSQL 18 tooling and a three-file committed source
bundle. It ran in the same existing project and environment as both databases.
The target has persistent storage, no public TCP proxy and no HTTP/custom domain.
No application is connected to this restored copy.

## Preservation and isolation checks

- A temporary source role had SELECT permissions only, no superuser or role/database
  creation rights, durable read-only transactions and bounded timeouts. A short
  account-metadata transaction created and later removed this role; no application
  rows or existing user credentials were changed.
- One exported repeatable-read snapshot was shared by the source fingerprints and
  `pg_dump`. Current users continued writing normally; no signup/reset freeze was
  required for this backup rehearsal.
- `pg_dump --format=custom` fed `pg_restore --single-transaction` through a pipe
  inside Railway. The target was checked to be empty, with exact database/role
  guards and matching PostgreSQL major versions.
- Both connections used `verify-full` and their separately obtained CA certificates.
  The existing source certificate names only `localhost`; libpq verifies that name
  while `hostaddr` binds the connection to the original private Railway hostname's
  resolved address. No production certificate or database restart was needed.
- The restored rows matched the source fingerprints across every original column.
  SQL ownership/ACL metadata intentionally belongs to the isolated target owner;
  application identity, role and ownership columns remain in the verified row data.
- No dump, user rows, hashes, session tokens or reset tokens were downloaded locally
  or printed. Operator errors are sanitized before entering Railway logs.

The operator reported all seven success assertions, including
`full_row_fingerprints_match=true` and `verified_table_count=48`. Private local
evidence contains only configuration identifiers, aggregate results and sanitized
logs, in ignored mode-0600 files.

## Cleanup and remaining gates

The temporary source reader was removed. Operator credentials were removed, its
confirmation was set to `disabled`, and Railway accepted stopping its deployment.
The empty operator service shell (`57406cd0-f9ae-4000-b893-684aa2e0db16`) remains
because Railway denied service deletion for this account. No deletion retry or
permission workaround was attempted. Simon can remove that shell later; it has
no volume, public endpoint or remaining database credentials.

The private restored database remains available for the next rehearsal. A known,
authorized returning user's existing password must pass the canary check before
the real Accounts migration is accepted. That password must be entered through a
secure test flow, never pasted into a chat or committed. Production credential
freeze, copy, mapping reconciliation and activation are separate coordinated steps.

After the rehearsal, all three public product homepages still returned HTTP 200.
Those HTTP checks show availability only, not proof of every production user flow.
