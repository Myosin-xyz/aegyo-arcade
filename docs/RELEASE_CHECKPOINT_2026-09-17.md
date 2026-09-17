# Release checkpoint — September 17, 2026

This checkpoint records the production preparation completed after the September
15 rehearsal. It does not authorize activation, user migration, or a material
competition.

## Ready but dormant

- Production Accounts is deployed in the Aegyo Railway project with its own
  PostgreSQL service. Its generated Railway hostname passes `/healthz`; traffic
  and signup remain disabled, so `/readyz` intentionally returns 503.
- Aegyo's merged adapter has its production issuer, client, transaction, and
  state-reader configuration. `AEGYO_SHARED_AUTH_ENABLED` remains `false`.
- Arcade has its production issuer, client, transaction, state-reader, and
  competition seed configuration. Shared authentication and both competition
  flags remain `false`.
- Daebak has its production issuer, client, callback, cookie, and state-reader
  configuration. Its public and server shared-auth flags remain `false`, so the
  existing Privy and wallet journey is unchanged.
- Arcade PR #2 now includes the protected `/competition-admin` operations
  console. It uses the audited round, replay, snapshot, award, fulfillment, and
  audit-log services. It cannot bypass the material-competition flag and cannot
  create a round while the business definition is unresolved.

No production deployment was triggered by adding the dormant Aegyo, Arcade, or
Daebak variables.

## Production email accepted

Resend reports `aegyoarena.com` verified. Production Accounts uses the
domain-restricted sending-only API key and `accounts@aegyoarena.com`. A bounded
delivery check to Mateo's Myosin inbox was accepted and Resend reported it
**Delivered**. The key correctly rejects domain-administration calls because it
has sending access only; that is the intended least-privilege configuration.

## Remaining infrastructure gate

`account.aegyoarena.com` still resolves through Cloudflare's proxy addresses.
Railway therefore has not accepted the custom domain and returns its fallback
404. Keep the existing CNAME target `d5d1smmz.up.railway.app`, but change this
single record to **DNS only** (gray cloud) with TTL Auto. Do not enable Accounts
traffic or any product adapter until the public hostname serves the Accounts
certificate and health endpoint without `x-railway-fallback`.

## Cutover after the hostname passes

1. Verify the public Accounts certificate, `/healthz`, OIDC discovery, and all
   three registered production callbacks while traffic is still disabled.
2. Enable Aegyo's explicit credential-writer freeze, drain old requests, take a
   fresh backup and snapshot, and import the frozen 54-user baseline again from
   current production data.
3. Reconcile every source user, ownership row, session count, Accounts identity,
   and Aegyo mapping. Exercise the existing-password canary before activation.
4. Insert the Aegyo activation latch and enable Accounts traffic. Enable the
   Aegyo adapter first, then Arcade and Daebak against the same issuer.
5. Run existing-user, new-user, reset, cleared-cookie, logout, Arcade guest-history,
   and Daebak wallet-continuity acceptance checks. Roll back the flags if any
   preservation check fails.
6. Add the approved operator subject allowlist. Keep both Arcade competition
   flags off until Dai Dai and Simon approve the frozen round definition.

## Business inputs still required

The implementation can store immutable final standings, award allocations,
claims, exact-once fulfillment, and the operator audit trail. The first material
round still needs the final schedule, eligible games and point table, prizes and
shared-tie allocation, eligibility/rules URL, claim deadline, forfeiture/fallback
policy, and named launch/closure operators. Until those inputs are approved, the
weekly proposal remains a non-executable draft.
