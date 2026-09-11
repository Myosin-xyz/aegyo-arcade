# Delivery plan: shared accounts first, Arcade championship second

Status: **execution authorized by Mateo; Phase 0 inventory and bounded Phase 1 local proofs started; G1 and production rollout pending**\
Version: 0.5 — September 11, 2026; self-hosted Better Auth proof selected\
Engineering: Mateo with Codex\
Business owners: Simon and Fernando\
Deadline: the monthly Arcade contest must be live **before September 21, 2026**.\
Target: September 18 rollout, with September 19–20 reserved for recovery and verification if coverage is available.

> **Current provider decision:** [Better Auth provider decision](BETTER_AUTH_PROVIDER_DECISION.md) supersedes the managed Auth0 path and the former no-new-infrastructure constraint. Use the existing Myosin Railway account and aegyo-arcade project, with a separate Accounts service/database from this repo. Mateo confirmed this shared account/project arrangement. No Auth0 purchase is required.

> **Execution:** [proof progress](/Users/mateodazab/Documents/myosin/aegyo-arcade-auth-proofs/docs/AUTH_PROOF_PROGRESS.md). Local package proofs are underway; real three-app browser acceptance, Aegyo restore/migration and Privy continuity remain pending. Privy production JWT terms have been requested by email, not approved.

> **Checkpoints:** September 12 end of day, America/New_York: report service/DNS, email, Privy and Simon access readiness. September 14 end of day: demonstrate three real HTTPS staging origins and reset revocation or escalate scope/date. September 18 remains conditional.

## 1. Decisions this plan implements

The team call resolves the earlier account-scope question: **Aegyo Arena, Arcade, and Daebak need one shared authentication system and public username.** Build and validate that foundation first, then implement the account-based Arcade championship. Existing users, their data, and their access are release requirements, including when the real account population is small or zero.

Simon's September 11 message sets the nearer deadline. The September 22 dance event and creator campaign should send people to a working monthly competition, not a placeholder leaderboard. The older September 23 delivery estimate and October-only competition start are superseded.

Chat is a separate, subsequent phase: the call describes **24/7 standalone community rooms**, not scheduled event-only rooms or game lobbies. Chat, mobile distribution, replacement games, and points for non-game actions do not delay this auth-and-leaderboard release. This is the proposed sequencing for Mateo's audit; it does not assert that the team has approved every launch rule below.

Read this document for sequencing, scope, dependencies, and acceptance. The companion [technical specification](/Users/mateodazab/Documents/myosin/aegyo-arcade/docs/UNIFIED_ACCOUNTS_AND_ENGAGEMENT_TECH_SPEC.md) defines the detailed identity contracts, migration journal, session handling, score verification, and failure cases. This plan controls dates and phase scope if an older planning document differs.

## 2. What we know, and what access actually blocks

Read-only checks on September 11 established:

| Surface                  | Evidence                                                                                                                         | Consequence                                                                                                                                                                                                                                                                                                                                                                             |
| ------------------------ | -------------------------------------------------------------------------------------------------------------------------------- | --------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| Local main-site checkout | `myosin/kpop-lyrics`, local commit `f7e8400`, July 20                                                                            | It is an existing fork, not a missing repository. It must be brought up to the verified production base in an isolated implementation branch.                                                                                                                                                                                                                                           |
| Fork                     | `mateodaza/kpop-lyrics`; current GitHub credentials have admin/write access                                                      | We can develop in the fork and submit an upstream PR without waiting for maintainer access.                                                                                                                                                                                                                                                                                             |
| Upstream                 | `Francisgood/kpop-lyrics`; Mateo identifies it as the main repo; readable, no write/maintainer permission                        | Simon can merge/deploy reviewed changes, or grant the necessary role. A maintainer grant is convenient, not the only valid delivery route.                                                                                                                                                                                                                                              |
| Current upstream source  | `eca06cd8cf79bda305e38e3230c534ac841b2897`, September 11                                                                         | Auth helpers, login/signup/recovery routes, and Prisma schema match the previously inspected code. Package/build, middleware, configuration, and event features have changed. This SHA was deployed at 15:24:54 UTC, then superseded by 480831930eea14322fe76f101e4c1ca7a628cb32 at 15:55:08 UTC. The subsequent diff changes polls; refresh the production base before implementation. |
| Arcade local source      | `1645b4f`, September 1                                                                                                           | Guest/device identity and cosmetic weekly rankings exist. Prize-grade account ownership and score verification still need implementation.                                                                                                                                                                                                                                               |
| Daebak local source      | `cb972ad`, September 1                                                                                                           | Privy identity and wallet/reward associations must survive central-account activation. Production parity remains to be verified.                                                                                                                                                                                                                                                        |
| New event registration   | Upstream `/api/events/register` writes a runtime-created `EventRegistration` table and optionally subscribes an email to Beehiiv | An attendee or newsletter subscriber is not automatically a verified member. Registration records and marketing choices must be preserved.                                                                                                                                                                                                                                              |

The main-site Railway project/environment and latest successful deployed SHA are now evidenced by GitHub deployment records. Production account counts, the exact database service, custom-domain routing, dashboard build/start overrides, branch/auto-deploy settings, provider settings, and restore capability remain unverified. We have not read production secret values or modified provider settings, application code, or live data for this plan. Existing unrelated changes in the three worktrees remain untouched.

### Confirmed main-site deployment

The upstream repository now records Railway deployment **6396729096**, created by `railway-app[bot]` for **`kpop-lyrics / production`**, with a successful status at **September 11, 2026, 15:55:08 UTC** for commit `480831930eea14322fe76f101e4c1ca7a628cb32`. This supersedes deployment 6396169464 of `eca06cd8`, which was the successful deployment when first inspected. Production snapshots are observations at a point in time, not permanently fixed implementation bases.

- [Railway project and production environment](https://railway.com/project/a719c26e-33b9-4a1c-8759-d5401c1e181a?environmentId=27e2f29a-5846-48f8-9727-694a97c36ef6).
- [GitHub deployment status evidence](https://api.github.com/repos/Francisgood/kpop-lyrics/deployments/6396729096/statuses).
- Source corroboration: `.gitignore` mentions Railway builds; current middleware explicitly discusses Railway hosting. `deploy.sh` is a generic install/migrate/seed/build script and does not itself identify the cloud host. An `@vercel/otel` dependency is not evidence of Vercel hosting.
- Prisma config specifies PostgreSQL, but this does not identify the actual database service or prove it is in the same Railway project. The Next.js app contains the existing auth API routes; a separate hosted auth service has not been evidenced.

This establishes a concrete Railway access target for Simon/Mateo. Confirm current service, domain, database, deployed settings, and release permissions there before implementation/cutover; GitHub records alone do not reveal those settings or prove current live-domain routing.

**We can start after plan approval using the fork and the other two repos. Completing production integration requires access or an available operator for the live services.**

| Dependency                                                                                            | Needed for                                                               | Owner / alternative                                                                                                              |
| ----------------------------------------------------------------------------------------------------- | ------------------------------------------------------------------------ | -------------------------------------------------------------------------------------------------------------------------------- |
| Confirm production repo, branch, deployed SHA, build/start commands, and service/project for each app | Correct implementation base and reliable rollout                         | Simon for Aegyo; Mateo for Arcade/Daebak. Do not assume all frontends use the same host.                                         |
| Main-site merge/deploy path and named backup                                                          | Shipping the compatible auth adapter and rolling back safely             | Mateo permission, or Simon performing reviewed releases.                                                                         |
| Database catalog, aggregate counts, migration history, and isolated restore                           | Data-preservation baseline and rehearsals                                | Authorized database access or Simon performing the bounded inventory/restore. No production PII belongs in Git or this document. |
| Existing Privy tenant configuration and custom-auth availability                                      | Proving existing identity/wallet continuity                              | Mateo; provider enablement may require an external response.                                                                     |
| Independent Accounts service/database, stable issuer hostname and email delivery                      | Actual shared login and recovery                                         | Mateo plus the team's account/billing owner.                                                                                     |
| Existing Arcade hosting/database and all product callback configuration                               | Hosting the lean Accounts module and validating current-origin redirects | Mateo and the existing hosting operators; same Railway account/project, separate IdP service/database and hostname.              |
| Prize rules, allocation, claim process, and launch sign-off                                           | Opening the advertised contest                                           | Simon/Fernando and the existing promotion-policy owner.                                                                          |

The first phase must turn every dependency into **available, delegated to a named operator, or blocked with a deadline**. Shared Railway/Vercel ownership by itself proves none of these settings.

## 3. Seamless experience for existing users

First establish whether current users exist and which journeys they use. Counts must distinguish main-site accounts, active sessions, newsletter subscribers, event attendees, Privy identities, wallet connection methods, and Arcade devices. Do not manufacture accounts from contact lists or equate a device count with a person count.

| User journey                                               | Intended experience                                                                                                                                                  | Required evidence                                                                                                          |
| ---------------------------------------------------------- | -------------------------------------------------------------------------------------------------------------------------------------------------------------------- | -------------------------------------------------------------------------------------------------------------------------- |
| Existing Aegyo member                                      | Current credentials still work; familiar login entry points and return destination remain. Password recovery works before and after activation. No mass reset email. | Returning, dormant, reset-in-progress, and already-signed-in test cases; same local user/content/roles.                    |
| Existing Daebak member                                     | Existing sign-in methods, wallet, rewards, and transactions remain accessible. Shared-account activation does not look like starting a new wallet.                   | Same Privy ID, embedded EOA/smart-account association where applicable, reward/referral records, and wallet-lane behavior. |
| Existing Arcade guest                                      | Continue playing and seeing device history/streaks. Sign-in is offered at a natural break and is required only to enter the official competition.                    | No mid-game redirect; original guest history and daily rules survive account login/logout.                                 |
| Person already signed in to one product                    | After any necessary first-time activation, moving between products recognizes the same member; an automatic top-level redirect may occur.                            | Same member across the existing domains, no repeated registration, no unexpected destination or language change.           |
| Person with both Aegyo and Daebak accounts                 | A short, explained linking step proves ownership when needed; existing assets and permissions are not silently merged.                                               | Same-email and different-email accounts, Apple relay addresses, and conflicting links tested.                              |
| Newsletter subscriber or event attendee without an account | Keep the original subscription/registration. Offer verification and member activation when they choose to join the contest.                                          | No unrequested account creation, no copied marketing consent, no public email-derived username.                            |
| New user                                                   | Register through the shared provider, verify contact information, choose a username, return directly to the contest.                                                 | One member/local projection per app, retry-safe enrollment, no wallet created merely by visiting Aegyo or Arcade.          |
| Shared device or switched account                          | Each member keeps their own points; guest records are not handed to the next person who signs in.                                                                    | Account A/B switch, logout, two tabs, and two devices cannot change run ownership or reset a quota.                        |

### Preservation rules

- Preserve source IDs and product databases. Add mappings; do not rewrite ownership or transfer assets.
- Existing passwords are verified only through the supported legacy migration path. Track which system owns recovery after activation; an old reset route must never claim success against an obsolete credential.
- Match identities through verified issuer/subject and explicit ownership proof. Email equality is a candidate for linking, never permission to merge accounts.
- Select a public username when the member first needs one for competition/chat. Existing reading, wallet access, and guest play do not gain a username wall. Preserve old profile names, slugs, follows, and contribution links.
- Preserve newsletter/event opt-in state independently of authentication. Do not automatically re-subscribe or enroll an existing contact in the contest.
- Do not bulk log everyone out to deploy auth. Revoke sessions deliberately for security events; handle normal activation with a compatible transition.
- Keep recoverable access for both migrated and unmigrated users. Dormant users may migrate on return; we do not need every dormant account imported before launch.
- Use neutral messages such as “Connect your existing account to keep your profile and progress.” Conflicts get recovery/help, not a blank account or an unexplained error.
- No migration deletes acknowledged records. Deliberate user deletion requests remain supported; retaining every record forever is not the preservation policy.

“Seamless” does not mean skipping ownership proof. A one-time confirmation may be necessary; avoid repeated prompts and never conceal a failed link behind an apparently successful new account.

## 4. Architecture approved for the proof

Run Better Auth 1.7.4 plus its maintained OAuth Provider plugin in an independent Accounts service/database within the **existing Myosin Railway account and aegyo-arcade project**. Source it from `services/accounts` in this repo, with independent release/watch paths. Use `account.aegyoarena.com` once DNS is configured; stable isolated Railway staging hostnames can support G1. No new hosting account or repo. Compute, database, backup and email usage still need operating capacity.

Keep member/profile/username and competition records in the lean Arcade module. Keep credentials, IdP sessions and authoritative security state in the dedicated Accounts database. Each app retains its local IDs, data and session adapter; Aegyo's adapter mints its existing Session cookie. Preserve Daebak's current Privy identities and wallets.

```text
Existing Myosin Railway account / aegyo-arcade project
  Accounts service (services/accounts) -> dedicated Accounts Postgres
    -> Aegyo: existing Session cookie and local user ID
    -> Arcade: guest history plus authenticated member/competition
    -> Daebak: existing Privy identity/wallet authorization
```

This is a maintained open-source provider operated by us, explicitly replacing the former managed-provider-only restriction. Use standard OIDC clients, top-level redirects, exact callback URLs, state/nonce and S256 PKCE. Do not copy bearer tokens or session cookies between product domains. An Arcade UI/game deploy must not deploy the IdP.

### Migration and provider dependencies

Follow the [provider decision](BETTER_AUTH_PROVIDER_DECISION.md) for the credential freeze, controlled row copy and versioned verify-and-rehash proof. Copying password hashes and transferring the pepper between controlled databases/environments remains sensitive credential movement. Preserve original IDs, verification flags, roles and product data. No post-cutover reconciliation may overwrite a newer password or resurrect a deleted identity. Custom verification is not automatic rehashing; exercise concurrent reset/login/rehash and failures before rollout.

Build login, signup, verification and recovery pages; configure real Mailjet delivery. Enable database-backed rate limits and validate trusted proxy headers. Pin exact versions and maintain the advisory/patch process in the decision record.

Privy's production custom-JWT tier/price and supported link-before-provision flow remain open. The request was sent to support; no enablement occurred. Existing identities rule out the zero-user shortcut. A recurring independent Privy login remains an explicit scope/UX choice.

### Reset, freshness and revocation

Enable `revokeSessionsOnPasswordReset`, disable provider cookie-session caching, and prove original session-creation `auth_time`, `max_age=0`, silent renewal and reset behavior on the released package. Signed custom claims carry current reset/security state; make security fields server-owned. Keep strict reset/operator cutoff comparisons and bounded interactive retry. Admin session revocation/ban and back-channel logout complement, but do not replace, authoritative checks on existing product sessions.

Deleting IdP sessions blocks later authorization from them. It does not automatically revoke existing app cookies or solve an in-flight old-password login racing reset. Prove complete credential/cutoff/session transactions, hook failures, code/token reuse and operator races. Every sensitive write still checks current security state; private-state visibility is bounded by the agreed maximum 30 seconds. Renewal must preserve active games. Real two-device cleared-app-cookie testing across all three staging sites remains a G1 requirement.

## 5. Phases, deliverables, and exit gates

The auditor has approved the lean proof structure. Mateo has authorized the execution handoff. Budget authorization and required access remain explicit; technical audit approval does not purchase services or approve production migration. G1 is produced by bounded implementation in staging, then gates wider rollout. Routine reversible work within the authorized phase does not require repeated confirmation.

### Phase 0 — Freeze scope and establish the release path

**Owner:** Mateo; Simon/Fernando resolve business and access items.\
**Planning window:** September 11; actual start depends on audit completion.

Deliverables:

1. Record the lean architecture, service owner, release path, deadline/timezone, provider budget approval, and launch rules in §6. No new repository is required; the IdP uses a separate Railway service/database in the existing project.
2. Confirm deployed source for all three apps. After approval, create isolated `codex/` implementation branches/worktrees from that source; preserve current fork changes and unrelated working-tree work. Submit main-site work through the fork if upstream write access is still absent.
3. Build a private preservation inventory from actual database catalogs and aggregate counts, including runtime-created tables. Add `EventRegistration` and recent giveaway/poll/event features to the original inventory.
4. Identify who can perform staging restore, deploy, rollback, and incident response. Put Privy custom-auth enablement first in the external-dependency queue; confirm the authorized provider account owner, budget, and production email path. No provider request has been sent by this planning task.
5. Review the candidate games' existing code for verification feasibility and get scoring/prize decisions in parallel with auth planning. Leaderboard feature implementation still follows the auth gate.
6. Record a decision overriding the old cosmetic-only leaderboard and generated-handle scope for the new competition. Retain the existing [Arcade verification and promotion requirements](/Users/mateodazab/Documents/myosin/aegyo-arcade/docs/TECH_SPEC.md:454).

**Gate G0:** a verified source base, named operators, audited scope, and a dependency ledger. Missing production access does not stop local work, but an unknown production release path is an unresolved launch blocker.

### Phase 1 — Prove shared login and migration safely

**Owner:** Mateo; Simon supplies main-site staging/deployment support.\
**Planning window:** September 11–14. Gate review no later than September 14.

Use isolated databases and authorized test tenants, restored/sanitized samples where required, and synthetic users representing each existing auth method. Staging must reproduce separate browser origins and cross-domain navigation; an all-localhost demo is insufficient. Phase 5 separately verifies production-domain behavior with authorized staff accounts. Never run the main site's ordinary build against production as an inspection step: it currently runs database migration and seeding.

Deliverables:

1. Restore rehearsal with source manifests, IDs, relationships, role checks, and legitimate writes made after the snapshot. Establish backup retention and recovery behavior on the actual hosting plan.
2. Candidate-provider proof: sign-in from each app returns the same central member, preserves return URL/language, and handles logout, expiry, and recovery.
3. Aegyo proof: a controlled freeze/import rehearsal on isolated staging, compatible existing local sessions/projection, exact legacy-hash compatibility, and coherent password-recovery authority. Credential material stays in the authorized import environment. Compare first-login migration if the freeze cannot preserve the accepted UX.
4. Daebak proof: authenticate the existing Privy identity, link the central identity before any external login can create another user, and verify the same wallet and reward ownership. Test Google, Apple, email, embedded wallets, and supported external-wallet lanes as applicable to real users.
5. Direct-call negative test: a user with a valid central token must not bypass a browser-only migration lock and provision a conflicting Privy identity. Test interruption after provider linking but before the mapping transaction commits.
6. Test a newly created central member and an existing member under central-provider outage and account recovery. Main-site/Arcade visits must not initialize wallets.
7. Record actual provider features, plan cost, tenant permissions, and operational ownership. Do not buy or enable an unreviewed alternative merely to hide a failed proof.

The initial bulk-import proof must preserve the approved freeze window and returning-user experience; first-login migration remains a supported alternative if needed. For bulk, keep the imported connection inaccessible to users until credential/signup/deletion deltas and the final cutover race are reconciled; test the correct authority after a provider login or reset. No blanket re-import or reset is an acceptable substitute for preserving current users.

**Gate G1:** repeatable shared login, correct old-user recovery, preserved Privy identity/wallet/rewards, no duplicate grants/provisioning, and a tested recovery path. Document outcomes; a UI demo is insufficient.

Second-audit refinements: distinguish a confirmed absence of legacy identities from a small nonzero population, including Privy-only users and valued test/admin records. A zero-legacy case can simplify linking work; it does not remove provisioning/recovery proof. Test password-reset notification delays/failures and silent renewal using a pre-reset provider session. A callback must not grant the newest security epoch to stale authentication without a cutoff/freshness check. G1 is a gate on rollout and wider implementation, not a prerequisite for the approved bounded proof work needed to produce its evidence.

**If G1 fails:** stop the production migration path and report the exact failed dependency on September 14. Continue safe preparation that remains reusable. A different provider, delayed Daebak activation, or changed launch date is a visible scope decision for Mateo/the team; three independent logins do not count as completed shared auth.

### Phase 2 — Implement the Accounts foundation

**Owner:** Mateo.\
**Planning window:** September 14–15, after G1.

Deliverables:

- A small Accounts module inside Arcade with additive member/profile/security tables in its existing database and isolated staging configuration. No separate Accounts deployment or new database service. Verify Arcade-only changes do not deploy markets or expose its credentials.
- Additive schemas for members, verified identity mappings, usernames, necessary link/retry state, restrictions, and session security. Use narrow versioned contracts pinned across repos; defer a published package, generalized event bus, and unused chat endpoints. Persist only the retry/reconciliation state actually needed to preserve integrity.
- Provider SDK integration, verification/recovery flows, minimal activation/profile screens, username suggestions/reserved names, rate limits, CSRF protection, strict return destinations, and public/private response separation.
- Retry-safe account linking and member projection. Failed operations can resume without moving ownership or creating duplicate users.
- Local-session integration, synchronous reset-state claims, and shared epoch/operator-cutoff checks. Sensitive writes check the required authorization state. Test async-notification failure, silent renewal, and first entry without an app cookie; freeze the measured maximum reset-detection delay at G1. No dependency on an unavailable premium logout feature.
- Privacy-safe logs, per-step activation metrics, feature flags, health checks, and the compatible rollback build. No production rollout yet.

**Gate G2:** account creation/profile/link/recovery API tests, concurrent username/link tests, public-email exclusion, authorization/revocation checks, and scoped deployment behavior pass in staging.

### Phase 3 — Integrate all three products and prove continuity

**Owner:** Mateo; Simon merges/deploys Aegyo if needed.\
**Planning window:** September 15–16, after G2.

Implement and review each adapter as its own change:

1. **Aegyo:** preserve login/signup/reset URLs and social/content destinations; compose auth with current language middleware. After the supported OIDC callback verifies authentication and the mapping, issue the existing `Session` row and `session` cookie so existing `getSession` consumers remain compatible. Cut over credential/recovery authority together; add unique provider identity mapping through a reviewed additive migration. Map legacy users and roles without renaming profiles. Handle genuinely new external users explicitly despite the legacy non-null password field. Preserve event registration, newsletter consent, polls, contributions, giveaway records, and staff access.
2. **Daebak:** preserve the existing Privy app/user identities and wallet connection lanes. Central membership must not change transaction authorization, grants, referral snapshots, claim state, mint retries, or indexed progress. Wallet-only visitors retain existing wallet access; competition requires a verified shared profile.
3. **Arcade:** add the shared-member session alongside the existing device session. Preserve gameplay, device history/streaks, practice, privacy reset, language, and mobile behavior. After guest play, offer activation and return to the relevant game/contest; do not claim old client-reported runs as official scores.
4. Deploy compatible adapters behind controlled flags. Reconcile source records and new writes, then activate staff and an invited cohort. Verify migration failure/retry and both old/new session paths before broader auth activation.

**Gate G3 — auth complete:** a new user, a returning Aegyo user, and a returning Daebak user reach all three products with one member identity; old data/roles/wallets remain available; recovery and rollback work; the continuity matrix in §3 passes. Shared auth can ship while inactive legacy members migrate on their next visit. This does not require deleting their source accounts or invalidating their working sessions.

**Only after G3 do we begin leaderboard feature implementation.** Teams can finalize prizes, copy, and campaign URLs earlier.

### Phase 4 — Implement the monthly Arcade championship

**Owner:** Mateo; Simon/Fernando freeze business rules and prizes.\
**Planning window:** September 17–18, after G3. This is the tightest remaining engineering window.

Deliverables:

1. Competition rules/version, enrollment, eligible-game list, member/day/game attempt reservations, server challenges, evidence storage, verification outcomes, point ledger, standings, and winner/fulfillment records.
2. Deterministic score verification for the approved initial games. Pin seed, rules/build version, inputs, timing, maximum length, and scoring calibration. Client score bounds and manual suspicion checks alone are insufficient for material prizes.
3. Atomic quota reservation and exactly-once point effects under retries/concurrency. Persist the first submission's evidence hash and receipt; a changed retry cannot become another result. Retain explicit pending/rejected states. Serialize daily-best contribution updates: an improved attempt adds only the difference, not another full score. A disqualification recomputes the best remaining eligible result and adds an audited correction; the monthly total must reconcile to daily contributions.
4. Public monthly standings with one row per member, personal rank, per-game high scores, daily attempts remaining, reset/countdown, and clear competition/practice labels. Public payloads contain usernames and points, never email, device ID, or wallet data.
5. Enrollment and activation CTA on Arcade and a link from Aegyo's campaign/event flow. A signup or newsletter registration alone does not produce a verified contest entry.
6. Idempotent month closure: settle on-time pending results, apply disqualifications consistently, freeze candidate standings, review finalists, publish final results, and fulfill the approved awards once. Rehearse both September's shorter launch round and a complete calendar month.

Implementation ordering within this phase: first prove trace capture and replay using recorded practice runs, including level breaks, retries, pause/quit/cash-out, input ordering, and RNG state. Then implement the server challenge/points/standings features against that validated evidence contract. The numbered list describes outputs, not permission to defer replay until the rest is built.

**Gate G4:** forged/wrong-member/replayed scores, quota races across devices, month boundaries, delayed verification, ties, disqualification, and repeat fulfillment tests pass. Points reconcile from immutable accepted evidence. Rules, actual prizes, responsible operator, and claim/appeal procedure are ready before contest enrollment opens.

### Phase 5 — Validate, launch, and cover the campaign

**Owner:** Mateo for technical release; Simon/Fernando for contest/campaign readiness.\
**Planning window:** September 18–20. Target release September 18; September 20 is the last allowed date, not a September 21 launch.

Deliverables:

- End-to-end journeys from creator link or event page through activation, verified play, score receipt, and visible rank. Test mobile Safari/Chrome, desktop, private browsing, shared devices, language preferences, slow connections, reconnects, and supported Daebak wallet contexts.
- Test real production-domain redirects/session configuration with authorized staff accounts after staging passes. Confirm default-domain/`www` behavior before registering callbacks; do not create new domain redirects speculatively.
- Load rehearsal based on the campaign's expected burst, not just the 100+ physical attendees. Confirm capacity with Fernando; record the tested level and response times.
- Source-record reconciliation, recovery rehearsal, evidence retention, and compatible release IDs. Do not overwrite a live database with an old backup to roll back code.
- Small production cohort, monitored expansion, and a final sample of returning users before public contest opening. Verify outgoing verification/recovery email delivery and a staffed support path.
- Named engineer/operator and business contact for September 21–22 and the first month closure. September 19–20 contingency work requires explicit team availability; the calendar alone is not staffing.

**Gate G5 — launch:** no unexplained data/ownership differences, no unresolved auth or score-integrity failures, applicable promotion gates satisfied, public rules consistent with implementation, and the complete campaign journey works. The leaderboard is populated by genuine eligible results, with honest empty states if nobody has entered.

If an incident occurs, disable affected migration/entry functionality, retain receipts/mappings and safe access, show a clear status, and reconcile forward. Never silently discard a submitted score, reset the month, erase newly registered members, or relabel practice as a live prize contest.

## 6. Proposed competition rules for audit

These are concrete defaults to approve or edit, not claims that the call finalized every detail.

| Decision                  | Proposed launch rule                                                                                                                                                                                                                                                             |
| ------------------------- | -------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| Eligible games            | Two existing games whose scores can be verified reliably, provisionally Snake and Bias Flap. Confirm actual game IDs and verifier feasibility. Claw and the noncompetitive warding game stay playable outside prize rankings; replacement games do not block launch.             |
| Daily allowance           | Up to **three official attempts per member, per eligible game, per UTC day**. Existing casual practice remains available. A device/browser reset gives no extra official attempts.                                                                                               |
| Daily contribution        | Take the best verified score of those attempts for each game; convert it to **0–1,000 points** using a published fixed calibration table. Sum those daily contributions across eligible games for the month. Two eligible games imply at most 2,000 points/day.                  |
| Fairness                  | Calibrate against representative play, not arbitrary code maxima. All members receive the same daily challenge conditions within a game. Freeze game eligibility, scoring, and rule version for each round; add newly released games to a later round.                           |
| Failed/abandoned attempts | Reserve at issuance. Reconnect resumes the same unexpired challenge where supported. Abandonment/expiry consumes the attempt, clearly disclosed before play; confirmed service failures receive an audited, published remedy. No unlimited resets to search for a better result. |
| Rankings                  | Monthly cumulative points, one row/member; per-game high scores alongside. Zero-point outcomes remain recorded without a placing rank. Standings remain provisional until reviewed.                                                                                              |
| Prizes                    | The call's **monthly top-10 redemption** is the target. Simon/Fernando confirm actual prize allocation, availability, sponsor, eligibility, and fulfillment before opening entries. A displayed top 10 is not automatically ten approved prize claims.                           |
| Ties                      | Higher total points, then higher combined points earned in a single UTC day, then earlier server receipt reaching the final total. If a tie remains, publish a shared-placement/prize allocation rule before enrollment; never use an undisclosed random draw.                   |
| First round               | Actual announced production opening through October 1 at 00:00 UTC. September is a shortened first round. October begins a full calendar month. No pre-launch or historical guest score enters the prize ledger.                                                                 |
| Rewards boundaries        | Arcade championship points are separate from Daebuks, financial balances, giveaway entries, and ordinary streak counters. No reward for raw share-button clicks, referrals, slang activity, or playlist curation in this release.                                                |

Accepting these rules overrides the older proposal of one official attempt/day. The existing device-based cosmetic game allowance and weekly board retain their current behavior; the new official competition has its own namespace and clear labels.

Before a material prize launch, complete the existing [promotion gate](/Users/mateodazab/Documents/myosin/aegyo-arcade/docs/TECH_SPEC.md:702), including official rules, audience, sponsor/operator, prize allocation, verification/claims, and privacy. This plan does not invent legal eligibility, a prize-value exemption, or app-store approval rules.

## 7. Calendar and contingency decisions

| Checkpoint                        | Target                             | What must be true                                                                  |
| --------------------------------- | ---------------------------------- | ---------------------------------------------------------------------------------- |
| Scope audit and dependency owners | September 11                       | Mateo approves/edits this plan; actual start time and availability are known.      |
| Provider/migration proof          | September 14                       | G1 passes; production release path and required provider features are available.   |
| Shared auth integration           | September 16                       | G3 passes for all three products and returning-user journeys.                      |
| Championship and launch rehearsal | September 18                       | G4/G5 evidence supports opening the real contest.                                  |
| Final contingency window          | September 19–20                    | Resolve release issues with named coverage; all required launch gates still apply. |
| Public campaign / dance event     | Before September 21 / September 22 | Contest is already live and monitored before incoming campaign traffic.            |

This is an aggressive execution budget, not a completed estimate based on a proven tenant or a promise that access delays can be absorbed. It assumes prompt audit, focused engineering availability, an available main-site deployer, manageable migration findings, and two feasible verifiers. **If G1 misses September 14 or G3 misses September 16, surface the deadline conflict immediately.** Do not wait until September 20.

Contingencies to decide openly if required:

- Missing upstream write access: use the fork PR plus Simon as merge/deploy operator. This changes workflow without reducing shared-auth scope.
- Missing provider capability or unsafe wallet linking: change the architecture only after a supported alternative passes the same proof. An Arcade-only launch or deferred Daebak activation is a separate team decision, not an invisible shortcut.
- One game cannot meet verification requirements: propose a one-game first contest, with revised published points/rules, only if the team accepts it before enrollment. Do not include an unverified game to fill the advertised count.
- Unready prize rules/inventory: a practice/cosmetic board can remain available, but it does not fulfill the promised monthly prize contest. Resolve campaign scope/date explicitly.
- Missing weekend coverage: use September 18 as the operational cutoff and resolve remaining risks beforehand.

## 8. Audit and regression checklist

The detailed specification's T01–T12, T14–T21, and T23–T28 apply to the auth/competition release. T13, T22, and chat-specific portions of shared outage/revocation tests apply when chat is implemented; mixed tests still run for all active services now.

| Evidence group        | Required checks                                                                                                                                                                                                               |
| --------------------- | ----------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| Data preservation     | Catalog-based table/column inventory; zero missing source IDs; unchanged ownership/roles/wallet/grant associations; legitimate post-snapshot writes accounted for; counts alone are insufficient.                             |
| Account continuity    | Existing password and reset, legacy sessions, all supported current login methods, new users, dormant users, overlap/conflicts, staff roles, and safe activation retries.                                                     |
| Guest continuity      | Existing games/streaks/history and practice; no lost active run from auth navigation; guest reset cannot delete member results.                                                                                               |
| Cross-product auth    | One member across current origins; scoped sessions; verified callback/return destinations; no silent revival after revocation; provider outage/recovery.                                                                      |
| Competition integrity | Server recomputation, input bounds, deterministic timing, quota concurrency, receipt idempotency, pending/late results, ledger reconciliation, privacy, ties, and consistent bans.                                            |
| Month and fulfillment | Short September round, full month, UTC boundaries shown locally, pending closure, repeated jobs, final snapshots, disqualification/appeal, fallback winner, and no repeated fulfillment.                                      |
| Campaign conversion   | Event attendee without an account, newsletter-only contact, creator link attribution, verification-email delivery, mobile signup, return-to-game, receipt-to-rank. Do not send identity tokens or PII in campaign parameters. |
| Operations            | Tested restore into isolation, forward-safe rollback including new members/results, alerts, support owner, and coverage for campaign and closure.                                                                             |

Measure existing UX first: login success, activation steps, recovery completion, guest game starts/completions, and representative mobile load/interaction times. Any wrong-owner mapping, missing acknowledged record, asset-access regression, or private identity leak stops rollout. For routine auth errors, investigate every early failure; with at least 100 technical attempts, a >1% unexpected error rate pauses expansion. Compare p75 timings to the measured baseline; investigate >10% regressions before expanding. These are proposed operating thresholds, not claims of measured current performance or guaranteed retention.

### Additional source issue to include in campaign QA

The September 11 upstream event source labels the dance event **5–7 PM ET**, but stores those wall-clock values with `Z` timestamps. The registration API compares `endsAt` directly to `Date.now()`. As written, a `19:00Z` cutoff would close registration at 3 PM New York time on September 22, before the advertised event begins. Coordinate a small targeted correction with Simon: real instants for scheduling/cutoffs and explicit New York formatting for display. Do not change only the stored timestamp without checking all display consumers. This issue is independent of auth and must not be mistaken for an account-migration regression.

## 9. Later phases retained from the call

### Phase 6 — Standalone community chat

Begin after G5 and initial campaign stabilization; estimate separately once staffing/provider decisions are known. Proposed home is the main Aegyo site, but exact placement and room list still need confirmation.

Use shared usernames and a managed chat provider. Start with one or a few text rooms, adding AI screening, spam/link limits, report/mute/block tools, moderator actions, explicit token expiration/revocation, and an audit queue. Test fandom vocabulary and actual languages. Establish a named escalation owner, response coverage, appeals, retention, and emergency read-only control. Test what happens if the moderation provider is unavailable and after a user is banned while connected.

The desired experience is 24/7. AI can reduce routine review; it does not prove round-the-clock operational coverage. If the team accepts limited opening hours for an initial pilot, record that as a product decision rather than silently substituting the older event-only plan. The reusable token, permission, and moderation requirements remain in technical-spec §10.

### Phase 7 — Broader engagement and mobile distribution

- Onboard roughly 1–2 new games/month with provenance, game compatibility, score verification, and calibration before they become competition-eligible.
- Design cross-product activity rewards separately, with verified actions, budgets, anti-abuse controls, and a clear explanation of how they relate to Arcade points. Do not reward easily fabricated clicks or merge balances retrospectively.
- Schedule mobile distribution after Myosin's Apple/Google developer accounts, responsible owners, and product/store requirements are confirmed. App approval timing and any prize threshold are not assumed in this engineering schedule.
- Event permitting, photography, merchandise, and creator production remain with their meeting owners. Engineering owns reliable links, registration/activation continuity, and the contest experience.

## 10. Decisions Mateo can audit now

- [x] Shared auth across all three first; verified championship second; 24/7 chat follows launch. Execution authorized by Mateo after audit closure.
- [x] Better Auth proof uses an independent IdP service/database in the existing Railway account/project, from the Arcade repo. Product domains and identities remain stable. Infrastructure configuration and runtime gates remain.
- [ ] Accounts hosting/DNS/email and Privy entitlement are available; the bounded migration/continuity proof passes before rollout. No forced mass reset, duplicate wallet, or email-only merging fallback.
- [ ] Two initial verified games; best of three official attempts/game/day; normalized daily points summed monthly; top-10 award policy finalized by the business owners.
- [ ] September has a transparent shortened round; target September 18 rollout; no later than September 20 with agreed coverage.
- [ ] G1/G3 missed checkpoints trigger an explicit scope/date decision; user data/access and prize verification are never relaxed to meet the calendar.
- [ ] Simon can merge/deploy fork PRs if Mateo lacks upstream permission; production configuration and restore access still need a named operator.

All phase gates and end-to-end acceptance results remain **pending**. Initial local component tests and Arcade/Daebak read-only inventories have run; see the [execution record](/Users/mateodazab/Documents/myosin/aegyo-arcade-auth-proofs/docs/AUTH_PROOF_PROGRESS.md). No migration or launch has occurred.

## 11. Evidence and references

- [Current upstream auth helper, pinned September 11](https://github.com/Francisgood/kpop-lyrics/blob/eca06cd8cf79bda305e38e3230c534ac841b2897/lib/auth.ts).
- [Current event-registration route](https://github.com/Francisgood/kpop-lyrics/blob/eca06cd8cf79bda305e38e3230c534ac841b2897/app/api/events/register/route.ts) and [hosted event configuration](https://github.com/Francisgood/kpop-lyrics/blob/eca06cd8cf79bda305e38e3230c534ac841b2897/lib/hosted-events.ts).
- [Current main-site build scripts](https://github.com/Francisgood/kpop-lyrics/blob/eca06cd8cf79bda305e38e3230c534ac841b2897/package.json).
- [Detailed shared-auth and competition specification](/Users/mateodazab/Documents/myosin/aegyo-arcade/docs/UNIFIED_ACCOUNTS_AND_ENGAGEMENT_TECH_SPEC.md), including the source review and T01–T28 matrix.
- [Existing Arcade technical requirements](/Users/mateodazab/Documents/myosin/aegyo-arcade/docs/TECH_SPEC.md), especially §8.3 and §13.3.
- [Auth0 supported migration](https://auth0.com/docs/manage-users/user-migration/configure-automatic-migration-from-your-database) and [Privy custom-auth setup](https://docs.privy.io/authentication/user-authentication/jwt-based-auth/setup), refreshed September 11. Remaining provider references and September 7 adversarial findings are retained in the detailed specification.
