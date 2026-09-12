# Shared auth implementation checkpoint

September 12, 2026. This checkpoint records completed code and local evidence. It does not activate shared login or authorize a production data migration.

## Code completed in this development pass

| Product  | Change                                                                                                                                                                                                                    | Commit                                     |
| -------- | ------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- | ------------------------------------------ |
| Accounts | Executable private source snapshot, known-password/deployed-pepper check, exact issuer validation, atomic user/credential/mapping journal, uncertain-commit recovery and safe exact retry; direct email-verification link | `c1f073a`                                  |
| Aegyo    | Verified new-user provisioning, exact-identity concurrency, normalized legacy-email collision refusal, existing role/profile/ownership preservation, plain recovery pages and verification link                           | `8243a9d`, `96a9cb6`, `0dc7264`, `6797c16` |
| Aegyo    | Reviewed-manifest operator tool with separate mapping install/status/activation, complete local ID/role checks, digest checks, consistent status and no post-activation mapping repair                                    | `6797c16`, `e7ab7e2`                       |
| Daebak   | Opt-in account-linking page/menu and authenticated status, explicit confirmation, expired/conflicting/unavailable states, guarded asynchronous UI responses                                                               | `7d968f2`, `106cb48`                       |
| Daebak   | Actual PostgreSQL/Drizzle proof of immutable, idempotent linking and unchanged existing product records                                                                                                                   | `106cb48`                                  |

Aegyo is pushed to the existing fork branch and [draft PR #12](https://github.com/Francisgood/kpop-lyrics/pull/12), with its description rewritten for the final behavior. No merge occurred. Accounts and Daebak changes are committed locally; Daebak's automatic production-migration build behavior still requires a controlled deployment path.

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

1. Deploy the latest candidates to isolated staging and exercise real Accounts → Aegyo → Arcade → Daebak browser journeys, including fresh-browser sessions, verification, recovery, logout/revocation and expired sessions. The previously deployed Accounts/Arcade staging services are not evidence that this pass's latest code is deployed.
2. Run the full-data restore/freeze/import/reconciliation rehearsal with the private operator runbooks. A source credential freeze is an external condition: the importer detects drift but cannot create a cross-service freeze itself. The local mapping installer checks IDs/roles/mappings; the separate ownership reconciler still checks every linked record.
3. Close the previously identified delivery/domain/rollout dependencies and review production activation. Do not run either `apply` or `activate` against production on the strength of local tests alone.
4. Proceed with the competition/leaderboard after the shared-auth acceptance gate, as agreed.

Daebak's implemented fallback requires both existing Privy authentication and shared Accounts authentication. It preserves the wallet but does not turn Privy into automatic shared SSO. The gated custom-auth path and fresh-browser continuity decision remain explicit acceptance items. Automatic legacy password rehash also remains disabled; retain the pepper while imported credentials use it. Signup does not automatically subscribe or reactivate users in Beehiiv; existing newsletter forms are unchanged.

This pass changed no production accounts, wallet identities, balances, grants, referrals, histories, DNS records, email sends or deployment configuration.
