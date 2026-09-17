# Shared auth implementation checkpoint

September 12, 2026. This checkpoint records completed code, local evidence and synthetic staging evidence. It does not activate shared login or authorize a production data migration.

## Code completed in this development pass

| Product  | Change                                                                                                                                                                                                                    | Commit                                     |
| -------- | ------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- | ------------------------------------------ |
| Accounts | Executable private source snapshot, known-password/deployed-pepper check, exact issuer validation, atomic user/credential/mapping journal, uncertain-commit recovery and safe exact retry; direct email-verification link | `c1f073a`                                  |
| Aegyo    | Verified new-user provisioning, exact-identity concurrency, normalized legacy-email collision refusal, existing role/profile/ownership preservation, plain recovery pages and verification link                           | `8243a9d`, `96a9cb6`, `0dc7264`, `6797c16` |
| Aegyo    | Reviewed-manifest operator tool with separate mapping install/status/activation, complete local ID/role checks, digest checks, consistent status and no post-activation mapping repair                                    | `6797c16`, `e7ab7e2`                       |
| Daebak   | Opt-in account-linking page/menu and authenticated status, explicit confirmation, expired/conflicting/unavailable states, guarded asynchronous UI responses                                                               | `7d968f2`, `106cb48`                       |
| Daebak   | Actual PostgreSQL/Drizzle proof of immutable, idempotent linking and unchanged existing product records                                                                                                                   | `106cb48`                                  |

Aegyo is pushed to the existing fork branch and [draft PR #12](https://github.com/Francisgood/kpop-lyrics/pull/12), with its description rewritten for the final behavior. No merge occurred. Accounts and Daebak changes are committed locally. Isolated staging images now avoid the ordinary production migration build commands; the existing production deployment path remains unchanged.

## Verification

- **Accounts:** 26 unit/runtime/UI/email checks plus 39 PostgreSQL checks passed under the exact pinned Linux Node 24.21.0 image, zero skips. The proof ran with runtime networking disabled. It executes the real importer CLI and provider, including actual password recovery after import. Image and commands are recorded in [the import runbook](LEGACY_IMPORT_RUNBOOK.md).
- **Aegyo:** parent reran 49 passing tests and TypeScript. Four gated tests passed separately in the disposable PostgreSQL 18 runner using actual Prisma queries. These cover concurrent callbacks, old mixed-case/whitespace emails, the operator CLI, mapping coverage, activation digest mismatches and refusal to recreate missing mappings after activation.
- **Daebak:** parent reran 27 passing focused tests and TypeScript. The additional gated proof passed against disposable PostgreSQL 16 with the actual migrations and production Drizzle store: eight simultaneous identical links produced one insert, both takeover directions were refused, and existing users/grants/referrals/other product rows and database roles remained unchanged.
- Scoped lint, formatting and diff whitespace checks passed. Temporary proof databases/containers were cleaned up. The unrelated existing edit in `AUTH_PROOF_PROGRESS.md` was preserved.

## Review findings resolved

The importer now checks the actual discovery issuer ending in `/api/auth`, not a bare hostname. It requires a privately reviewed deployment-pepper fingerprint and a known staff/canary source password before inserts. Snapshot serialization and reading share a 16 MiB UTF-8 size limit, so a successful export cannot produce an unreadable import artifact.

Aegyo detects normalized-email collisions with parameterized `lower(btrim(email))`, compares population by keyed ID/role rather than database-dependent ordering, and treats an existing activation latch as verification-only. Unverified users have a direct route to email verification rather than an SSO retry loop.

Daebak does not claim a failed network response means a link was not committed. It rechecks status, rejects stale UI responses after identity changes, and distinguishes service outages from expired login.

## Next execution boundary

1. Complete the remaining staging gates: actual delivered verification/recovery email, user-driven Daebak wallet-ownership linking, expiry journeys and any required endpoint-specific logout/receiver cases. Current-browser cross-product Accounts sign-out now passes the additional proof linked below. The eleven cross-product browser checks below now pass; they do not stand in for these remaining cases.
2. Run the full-data restore/freeze/import/reconciliation rehearsal with the private operator runbooks. A source credential freeze is an external condition: the importer detects drift but cannot create a cross-service freeze itself. The local mapping installer checks IDs/roles/mappings; the separate ownership reconciler still checks every linked record.
3. Close the previously identified delivery/domain/rollout dependencies and review production activation. Do not run either `apply` or `activate` against production on the strength of local tests alone.
4. Proceed with the competition/leaderboard after the shared-auth acceptance gate, as agreed.

Daebak's implemented fallback requires both existing Privy authentication and shared Accounts authentication. It preserves the wallet but does not turn Privy into automatic shared SSO. The gated custom-auth path and fresh-browser continuity decision remain explicit acceptance items. Automatic legacy password rehash also remains disabled; retain the pepper while imported credentials use it. Signup does not automatically subscribe or reactivate users in Beehiiv; existing newsletter forms are unchanged.

This pass changed no production accounts, wallet identities, balances, grants, referrals, histories, DNS records, email sends or deployment configuration.

## September 12 staging result — 17:42 UTC

The existing Railway project now runs all three product previews against Accounts,
with isolated logical product databases and scoped runtime logins. No new Railway
account was created. The final deployed candidates are:

| Service  | Source commit                      | Successful Railway deployment          |
| -------- | ---------------------------------- | -------------------------------------- |
| Accounts | `6434293`                          | `80a50d74-3ce3-453f-a045-ef0809b72385` |
| Aegyo    | `0c36773`                          | `d6844960-0524-4314-b4a6-7e31a7959e02` |
| Arcade   | Existing staging adapter candidate | `42427b71-3db6-4ce2-9d29-1053bbb7486e` |
| Daebak   | `c51f1aa`                          | `cad82133-f3ca-4251-8530-b25e589decb8` |

**Eleven real-browser checks passed** across the four HTTPS origins. They prove
Arcade guest-cookie preservation, Aegyo existing local ID/profile/moderator-role
preservation, cross-product provider SSO, Daebak local logout, verified new-user
provisioning without duplicate mappings, password recovery and invalidation of
both retained product sessions and stale provider cookies. All three retained
product sessions rejected authorization **20.743 seconds after reset**. A clean
browser then authenticated with the new password. The pending recovery journal
was removed only after that login succeeded.

Aegyo and Daebak runtime probes independently confirmed the expected restricted
role, staging database and TLS-enabled connection. Daebak's probe used the same
pinned postgres-js 3.4.9 client in an ephemeral operator bundle because Next's
standalone build folds that dependency into private application chunks. It ran
one read-only query and left no runtime file or package installation.

The pinned Linux Node 24.21.0 proof passed **26 unit/runtime/UI/email checks plus
40 PostgreSQL checks (66 total), zero skips**, with runtime networking disabled.
Image: `sha256:b23e64cbbcd5eaacedff242eea4578b7311d6a6bd9bf11549547f2ec490d693b`.
Scoped lint, formatting and diff checks passed.

Staging exposed and resolved two application/deployment issues: Daebak's origin
check rejected Railway's internal reconstructed URL, so it now checks the
canonical public Host without trusting forwarded-host headers; and the provider
omitted standard profile/email claims from ID tokens. Accounts now explicitly
emits those claims only under their granted scopes, with verification status
read from its own user record. Signed-token tests cover all three clients,
unverified users and omission when scopes are absent. Aegyo's staging Dockerfile
also drops a cache mount incompatible with Railway's builder.

Earlier build failures and partial browser runs are not acceptance evidence.
The final complete browser report is private; SHA-256:
`58b22ce33602ed166a29d7b2bc3ebb343885e9517b03379843faf618746b605e`.
Screenshots were visually inspected. The temporary database TCP proxy was
removed and **zero remaining proxies** were verified for this staging database.

See [the cross-product staging runbook](CROSS_APP_STAGING_PROOF.md) for the exact
scope, safeguards and replay procedure. This is synthetic acceptance, not a
production account migration or an email-delivery/Privy-linking approval.

## Deployment and logout recheck

[Deployment readiness](DEPLOYMENT_READINESS_STATUS.md) records a fresh 20-assertion
HTTP check across all staging services and the existing production sites, plus
five new deployed browser logout checks (`9765150`). All passed. The cross-product
sign-out invalidation took 26.396 seconds and preserved both Arcade guest identity
and a different independently authenticated browser session. Aegyo can be tested
in its preview before upstream PR #12 merges; production still uses the existing
login system in all three apps. Mailjet remains suspended and domain ownership
pending in the user's signed-in Chrome account. No production release or DNS
change occurred during this recheck.

## September 12 follow-up: migration interoperability and token revocation

- `cb2c929`: four-check synthetic rehearsal joins the actual Accounts importer to
  Aegyo reconciliation, mapping installation and activation; old-password identity
  and local data stay stable, and retries are idempotent.
- Aegyo `c64537a` / `e843a8b`: actual PostgreSQL backup/restore and complete original
  row comparisons pass, including event registrations and community annotations.
- `4134d9f` / `3841cf5`: reset and operator revocation now remove OAuth tokens
  transactionally. The guarded owner upgrade and revision-2 readiness prevent
  silently deploying against old database functions. Linux proof: 26 + 41 passing,
  zero skipped; image
  `sha256:0f4413539ee8479b88b6d38c638cbc712c0bbf998261bb5848959fc139793a88`.
- Isolated staging upgrade committed over Railway SSH with no public DB proxy.
  Accounts deployment `15423d18-07b4-478d-b795-77c42ea54d57` reached SUCCESS;
  readiness and all 20 HTTP assertions pass. Five browser logout checks pass again,
  with cross-app invalidation observed in 25.772 seconds.

See [deployment readiness](DEPLOYMENT_READINESS_STATUS.md),
[the executable cutover rehearsal](SYNTHETIC_CUTOVER_REHEARSAL.md) and
[the explicit guard upgrade](CREDENTIAL_GUARD_UPGRADE.md). No production data or
production auth was migrated. Real-data reconciliation/canary, working email,
production DNS and the real Privy ownership journey remain acceptance gates.
