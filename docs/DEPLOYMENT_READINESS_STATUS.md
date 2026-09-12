# Deployment readiness — September 12, 2026

Checked at 2026-09-12T17:56:29.805Z. This is an observed checkpoint, not continuous monitoring.

## Current production

| Product | Public site                   | Observed result                           | New shared auth                             |
| ------- | ----------------------------- | ----------------------------------------- | ------------------------------------------- |
| Aegyo   | https://aegyoarena.com        | Homepage and existing login page HTTP 200 | Not deployed; shared session route HTTP 404 |
| Arcade  | https://arcade.aegyoarena.com | Homepage HTTP 200                         | Not deployed; shared session route HTTP 404 |
| Daebak  | https://www.daebakmarkets.com | Homepage and existing login page HTTP 200 | Not deployed; shared session route HTTP 404 |

These are unauthenticated GET and server-rendered content checks. They do not
prove production sign-in, transactions, games, wallets or user migration. No
production login, signup, password reset, schema change or release was performed.

## Shared-auth staging

| Service  | Preview                                                        | Railway deployment                     |
| -------- | -------------------------------------------------------------- | -------------------------------------- |
| Accounts | https://aegyo-accounts-accounts-staging.up.railway.app/sign-in | `80a50d74-3ce3-453f-a045-ef0809b72385` |
| Aegyo    | https://aegyo-auth-preview-accounts-staging.up.railway.app     | `d6844960-0524-4314-b4a6-7e31a7959e02` |
| Arcade   | https://arcade-auth-preview-accounts-staging.up.railway.app    | `42427b71-3db6-4ce2-9d29-1053bbb7486e` |
| Daebak   | https://daebak-auth-preview-accounts-staging.up.railway.app    | `cad82133-f3ca-4251-8530-b25e589decb8` |

All four application deployments and their shared staging Postgres deployment
report SUCCESS. Accounts liveness, database/guard readiness, canonical OIDC
issuer/endpoints and the expected unauthenticated product-session responses
passed. **All 20 HTTP assertions passed** across staging and current production;
the production 404s are the expected pre-rollout baseline, not shared-auth success.

The existing eleven cross-product browser checks and 66 local provider checks
remain recorded in [the implementation checkpoint](AUTH_IMPLEMENTATION_CHECKPOINT.md).
This pass adds **five passing browser logout checks**: Aegyo local logout/SSO
restoration; simultaneous sessions in all products; Accounts sign-out invalidating
those product sessions while preserving the guest device; stale provider-cookie
rejection; and another independently authenticated browser staying signed in.
Invalidation was observed after **26.396 seconds**.
This is current-browser, cross-product logout; it is not all-device logout.

No database proxy was opened for these checks. A fresh administrative read confirms
zero public TCP proxies on the dedicated staging Postgres service.

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

1. **Email readiness:** the signed-in Chrome Mailjet account still shows sending
   suspended. Aegyo domain ownership is Pending; its SPF/DKIM screen says OK/OK.
   Resolver 1.1.1.1 returns no TXT answer for the ownership challenge. Complete
   the [exact DNS handoff](SIMON_DNS_HANDOFF.md), resolve the account suspension,
   then test real verification/reset delivery. No support message was sent.
2. **Production identity preparation:** retain the stable production issuer,
   establish the dedicated production service and exact custom-domain records,
   complete backup/restore and the restored-data migration rehearsal, and
   demonstrate a known authorized canary's existing password. Never point the
   production Accounts hostname to the synthetic staging database.
3. **Remaining continuity evidence:** complete the real user-driven Privy
   ownership/linking journey and remaining expiry/endpoint-specific logout cases.
   The tested dual-session Daebak fallback does not create automatic Privy SSO.
4. **Coordinated release:** finish review of the Aegyo adapter; stage the credential
   freeze, copy, exact mapping/ownership reconciliation and activation; deploy
   Arcade and Daebak against that same production issuer; then smoke-test existing
   users in all three products. Publish the leaderboard after the auth gate.

The `account.aegyoarena.com` CNAME query also returned no answer. A verified
production Railway domain target has not yet been provided, so there is no new
CNAME value to guess or request from Simon in this checkpoint.

## Private evidence references

- HTTP report SHA-256: `6e06e4f54ef98e7e14898a6ebdbd5e055a594b58cb9a794bbc13a15ed7637049`.
- Logout browser report SHA-256: `ba28ffbd1b4413c7c87a4deff4057e40234d08efd99c1e2baa54b228a5e353d0`.
- Logout script commit: `9765150`; syntax, formatting, scoped ESLint and diff checks passed.

Raw reports/screenshots remain in the ignored mode-0600 proof directory. They
contain no production exports. The new browser runner does not read database
credentials, change passwords, authenticate to Privy or send email.
