# Better Auth provider decision and proof gates

September 11, 2026. **Accepted for bounded implementation/proof; production migration remains gated.** Mateo requested an alternative without Auth0 subscription costs and confirmed that hosting should stay in the existing Railway account/project.

## Deployment boundary

Use the existing Myosin Railway account and **aegyo-arcade project**. Add an independently deployed Accounts service sourced from `services/accounts` in the Arcade repo, plus its own Postgres service/database. No new Railway account, organization, repository, or Auth0 purchase. Existing Arcade and Daebak databases remain separate authoritative product stores. Configure path-based deployment triggers so ordinary Arcade changes do not redeploy Accounts; pin each release to a reviewed commit. The service has independent deploy, health, restore, secrets and rollback settings.

Use `account.aegyoarena.com` for production once its DNS owner points it to the service. Use an isolated staging service/database and a stable staging hostname for G1; a Railway-generated hostname can support the initial proof before custom DNS is ready. Three distinct HTTPS staging product origins are required. No real users or production credentials belong in the local synthetic proof.

This explicitly supersedes the former “managed provider only,” “no new deployment/database/hostname,” and “do not implement an OAuth server” architecture choices. The replacement is **a maintained open-source provider operated by us**, with standard client libraries; we do not write a new OAuth protocol. Member profiles/usernames and competition data can remain in the lean Arcade module, while credentials, provider sessions and authoritative security cutoffs live in the independent Accounts database. Protected identity checks must not depend on Arcade's UI deployment.

There is no Better Auth license subscription. Compute, database, backups and transactional email still consume Railway/Mailjet capacity or incur usage charges. No new billable Railway resource has been provisioned by the local proof. Privy's exact production JWT entitlement and cost are pending its support response; a provider switch does not remove that question.

## Implementation defaults

- Pin the service runtime to **Node 24.21.0** in `package.json` and `.node-version`; reject mismatched installs/proof runs. The audit-follow-up proof passed under that exact binary on macOS (10 provider tests and 3 password tests). Match the future Railway image/runtime and rerun inside Linux before deployment; a macOS package proof is not container evidence. Review Node security updates alongside package advisories.

- Pin `better-auth` and `@better-auth/oauth-provider` to **1.7.4**, commit the independent service lockfile, and install with `npm ci`. The current packages are MIT licensed. Use the new OAuth Provider plugin, not the deprecated `oidcProvider` plugin.
- Three statically administered first-party clients; exact callback/logout URLs; authorization-code flow, S256 PKCE, state and nonce. Turn off dynamic/public client registration, ordinary-user client administration, unused grants and automatic account linking. Initially email/password only. No wallet runtime on Aegyo or Arcade.
- Database-backed rate limiting, explicitly enabled in staging too. Verify the Railway edge's client-IP header behavior against spoofing; do not trust arbitrary forwarded headers. Use shared counters across instances and verify rate limiting against requests through the actual public handler, not only `auth.api`.
- Set `revokeSessionsOnPasswordReset: true`, disable provider cookie-session caching, and prove forced login, silent renewal, session expiry and reset behavior. Sessions/claims must use original authentication time rather than token issuance time.
- Namespaced signed reset/cutoff claims read authoritative state. `passwordChangedAt` and an operator cutoff/security version are server-owned, never accepted from sign-up/profile input. No-reset is explicit; missing/malformed state fails closed. Preserve the existing strict reset comparison and bounded retry rule in app adapters.
- Build the sign-in, signup, verification and recovery pages/emails. Use Mailjet through a reviewed service-local sender: missing configuration or failed delivery must not silently report success. Never log reset URLs or tokens. Prove delivery, locale, consent, accessibility and return paths.

## Migration corrections

Custom `password.verify` makes the existing SHA-256 verifier possible; **it does not automatically rehash or eliminate credential migration**. Copying hashes into another database is a credential transfer even if no JSON export file is created. Keep source/target connections and manifests within authorized environments; preserve source IDs and email-verification state. The pepper moves privately from Simon's source environment into Accounts as a scoped secret. Record the transfer, access owners and eventual removal after no retained legacy credentials require it; never put its value in Git, logs or this document.

Freeze all credential/account writers, including in-flight requests, signup, reset, email change and admin/deletion paths. Copy into a closed target, reconcile IDs/relationships and deltas, then switch login and recovery together. Preserve Aegyo's existing local Session cookie/roles and all product records. Old reset links must lead to valid recovery. The auth source must never drift between old and new systems after activation.

Mark legacy hashes with an explicit version. Verify the exact UTF-8 password-plus-pepper bytes, then replace the legacy hash with the maintained modern hash **only through a race-safe update tied to the account, expected hash and credential version**. A password reset, deletion or concurrent upgrade must win over stale migration work. A `passwordChangedAt` column by itself is not synchronization. Hash modernization must not masquerade as a new password change or revoke otherwise valid users unnecessarily. Before runtime rollout, prove the complete hook/transaction path and an old-password login racing a reset, including interruption after hashing but before session issuance. The current local verifier intentionally does not persist a rehash.

## Revocation corrections

Deleting IdP sessions blocks subsequent authorization from those sessions; it does not erase already-issued product cookies/JWTs. Likewise, `revokeUserSessions`/`banUser` are useful provider controls, not automatically the three apps' durable operator cutoff. Back-channel logout is an accelerator requiring real delivery and client verification; do not assume every password/admin mutation emits it or that it is reliable by itself.

Retain authoritative cross-app security checks for sensitive writes and the existing maximum 30-second private-state visibility bound. Serialize/atomically protect password/cutoff/session transitions and test failures; the published reset route updates the credential, calls `onPasswordReset`, then deletes sessions. A throwing hook or in-flight old-password login can require more protection than enabling the flag alone. Demonstrate recovery from partial operations without admitting stale authentication. The local recovery hook does not cover authenticated password change or admin password-setting endpoints; every enabled writer needs the same authoritative policy before staging acceptance. Privy/wagmi cleanup remains distinct from revoking independent wallet keys or already-signed transactions.

## Proof evidence and remaining gate

`services/accounts` currently contains a **local-only package proof**, not a deployable IdP or application adapter. It accepts only its disposable local Postgres socket; no production connection/environment files, external email, credentials or Privy calls. `npm run proof` creates a fresh cluster, executes real provider handlers and verifies signed ID tokens, then shuts the cluster down. Three `.example.test` callback origins exercise protocol identity, not real three-site browser UX. Private cluster files stay ignored under `.proof`.

The local run passes shared subject/original `auth_time` across three clients, namespaced claim transport, `max_age=0`, stale session/no-session rejection, S256 enforcement, invalid verifier/code reuse, redirect mismatch, registration restrictions, two-device reset with no app-cookie memory, pre-reset authorization-code rejection, legacy hash verification and database counter persistence. Operator-only session revocation and bans also pass against the provider handlers. The audit follow-up adds `onPasswordReset` persistence and verifies the new signed timestamp for all three clients, across provider recreation and a second recovery, with forged profile-field input and reset-token replay rejected. Back-channel delivery, RP-initiated logout and revocation of already-issued product sessions remain unverified at runtime.

G1 still requires:

1. Three real HTTPS staging apps, real supported client adapters, exact redirects, validated state/nonce/audience and fresh-browser journeys. Local sessions and sensitive writes obey the numeric revocation bounds, including active-game preservation.
2. The two-device cleared-app-cookie reset test repeated in real browsers, plus same-second retries, hook/database failures, revocation/admin-ban races, previously issued tokens and refresh behavior if that grant is later enabled.
3. Restored Aegyo inventory, actual pepper verification and migration/freeze/rehash/rollback rehearsal with Simon; no lost IDs, ownership, roles or consent.
4. Privy entitlement and link-before-provision proof for existing identities; retain the link-table alternative as an explicit UX decision, not an automatic replacement for shared login.
5. Login/recovery/verification UI, Mailjet delivery, operator recovery, database backups/restore, deployment isolation, signing-key retention/rotation and security-monitoring evidence.

## Operations and dates

Mateo owns the IdP service and security maintenance; name backup coverage before launch. Review upstream advisories and lockfile audit daily during rollout and weekly afterward. Triage a relevant critical/high authentication advisory the same day and aim to deploy its validated fix within 24 hours; disable the affected path if it cannot be mitigated safely within that window. Re-run the provider/migration regression suite for upgrades, preserve signing keys, take a restorable backup, and record the reviewed release. Pinning fixes reproducibility, not future vulnerability exposure. Dependency/advisory notifications must be enabled and tested before production; no subscription or unattended monitor has been activated by this local task.

Auth0 purchase is removed from the critical path. September 12 end of day, America/New_York: report remaining Railway/DNS, email, Privy and Simon access dependencies. **September 14 end of day:** if three real staging origins and reset revocation are not demonstrated, escalate the missing evidence and revise scope/date explicitly. September 18 remains conditional; no additional engineering-time estimate is treated as proof that the deadline will hold.

## Primary sources

- [Better Auth OAuth Provider](https://better-auth.com/docs/plugins/oauth-provider), [password configuration/reset behavior](https://better-auth.com/docs/authentication/email-password), [database rate limiting and proxy trust](https://better-auth.com/docs/concepts/rate-limit).
- Published npm packages `better-auth@1.7.4` and `@better-auth/oauth-provider@1.7.4`, inspected locally and pinned in the service lockfile. `npm audit` reported no known vulnerabilities at initial installation; this is not a security guarantee.
- [Upstream security policy](https://github.com/better-auth/better-auth/security/policy), [upstream advisories](https://github.com/better-auth/better-auth/security/advisories). The quoted CVE concerns the older `oidcProvider`/MCP defaults; the API-key advisory concerns an optional plugin. Neither proves the selected configuration safe without our own tests.
