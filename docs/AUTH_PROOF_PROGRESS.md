# Shared-auth proof progress

September 11, 2026. Mateo authorized execution after closing the audit. **Phase 0 inventory and bounded Phase 1 local proof work have started. G1 has not passed.** Production login, sessions, wallets and game flows are unchanged.

Implementation worktree: `/Users/mateodazab/Documents/myosin/aegyo-arcade-auth-proofs`, branch `codex/shared-auth-proofs`. The original Arcade checkout and unrelated changes in the main-site and Daebak checkouts are preserved. No provider configuration was changed, no purchase was made, and no application was deployed.

## Current Better Auth proof — September 11

Mateo requested no Auth0 subscription, supplied the conditional Better Auth audit, and confirmed **the existing Myosin Railway account and aegyo-arcade project**, with separate service/database resources rather than extra hosting accounts. The [provider decision](BETTER_AUTH_PROVIDER_DECISION.md) and revised delivery plan/spec now make that the bounded implementation path. No Railway service/database or DNS change has been provisioned yet.

`services/accounts` is an independent local-only package with exact Better Auth/OAuth Provider `1.7.4` pins and its own lockfile. It is not imported by Arcade. A fresh disposable PostgreSQL cluster, reachable only over its private local socket, exercised the published request handlers and signed ID tokens. **After the audit follow-up, sixteen provider scenarios plus their containing test passed (17 reported tests), and 3 password component tests passed, all on Node 24.21.0.** No production connection, user export, real email or Privy call was involved. The local database was stopped after the run.

Observed: three separately registered synthetic HTTPS clients resolve the same subject; `auth_time` matches a deliberately older session creation time rather than new token `iat`; `max_age=0`, stale/no-session and S256/code/redirect protections work; password reset blocks both old device sessions and pre-issued authorization codes without remembering app cookies; existing unverified legacy-password identity survives; only the operator can revoke another user's provider sessions/ban login; database counters survive replacing the provider instance. The current candidate writes `passwordChangedAt`, increments a private credential version and deletes IdP sessions inside a PostgreSQL trigger on credential updates; this supersedes the standalone `onPasswordReset` write from `ea12413`. Verified ID tokens from all three clients contain the persisted timestamp after provider recreation, and a second recovery advances it. Forged profile input cannot overwrite the field; a consumed reset token cannot change it; another user's timestamp stays untouched. The [credential-transition proof](CREDENTIAL_TRANSITION_PROOF.md) now covers the database commit/rollback boundary and two paused-login races. It does not prove the full production control or make the entire HTTP recovery operation atomic.

**Corrections retained from source inspection:** custom `verify` does not persist a rehash; copying hashes still transfers credentials; admin/provider-session deletion does not revoke product cookies; the published reset route updates the password, runs the reset hook, then deletes sessions. The decision/runbook require safe transactions/versioning and concurrent reset/login/rehash plus hook-failure tests before rollout. The local fixture now also proves credential changes coupled to cutoff/version/session deletion and rejection of old concurrent logins. Back-channel delivery, durable operator cutoffs, product adapters, login/recovery/verification UI, Mailjet, real browser topology and Privy continuity remain open G1 work. No new scheduling/advisory monitor was activated.

The earlier revision passed **65 root auth-proof tests** and root TypeScript; those unchanged paths were not rerun for this isolated package follow-up. Scoped ESLint passes for the changed service paths. The service is JavaScript; the root TypeScript pass does not imply a separate service typecheck. The independent package install reported no known vulnerabilities. Real browser acceptance, migration and production safety are not inferred from component tests or an advisory scan.

The initial proof package is preserved in local WIP commit `784858e`; branch-review fixes are preserved in `739c202`. The branch review confirmed the original 54 component tests, typecheck, scoped lint and read-only inventory behavior. Its two full-suite failures were PostgreSQL integration files unable to connect to local port 5432; those database tests remain unverified in that environment, not passed or evidence of a deployed regression. The fixes from that review are recorded below and checked separately.

## Credential-transition follow-up to `ea12413` — September 11

The independent auditor reported 3/3 password and 10/10 provider cases under Node 24.19.0, invoking the test files directly because their machine lacked the exact pin. That is useful independent package evidence, not a pass of the 24.21.0 launcher or Linux image gate. This workspace still has the checksum-verified 24.21.0 binary under ignored `.proof/runtime`.

Continued the authorized local proof to address the remaining failure/race cases. The current candidate uses an explicit database guard migration plus a credential-version snapshot taken before password verification. It passes failures after the credential commit, rollback on failed session deletion, and resets completed while another provider instance pauses an old-password login either after verification or immediately before session insertion. Concurrent unrelated logins retain independent snapshots. Unproven direct-change/admin password writers reject HTTP and server API calls; ordinary and operator profile updates cannot set security state. These restrictions apply only to the undeployed candidate, and recovery compatibility must be checked before any product cutover.

Validation: **17/17 provider tests** (16 scenarios plus their containing test), **3/3 password tests**, zero skips, all under **Node 24.21.0**; scoped ESLint and diff checks clean. No package or runtime version changed. See [credential-transition evidence](CREDENTIAL_TRANSITION_PROOF.md) for the tested boundaries, remaining migration/rehash/operator/token races, and production readiness requirements. No Railway resource, database user, DNS or live application changed. G1 remains pending.

## Audit follow-up to `ba005a0` — September 11

The two findings are addressed locally. `onPasswordReset` performs a parameterized database update for the provider-selected user and refuses a missing row; `GREATEST` prevents an older cutoff write from moving the stored timestamp backwards. The package still runs only against its own disposable PostgreSQL socket. The new test covers a signed timestamp after reset for every client, another recovery, persistence across provider recreation, forbidden profile input and failed reset-token replay. Hook failure, concurrent credential/session transitions and authenticated/admin password writers remain explicit staging gates.

The package and lockfile now require **Node 24.21.0**, with `.node-version`, package-local `engine-strict`, and a runtime guard before tests or database creation. The verified run used the official macOS arm64 binary from [Node's release files](https://nodejs.org/dist/v24.21.0/), whose archive SHA-256 matched the published `SHASUMS256.txt`: `bed7eea5325e1108f32ce5228ddd6a5f0f08a499ee42aa7442aea583702f6057`. The downloaded runtime stays in ignored `.proof/runtime`; the machine's default Node and Arcade dependencies were unchanged. The default Node 26.0.0 was rejected, as intended. This replaces the earlier unqualified “Node 24+” declaration; the auditor's Node 22 run is historical evidence, not this pinned runtime run.

Validation: clean package `npm ci --ignore-scripts`; `npm test` **3/3**; `npm run proof` **10/10**, zero skips, on **Node 24.21.0**; scoped ESLint and diff checks clean. The runner completed its PostgreSQL shutdown and socket cleanup. No Railway image has been built or tested: its future runtime must use the same pin and rerun the proof inside Linux before deployment. No production service, credentials, user rows or DNS changed. G1 is still pending.

## Provider setup update — September 11

Mateo authorized handling the provider prerequisites. Auth0 dashboard access is now available under the Myosin account, with a new development tenant on Free. The account-specific checkout offers Professional B2C at **USD 240/month plus applicable tax, with 1,000 monthly active users**, monthly automatic renewal. This differs from the earlier public-page allowance. No payment method was saved, subscription purchased, client configured or user imported by this task. Mateo then asked for a solution without paying Auth0; the purchase path is on hold while evaluating the alternative below.

The Privy dashboard's Slack invitation is expired. Its contact form did not submit because it required additional social-profile/payment-volume information. Instead, the requested entitlement inquiry was sent to Privy's officially published `support@privy.io` from Mateo's existing personal account, identifying Myosin as the company. Gmail displayed **Message sent**. The inquiry requests the existing app's exact production custom-JWT tier/price and supported link-before-provision flow, including protection against direct client JWT provisioning. No configuration changes or upgrade were authorized in that inquiry. A response is still pending; sending the request is not entitlement approval.

**Candidate without an Auth0 subscription (subsequently adopted for the bounded proof above):** self-host Better Auth with its OAuth Provider plugin within the Arcade repo/backend, using isolated auth tables and three registered product clients. Current official npm metadata lists `better-auth` and `@better-auth/oauth-provider` version `1.7.4`, both MIT licensed. The [provider documentation](https://better-auth.com/docs/plugins/oauth-provider) describes authorization-code/PKCE and OIDC, and [email/password documentation](https://better-auth.com/docs/authentication/email-password) supports custom hash verification. These capabilities make an Aegyo legacy-password compatibility proof feasible; no migration or automatic hash upgrade is proven yet. Railway/database/email usage and ongoing operations still cost money or consume existing capacity.

This is an evaluated candidate, **not a completed replacement or a passed G1**. Preserve the audited account IDs, guest history, wallet ownership, freeze/rollback and contest rules. Reuse provider-independent tests and inventory tools; replace the Auth0-specific import format, Action and configuration only in a bounded alternative proof. Prove the released plugin's original authentication timestamps, forced login, silent renewal, reset/operator revocation, exact redirect validation, and cleared-cookie scenarios rather than assuming Auth0-specific evidence transfers. Privy production custom-JWT entitlement remains a separate question with this provider. The dual-session alternative still needs an explicit UX decision if it introduces another Privy login. Simon's main-site inventory/restore access remains necessary before migration.

## Verified source and access

| Product             | Refreshed source                                    | Observed production evidence                                                                        | Access result                                                                                                                                        |
| ------------------- | --------------------------------------------------- | --------------------------------------------------------------------------------------------------- | ---------------------------------------------------------------------------------------------------------------------------------------------------- |
| Arcade              | `1645b4f6edbe02af3621cc2b5a362b12ba43c41e`          | GitHub deployment `6206035327` succeeded; live custom domain resolves to the same Vercel deployment | Railway `aegyo-arcade`, service `postgres-prod`, environment `production`: aggregate inventory completed                                             |
| Aegyo / kpop-lyrics | upstream `480831930eea14322fe76f101e4c1ca7a628cb32` | GitHub deployment `6396729096`, Railway success at September 11 15:55:08 UTC                        | Main-site Railway project absent from accessible project list; production database inventory, actual salt and restored staging copy still need Simon |
| Daebak              | `cb972ad084d960733b2cfd4901c0cc490181a803`          | GitHub deployment `6204471035` succeeded; live custom domain resolves to the same Vercel deployment | Railway `Daebak Markets`, service `Postgres`, environment `production`: aggregate inventory completed; Privy dashboard access confirmed              |

Inventory is evidence about the explicitly selected Railway services. Deployment-to-database binding still needs verification from deployment configuration before migration; neither a service name nor a matching local environment file proves that binding.

## Completed local work

- `src/accounts/freshness.ts`: reusable server policy for already-verified OIDC claims. Requires `auth_time`, explicit reset state, authoritative operator-cutoff input and the stored `max_age` transaction. Covers absence of an old local cookie and stops after one failed fresh-login retry. It is not JWT verification or an installed adapter.
- `auth0/actions/password-reset-state.cjs`: staging Action candidate that emits reset state for the adapter fallback. It does not guess authentication-method timestamp semantics or claim centralized enforcement is already proven. No Action is deployed.
- `scripts/auth-proof/legacy-import.mjs`: pure Aegyo hash-to-import conversion with exact local-ID mapping, explicit UTF-8 suffix salt, verification-state preservation and collision rejection. No email-only linking or default production salt.
- `npm run auth:proof-fixture`: creates two synthetic users for the future authorized import job. No real user export or provider request.
- `npm run auth:inventory`: counts and schema metadata under a repeatable-read, read-only PostgreSQL transaction, with timeouts and rollback. No individual user, credential or wallet records fetched. Reports remain local and ignored by Git.
- `npm run auth:preflight`: checks explicitly supplied staging configuration without printing credentials. Missing configuration returns exit code 2, and complete configuration still does not mark runtime gates passed.

The main-site, Arcade and Daebak routes do not yet call the new policy. Real all-three OIDC callbacks, session renewal, migration and Privy linking remain staging work after the dependencies below are available.

The shared-login proof intentionally accepts **Auth0 database email/password connections only**. The Action emits `unsupported` for social/other connections and the policy denies it. This is deliberate launch scope, not a configuration error to bypass in staging. Existing Privy email/external-wallet login paths remain intact; preserve any discovered legacy social access before cutover. The Aegyo inventory now requires `EventRegistration` and `CommunityAnnotation` alongside `User`, `Session` and `PasswordReset`. A missing runtime table produces an incomplete result/exit code 2 for investigation; the collector still reads every public table.

## Inventory findings and external dependencies

The Arcade and Daebak inventories contain existing records, including Daebak users, grants and referrals. The authenticated Privy overview also contains existing users and wallets. **The zero-user shortcut is ruled out.** Preserve every legacy identity and link before provisioning; do not infer expendability from development-mode labels.

Private evidence is under `.auth-proof/`: the two dated database inventories and `privy-observation.json`. The latter records aggregate dashboard totals only. Both database transactions were read-only and rolled back. These are not backups or restore proofs.

The inspected Privy app matches the app ID in Daebak's local configuration. In **App settings → Integrations → Built-in**, custom authentication is **off**, marked **Scale**, and the dashboard says plugins are free in development with production features reviewed on upgrade. The app is in development mode. The current [public pricing page](https://www.privy.io/pricing) groups JWT authentication under a broader Developer comparison; this does not settle this account's production entitlement. Verify actual terms before treating custom JWT as an entitled production feature. Existing dashboard access is not evidence of enablement. No toggle or upgrade was made; the later support inquiry is recorded above.

Obtain written confirmation from Privy of this app's production entitlement and exact price before enablement. A dual-session link table avoids the custom-JWT feature dependency, but may require another Privy login in a fresh browser. It remains an explicit scope/UX choice; the approved shared-login requirement has not been silently relaxed.

Initially Mateo reported no known Auth0 tenant and no local Auth0 configuration was present. Dashboard access now exists as recorded above; paid entitlement, three clients, a database connection and production SMTP have not been configured. If Auth0 is retained, those dependencies remain. Do not import real users into a Free/trial-only arrangement. The self-hosted alternative requires its own configuration and runtime proof.

## Timestamp precision decision

The auditor proposed one or two seconds of acceptance tolerance. That also admits a provider login actually completed before the reset during that interval. The local proof uses a conservative alternative: compare the whole-second authentication time against the full reset/operator cutoff, then schedule the single interactive retry after the next whole-second boundary. With aligned clocks this adds at most one second before starting the retry and does not widen the cutoff. Staging must prove the adapter honors the delay, removes `prompt=none`, creates a fresh authorization transaction, and ends safely on a repeated denial.

Separately, provider-versus-app clock disagreement now permits `auth_time` and the provider's reset timestamp up to **five seconds ahead** of the application clock. Larger disagreement fails closed. This allowance only affects future-timestamp sanity checks: it is never subtracted from the reset/operator cutoff or requested `max_age`. Applying it to the reset timestamp too prevents moving the same false rejection into `invalid_reset_state`. If a future cutoff needs a retry, the wait may be up to the five-second skew bound plus one second. The operator cutoff remains independently authoritative. Staging must align this policy with SDK claim-validation clock settings and measure real behavior.

Normal SSO is not forced through `max_age=0` on each visit. The 300-second value in synthetic tests is a fixture value, not an approved production session lifetime or proof of the 30-second private-state requirement. OIDC network delays, SDK behavior, clock disagreement and source timestamp precision remain part of T28. Unsupported timestamp formats fail closed; collect sanitized shape/precision evidence in staging, never live tokens.

## Verification record

Verification completed after the branch-review fixes: **65 auth-proof tests passed**, TypeScript passed, and ESLint passed for all new code. Coverage includes cleared-cookie stale SSO, same-second reset/retry, missing or malformed claims, operator revocation, retry exhaustion, Action-to-policy compatibility, import hashes/collisions and read-only inventory behavior. These are component checks, not T27/T28 browser acceptance passes.

The five existing guest-session bootstrap tests also passed with `NODE_OPTIONS=--no-experimental-webstorage` in the proof worktree. An initial default-runtime run failed during `localStorage.clear()` cleanup; the untouched original checkout passed its baseline, and disabling Node experimental web storage resolved the worktree run. No existing application or test code was changed for that runtime issue.

Run from this worktree:

```sh
npm run test:auth-proof
npm run typecheck
```

The staging preflight currently fails as expected because provider configuration is missing. No Auth0 import job, reset-email delivery test, live silent-renewal test, restored-database freeze rehearsal, Privy link/provisioning test or production rollback test has run. No leaderboard code has started; shared auth remains first.

## Next executable gate

**September 12 end of day, America/New_York:** report service/DNS, email, Simon inventory/restore and Privy entitlement readiness. **September 14 end of day:** if the independent IdP is not serving three real HTTPS staging origins with reset revocation demonstrated, escalate the missing evidence and scope/date. September 18 stays conditional. No automatic follow-up is active.

1. Build the service entry point, pages, authoritative cutoff/rehash transaction path and three real client adapters. Deploy only the isolated staging service/database in the existing Railway account/project after its configuration is reviewable; the current package is local-only.
2. Obtain Simon's Aegyo inventory/restore access and verify the effective hashing secret privately. Rehearse the controlled copy, freeze, concurrency and rollback path.
3. Complete [staging runbook](AUTH_STAGING_RUNBOOK.md) evidence: email, three-origin browser login, local-session revocation, active-game preservation and Privy link-before-provision/direct-call checks. Await Privy's written production entitlement before feature enablement.
4. Review G1 evidence, then roll out the all-three account foundation. Verified competition follows shared auth; no scope or wallet-continuity shortcut is implied by the provider change.

Execution authorization persists. The remaining work is implementation, real runtime evidence and access/configuration, not another Auth0 purchase decision.
