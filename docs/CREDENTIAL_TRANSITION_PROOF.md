# Credential transition proof

September 11, 2026. Local candidate following the independent review of `ea12413`. **17 reported provider tests and 3 password tests pass on Node 24.21.0, with a disposable PostgreSQL 14.17 cluster on macOS. G1 has not passed.** No production resource or application changed.

## Why the timestamp hook changed

The published reset route writes the password, awaits `onPasswordReset`, then deletes sessions. Writing the timestamp only in that hook leaves a failure window. A login can also verify the old password, pause, and attempt to create a session after reset completed.

The candidate keeps Better Auth's maintained endpoints and adds an explicit PostgreSQL migration, `services/accounts/src/credential-guards.sql`, installed only in the disposable proof database after the generated schema. No dependency is patched and no new OAuth protocol is implemented.

- Updating an existing credential hash atomically increments `user.credentialVersion`, writes a monotonic `passwordChangedAt`, and deletes the user's IdP sessions in the same database statement. A failure in any of those writes rolls back the entire credential update. Timestamps use `timestamptz`, with milliseconds retained.
- Sign-in captures the user's credential version before password verification. The session creation hook carries that original, request-local snapshot into the session row; it never adopts a newer version at issuance.
- A database trigger locks the same user row when inserting a session and rejects a version mismatch or banned user. If reset wins the lock, the old insertion fails. If insertion completes first, reset subsequently deletes that session. Routine session updates cannot change its owner/version and do not acquire the user lock in the opposite order.
- `onPasswordReset` no longer writes authoritative security state. It remains a fault-injection point in the local fixture. Its failure cannot undo committed revocation. Database race errors become a recoverable `401 CREDENTIAL_CHANGED`; unexpected failures return a generic error without SQL, credentials or stack traces.
- Security fields reject ordinary profile input and operator profile updates. The test-only pause/failure functions receive no password, hash, token or email; callers cannot enable them through an HTTP body.

## Exact evidence

All scenarios drive real provider handlers against the same disposable database. Race tests use two provider instances, not a JavaScript lock. The SQL guards, rather than process memory, arbitrate session insertion.

| Scenario                                                                                         | Observed result                                                                                                                                                                                                            |
| ------------------------------------------------------------------------------------------------ | -------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| A post-reset hook throws after the credential update                                             | Response fails, but the new hash/version/cutoff are committed and old sessions are absent. Old passwords, stale SSO at each of three clients and pre-issued codes fail. New credentials work; another recovery link works. |
| A database trigger deliberately fails while deleting old sessions                                | Hash, cutoff, version and existing session IDs all remain unchanged. After removing the fault, a fresh recovery link succeeds and revokes old SSO.                                                                         |
| Old-password login pauses after successful verification; another instance completes reset        | Resumed login receives `401 CREDENTIAL_CHANGED`, issues no token/session, and the new password works.                                                                                                                      |
| Old-password login pauses immediately before session insertion; another instance completes reset | The database rejects the stale version with the same result, closing the interval after application checks.                                                                                                                |
| Two users sign in concurrently with different credential versions                                | Both receive their own identity; the paused request retains its own snapshot.                                                                                                                                              |
| Ordinary/operator API attempts to alter credential security state                                | Rejected; stored state remains unchanged.                                                                                                                                                                                  |
| Disabled direct-change/admin password writers through HTTP and server APIs                       | Rejected before credential mutation. Email recovery continues to work.                                                                                                                                                     |

The previous proofs still pass: shared subject and original `auth_time`, PKCE/code/redirect protections, both devices' stale SSO rejection without app-cookie memory, signed updated reset claims, repeated recovery, legacy UTF-8 hash compatibility, operator permissions, and persistent rate limits. A temporary database fault table/trigger is removed after its test; the runner then stops its cluster and removes the private socket.

## Limits that remain material

**This is atomic credential state, not an atomic HTTP reset.** The provider consumes the recovery token before writing the password, and a later hook can still fail after the credential committed. A failed response may require a new recovery link or sign-in with the chosen password. Recovery UI and email must represent that ambiguity accurately; this fixture has neither real UI nor delivery.

**Only initial email/password signup and recovery of an existing credential are supported writers in this candidate.** `/change-password`, `/set-password`, `/admin/set-user-password` and admin user creation are disabled; server-side hooks also reject unsupported credential writes. Creating a first credential outside signup is blocked. These are restrictions on an undeployed proof, not authorization to remove an existing product flow. Before cutover, inspect every app's recovery/change flow and support any required writer, or demonstrate an acceptable recovery route with the team. Initial signup does not silently mark an email verified.

**Migration and hash upgrades are still gated.** The SQL guards currently treat every changed credential hash as a password change. A successful legacy verification does not rehash; future modernization needs an explicit, version-checked transaction that preserves the logical password's cutoff while preventing a concurrent reset from losing. Do not bypass the trigger from an ordinary login or use an unguarded update. Real user copy, source secrets, version backfill, restore and rollback remain unproven.

**Other authorization boundaries remain open.** This password version is not the durable operator-revocation epoch and does not revoke already-issued app cookies, tokens or wallet authority. Admin revocation races, in-flight OAuth exchanges, back-channel/RP logout, expiry, same-second retry behavior, three real browser origins, and numeric private-state/write bounds still require their staging evidence. No product adapter or Privy identity link was installed.

**Production must enforce the database dependency.** Use reviewed migrations under a separate owner, a restricted application role that cannot remove the guards, and startup/readiness checks for the required columns/functions/triggers. The local installer accepts only its synthetic socket; it is not a production migration or readiness implementation. Verify supported PostgreSQL versions, concurrent load/locking, backups, rollback and failure logging in Railway. Rebuild and rerun in the actual Linux image pinned to Node 24.21.0. An independently reported 24.19.0 package run does not replace that gate.

Hosting remains the existing Myosin Railway account and Arcade project, with the separate Accounts service/database planned in the existing repo. Nothing here provisions them or changes the shared-auth-before-leaderboard sequence.

## References

- Published `better-auth@1.7.4` reset/sign-in routes and database hook implementation, inspected locally.
- [Better Auth hooks](https://better-auth.com/docs/concepts/hooks) and [database schema/hooks](https://better-auth.com/docs/concepts/database).
- [PostgreSQL trigger functions](https://www.postgresql.org/docs/current/plpgsql-trigger.html).
- [Provider decision](BETTER_AUTH_PROVIDER_DECISION.md), [progress record](AUTH_PROOF_PROGRESS.md), [staging runbook](AUTH_STAGING_RUNBOOK.md).
