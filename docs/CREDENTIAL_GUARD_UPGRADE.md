# Credential guard revision 2

## Reason for the upgrade

The real-provider lifecycle proof found that deleting an identity-provider session
on password reset did not invalidate an already-issued OAuth access token: the
provider's token foreign key became null, and UserInfo still accepted the token.
The credential-change and operator-revocation database functions now delete that
user's OAuth access and refresh tokens before deleting sessions, in the same
transaction. Another user's tokens remain usable.

`4134d9f` contains the fix and adversarial tests. `3841cf5` adds the guarded
upgrade and deployment readiness requirement. Already-issued signed ID tokens
remain cryptographically valid until their expiry; products must keep checking
authoritative session state before authorizing access.

## Existing initialized Accounts database

Application redeployment alone does not replace existing PostgreSQL functions.
The ordinary schema migration also intentionally avoids silently rewriting guards
in an already-initialized database. Use the explicit owner operation:

```sh
# Set these in a protected operator environment, never commit their values.
# ACCOUNTS_MIGRATION_DATABASE_URL: the reviewed dedicated Accounts owner connection
# ACCOUNTS_MIGRATION_DATABASE_CA_CERT and ..._SERVER_SHA256: required for remote TLS
# ACCOUNTS_GUARD_UPGRADE_DATABASE_NAME: the exact expected database name
ACCOUNTS_GUARD_UPGRADE_CONFIRM=oauth-token-revocation-v2 \
  node scripts/upgrade-credential-guards.mjs
```

Run from `services/accounts` under Node 24.21.0. Ordinary `DATABASE_URL` must be
absent. The operator locks the schema transaction, verifies the database and
single version-1 marker, requires that the guard revision is absent, and compares
all three installed function bodies with the frozen reviewed revision-1 source.
An unknown definition or an already-applied upgrade is refused. It installs the
reviewed revision-2 SQL and adds `guard_revision=2` atomically. A failed transaction
rolls back. If the commit acknowledgement is uncertain, inspect the marker and
function hashes before taking further action; do not remove the marker to retry.

Fresh dedicated databases get revision 2 through `scripts/migrate.mjs`. The new
application's readiness check fails closed until the marker says revision 2.
Upgrade the database before deploying that application revision.

## Staging evidence — September 12, 2026

The exact old function hashes were verified on the isolated `accounts-staging`
Postgres service in project `8229f87c-908d-426d-9562-4b01b0e89a50`, environment
`279e0a09-8ba3-42dc-8d44-a2598d1f3fe9`. The guarded transaction was executed over
Railway SSH with local `psql`, so no public database proxy or credential transfer
was needed. It verified the database was `railway` and the operator `postgres`.
The transaction committed and reported `guard_revision=2`.

Reviewed guard SQL SHA-256:
`3d5e514aa16afd464502e710b15d076fd4d639e6bb29d3e3517ca22dd6569140`.
Staging transaction SHA-256:
`a9aa238ca6198620b6c55fbe00525a3a52618fb8c0fef4b02d8f2ce92d42004c`.
The equivalent SQL transaction retains the same old-definition/marker checks as
the tracked Node operator; the private execution report is ignored and mode 0600.

The pinned Linux proof passed 26 unit/runtime/UI/email checks and 41 real
PostgreSQL checks, with zero skips. It covers expiration, RP logout despite failed
back-channel delivery, password-reset and operator token revocation, preservation
of another user's access, supported grant restrictions, readiness before/after
upgrade, and repeat refusal. No production database was changed.

Accounts staging deployment `15423d18-07b4-478d-b795-77c42ea54d57` (source
`3841cf5`) subsequently reached SUCCESS. Its `/readyz` returned HTTP 200 with
`{ready:true}`. The fresh HTTP checkpoint passed all 20 assertions; public staging
Postgres proxy count stayed zero.
