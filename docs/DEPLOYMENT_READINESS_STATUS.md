# Deployment readiness — September 12, 2026

> Historical checkpoint. See the [September 15 release checkpoint](RELEASE_CHECKPOINT_2026-09-15.md) for verified branded email delivery, current repository access, the fresh canary/inventory/backup, and remaining launch gates.

Baseline HTTP checks repeated at 2026-09-12T18:18:43.798Z; subsequent staging competition and dormant production checks are recorded below. This is an observed checkpoint, not continuous monitoring.

## Current production

| Product | Public site                   | Observed result                           | New shared auth                             |
| ------- | ----------------------------- | ----------------------------------------- | ------------------------------------------- |
| Aegyo   | https://aegyoarena.com        | Homepage and existing login page HTTP 200 | Not deployed; shared session route HTTP 404 |
| Arcade  | https://arcade.aegyoarena.com | Homepage HTTP 200                         | Not deployed; shared session route HTTP 404 |
| Daebak  | https://www.daebakmarkets.com | Homepage and existing login page HTTP 200 | Not deployed; shared session route HTTP 404 |

These are unauthenticated GET and server-rendered content checks. They do not
prove production sign-in, transactions, games, wallets or user migration. No
production-product login, signup, password reset, schema change or release was
performed. The separate dormant Accounts database was subsequently initialized
as recorded below; it contains no users.

## Shared-auth staging

| Service  | Preview                                                        | Railway deployment                     |
| -------- | -------------------------------------------------------------- | -------------------------------------- |
| Accounts | https://aegyo-accounts-accounts-staging.up.railway.app/sign-in | `4546e488-b42c-43dd-b602-94fda7271c81` |
| Aegyo    | https://aegyo-auth-preview-accounts-staging.up.railway.app     | `d6844960-0524-4314-b4a6-7e31a7959e02` |
| Arcade   | https://arcade-auth-preview-accounts-staging.up.railway.app    | `82d0253e-42aa-411e-83b8-99b13f2cca16` |
| Daebak   | https://daebak-auth-preview-accounts-staging.up.railway.app    | `cad82133-f3ca-4251-8530-b25e589decb8` |

All four application deployments and their shared staging Postgres deployment
report SUCCESS. Accounts liveness, database/guard readiness, canonical OIDC
issuer/endpoints and the expected unauthenticated product-session responses
passed. **All 20 HTTP assertions passed** across staging and current production;
the production 404s are the expected pre-rollout baseline, not shared-auth success.

The existing eleven cross-product browser checks remain recorded in
[the implementation checkpoint](AUTH_IMPLEMENTATION_CHECKPOINT.md). The guarded
fixture source `13b920a` passed 45 real-PostgreSQL checks offline on the current
staging container; it was not deployed as runtime source.

The current Accounts staging deployment uses Resend with a sending-only key held
privately in Railway, the temporary `onboarding@resend.dev` sandbox sender limited
to `mateo@myosin.xyz`, and signup disabled. Runtime verification and reset emails
were delivered with Resend IDs `94be5bcb-f5ff-409c-8c4e-078ddfe69be3` and
`ee03f27c-57c6-41a4-a97a-4c2d61d078c8`. Both appeared in Gmail Spam. The actual
mailbox verification link was consumed, after which both retained synthetic
provider sessions reported verified email. The delivered reset link was consumed
in the browser; both retained provider sessions immediately returned null, the
old password returned HTTP 401, the link replay was invalid/already used, and the
new password reached the verified signed-in account page. This run did not retest
the three product-local sessions. Branded-domain delivery and inbox placement
remain unproved pending DNS; production was not changed. See the
[focused staging proof](STAGING_RESEND_DELIVERY_PROOF.md).
The latest endpoint-specific run passed **seven browser logout checks**. Arcade,
Aegyo and Daebak local logout each cleared only that product session, and provider
SSO restored it. Arcade retained the exact guest cookie. Accounts current-session
logout invalidated all three retained product sessions after **24.387 seconds**,
stale provider cookies minted no replacement product session, and a separately
authenticated browser remained signed in. Runner commit: `6e45565`; ignored
mode-0600 evidence: `cross-app-logout-report.json`.

A separate reserved-fixture run proved forced local-session expiry and all-device
operator revocation. Expiring only the exact synthetic member's active Arcade and
Aegyo rows caused retained cookies to fail; Daebak's sealed local session remained
active, and provider SSO renewed the two expired sessions. This is controlled
real-database expiry evidence for the deployed predicate and renewal path. Waiting
through the full natural TTL is optional soak coverage, not a user dependency or
launch gate.

The reviewed owner-only `aegyo_revoke_user(target, false)` operation then advanced
only the exact synthetic target's security epoch and removed its provider sessions.
Two browsers lost authorization in Arcade, Aegyo and Daebak after **27.093
seconds**. A different synthetic control identity stayed active, pre-revocation
provider cookies could not mint new product sessions, and a final fresh login
restored the non-banned fixture. Runner/document commit: `72062b6`; ignored
mode-0600 evidence: `cross-app-expiry-revocation-report.json`.

No database proxy was opened for these checks. A fresh administrative read confirms
zero public TCP proxies on the dedicated staging Postgres service.

### Competition staging deployment

Arcade deployment `82d0253e-42aa-411e-83b8-99b13f2cca16` succeeded from the
committed `4a09e15` bundle using the pinned Node 24.21.0 Docker image. Homepage,
championship page and competition API returned HTTP 200. Only synthetic competition
is enabled; material-prize competition remains disabled.

Migration `0002_arcade_competition` was applied only to `arcade_auth_staging`.
The transaction verified all original rows in all 14 existing public tables
before and after the additive migration. Eleven competition tables were added.
The runtime role has bounded grants; operator ownership credentials were not
assigned to the application. Its private database connection verifies TLS with
the staging CA.

Real Accounts browser proofs passed with an existing verified synthetic member:
guest-cookie preservation, username, enrollment, Snake and Flappy trace submission,
exact `verified` replay results, one consumed daily attempt per game, Aegyo identity
continuity, Daebak shared-account session, and local signout preserving the guest
and sibling sessions. The final seven-check follow-up also enforces explicit
public-field allowlists and excludes email, member/provider identity, seeds and
traces from public responses. Both sample games scored zero; standings therefore
had no positive-point rows, while both public game-high-score rows were present.
Positive-score aggregation remains covered by the local PostgreSQL proof.

This uses real staged OIDC without injected authentication cookies. It does not
test real user migration, email delivery or Privy wallet ownership. Evidence:
ignored mode-0600 `competition-staging-browser-report.json`; runner `f1b654f`.
Daebak acceptance uses a known identity that a human controls and that is already
present in staging. It does not link a real Privy identity to the shared synthetic
Accounts fixture.

## Aegyo can be tested before merge

The preview above runs our fork branch independently of production. Existing-user
ID/role preservation, verified new-user creation, SSO, reset and logout have
already been exercised there. Simon's upstream [PR #12](https://github.com/Francisgood/kpop-lyrics/pull/12)
is still OPEN and DRAFT at `0c36773`.

Merging the PR is a production-code step. It is not itself the account migration,
credential freeze, mapping reconciliation, shared-auth activation or post-release
smoke test. Those still need the coordinated rollout procedure. Mateo can deploy
Arcade and Daebak, but enabling them against an unprepared production identity
service would split the account rollout and does not satisfy the agreed shared-auth-first gate.

## What remains before production activation

1. **Email readiness:** Resend is the selected provider. The Aegyo domain exists
   in the Resend Myosin team with sending on and receiving off, but its exact DKIM,
   `send` subdomain MX/SPF and Accounts CNAME records have not been applied.
   Complete the [exact DNS handoff](SIMON_DNS_HANDOFF.md), configure the scoped
   branded sender, then repeat verification/reset delivery and inbox-placement
   acceptance. Sandbox staging delivery works, but both observed messages went to Spam.
   Mailjet's suspension is historical and is no longer the selected delivery path.
2. **Production identity preparation:** the separate service is deployed in
   dormant mode. Its private database has schema version 1, guard revision 2,
   a restricted runtime role and three production clients, with zero users or
   sessions. Railway has returned the exact custom-domain record. The
   [real restore](REAL_AEGYO_RESTORE_PROOF.md) matched all 48 tables, including
   52 users; the [read-only clone preflight](REAL_AEGYO_REHEARSAL_PREFLIGHT.md)
   verified its inventory again. Complete DNS/certificate checks,
   the restored-data import/reconciliation rehearsal, and
   demonstrate a known authorized canary's existing password. Never point the
   production Accounts hostname to the synthetic staging database.
3. **Remaining continuity evidence:** complete the real user-driven Privy
   ownership/linking journey. Endpoint-specific logout, controlled local expiry,
   renewal and two-device operator revocation now pass in staging.
   The tested dual-session Daebak fallback does not create automatic Privy SSO.
4. **Coordinated release:** finish review of the Aegyo adapter; stage the credential
   freeze, copy, exact mapping/ownership reconciliation and activation; deploy
   Arcade and Daebak against that same production issuer; then smoke-test existing
   users in all three products. Publish the leaderboard after the auth gate.

The Railway-provided production Accounts CNAME target is verified: `account` →
`2tmkqmk3.up.railway.app`. DNS remains a separate owner action. The generated
Railway hostname passes liveness and rejects all authentication routes with 503.
See [production preparation](PRODUCTION_ACCOUNTS_PREPARATION.md) and the updated
[DNS handoff](SIMON_DNS_HANDOFF.md). No public-product login path was switched.

## Private evidence references

- HTTP report SHA-256: `e0cc4b85d3dcfd39ab31f973ca44eecf008c427978a875aa023b72676e945217`.
- Endpoint logout browser report SHA-256: `022df1f87ee123f4d7d07b7d6a35f57356203059b099654adab36cc7920752b3`.
- Endpoint logout runner commit: `6e45565`.
- Expiry/revocation browser report SHA-256: `400049c54d67828038687133fbca3d6625e4682d1f9f2d20403c98c312ee619c`.
- Expiry/revocation runner and procedure commit: `72062b6`.
- Competition browser report SHA-256: `d833d676bd4fe373112286df787c02dc137b08b2d22da286a44396d7cbb76cba`;
  strict verified-result runner commit: `f1b654f`.

Raw reports/screenshots remain in the ignored mode-0600 proof directory. They
contain no production exports. The new browser runner does not read database
credentials, change passwords, authenticate to Privy or send email.

## Additional unblocked work completed

- [Cross-repository cutover rehearsal](SYNTHETIC_CUTOVER_REHEARSAL.md): four passing
  checks connect the actual Accounts importer to Aegyo reconciliation, mapping
  installation and activation. The old password resolves to the exact preserved
  local identity; retries create no duplicate users or mappings.
- Aegyo commits `c64537a` and `e843a8b` add an actual synthetic PostgreSQL 18
  backup/restore rehearsal, with full original-row equality before backup and
  after activation. Event registrations and community annotations are included.
  The parent independently reran the final proof successfully. These commits are
  local; they are additional evidence beyond the deployed Aegyo preview.
- [Credential guard revision 2](CREDENTIAL_GUARD_UPGRADE.md) closes a discovered
  OAuth-token revocation gap. The staging database upgrade committed via private
  Railway SSH; no public proxy was needed. Accounts deployment
  `4546e488-b42c-43dd-b602-94fda7271c81` uses runtime source `3841cf5` and requires the new
  guard revision before serving auth traffic. It reports SUCCESS and readiness
  `{ready:true}`. Production was not upgraded.

The local proofs close tool-level and token-lifecycle gaps. The subsequent
[real-data restore](REAL_AEGYO_RESTORE_PROOF.md) closes the backup/restore gate:
48 tables matched, the temporary reader was removed and the operator was stopped
with credentials removed. The private restored copy contains 52 users and 25
sessions. Restored-data import/reconciliation with an authorized password canary,
email delivery, production DNS, real Privy ownership acceptance and coordinated
release remain separate launch gates.
