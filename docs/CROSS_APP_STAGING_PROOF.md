# Cross-product staging acceptance

This proof exercises the deployed Accounts provider and all three product adapters
using synthetic `@example.invalid` identities. It is separate from the production
restore, migration and ownership reconciliation gate.

## Deployment boundary

Everything runs inside the existing Railway project
`8229f87c-908d-426d-9562-4b01b0e89a50`, environment
`279e0a09-8ba3-42dc-8d44-a2598d1f3fe9` (`accounts-staging`).

| Service  | Staging origin                                              | Database                                     |
| -------- | ----------------------------------------------------------- | -------------------------------------------- |
| Accounts | https://aegyo-accounts-accounts-staging.up.railway.app      | Existing dedicated Accounts staging database |
| Aegyo    | https://aegyo-auth-preview-accounts-staging.up.railway.app  | `aegyo_auth_staging`                         |
| Arcade   | https://arcade-auth-preview-accounts-staging.up.railway.app | `arcade_auth_staging`                        |
| Daebak   | https://daebak-auth-preview-accounts-staging.up.railway.app | `daebak_auth_staging`                        |

The product databases are logical databases on the existing dedicated staging
Postgres service. Each has a separate restricted runtime login. Build bundles
contain tracked source and reviewed package locks, never environment files,
operator credentials or production data. Product builds/startup do not run the
ordinary production migration commands.

Aegyo's runtime still performs legacy DDL. Its staging role owns `User` for the
existing role-column check and may create ordinary runtime tables in `public`.
The schema, `SharedAuthIdentity`, `Session`, and `AuthCutoverLatch` remain owned
by the operator. The app has no update/delete grant on identity mappings and
only reads the latch. This compatibility concession is not a recommendation to
broaden production privileges. See Aegyo's `staging/README.md` for exact grants.

Database connections retain TLS verification. Operator connections through the
temporary TCP proxy verify the CA and pin the database certificate. Product
runtimes use private networking and the staging CA: Prisma uses
`sslmode=require&sslaccept=strict` with an explicit CA path; Daebak uses
`sslmode=verify-full` with `NODE_EXTRA_CA_CERTS`. The CA is materialized before
starting Node. Neither uses an insecure certificate fallback.

## Synthetic proof

The guarded browser runner is
`scripts/auth-proof/cross-app-staging-browser.mjs`. It requires the private,
ignored operator fixtures under `services/accounts/.proof`, an explicitly
opened staging-only proxy, and the pinned Node 24.21.0 runtime.

```sh
ACCOUNTS_CROSS_APP_CONFIRM=synthetic-staging-only \
  services/accounts/.proof/runtime/node-v24.21.0-darwin-arm64/bin/node \
  scripts/auth-proof/cross-app-staging-browser.mjs
```

Its acceptance assertions cover:

1. Arcade guest-device identity survives Accounts sign-in.
2. An existing mapped Aegyo user signs in through provider SSO and keeps the
   same local ID, profile, password sentinel and moderator access.
3. Daebak accepts Accounts SSO but still requires independent Privy ownership.
   Its synthetic users, grants and identity bindings remain empty.
4. Daebak local logout clears its session; subsequent sign-in can reuse SSO.
5. A verified new Accounts member gets one Aegyo user and exact identity
   mapping; repeat sign-in keeps that local ID.
6. Recovery through the deployed Accounts UI invalidates retained product
   sessions within the 30-second state-cache bound plus ten seconds for network
   observation. The timer begins when the reset succeeds, before other flows.
7. Each product rejects the old provider session in a separate browser context
   with no product session cookie. The new password then signs in successfully.

Recovery uses the real provider and deployed UI, with a local recorder capturing
only the synthetic reset link. It does **not** test email delivery. Before
submitting a new password, the runner writes an exclusive, mode-0600 pending
recovery journal. It atomically replaces the fixture password after confirmed
reset and removes the journal only after fresh login succeeds. If a journal
remains after failure, inspect it privately and reconcile the fixture before
rerunning; do not discard it or expose its contents.

Reports and screenshots remain private under `.proof`. The operator must remove
the temporary database proxy after the run, including on failure, and verify
that this service/environment has zero TCP proxies. A failed or partial run
must not be reported as staging acceptance.

## What this does not approve

No production import or cutover, Mailjet delivery, real Daebak wallet linking,
Privy custom-auth entitlement, provider-wide browser logout, or leaderboard
acceptance follows from this proof. Existing local protocol tests and new
browser evidence must be recorded separately. The real-data restore/freeze
rehearsal, domain/email readiness and explicit production review remain gates.

## Recorded execution

September 12, 2026, 17:42 UTC: all eleven browser checks passed. Retained product
sessions stopped authorizing 20.743 seconds after recovery. The new password
then worked in a clean browser, and its pending recovery journal was removed.
The operator removed the temporary TCP proxy and verified zero remaining proxies.

The final report SHA-256 is
`58b22ce33602ed166a29d7b2bc3ebb343885e9517b03379843faf618746b605e`.
The deployment identifiers, resolved defects and Linux regression evidence are
recorded in [the implementation checkpoint](AUTH_IMPLEMENTATION_CHECKPOINT.md).
