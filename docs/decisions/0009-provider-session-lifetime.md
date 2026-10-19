# ADR 0009 — Session lifetimes: provider 90 days fixed, web 1 day, mobile 90 days

**Date**: 2026-10-18, revised 2026-10-19 to the product owner's session policy
**Status**: Proposed (product owner decides; the provider part is not active until the Accounts service is redeployed)

## Context

The Accounts provider (`services/accounts/src/provider-core.mjs`) configured
`session: { cookieCache: { enabled: false }, expiresIn: 3600 }` with no
`updateAge`. Better Auth 1.7.4 defaults `updateAge` to 86400 s and extends a
session only when `expiresAt - expiresIn + updateAge <= now`. With those values
the condition never holds before expiry, so every provider session ended exactly
60 minutes after sign-in.

Both product sites validate each stored local session against the provider via
`POST /api/internal/session-state` (`readSessionState` in
`services/accounts/src/security-state.mjs`), and `active` requires
`s."expiresAt" > now()`. Each site drops its local session when `active` is
false. Local sessions were nominally 8 h on both sites, so they were
effectively 60 minutes, on web and in the mobile app (observed on an emulator on
2026-10-18).

No earlier decision document records a reason for 3600 s. The provider decision
requires proving "session expiry" and keeping the 30-second private-state bound;
neither depends on the provider session being one hour.

On 2026-10-19 the product owner set the policy: website sessions last 1 day,
mobile app sessions last 90 days because a native app is expected to stay
signed in.

## Decision

- **Website member session**: 1 day (`WEB_SESSION_TTL_SECONDS` in
  `src/accounts/config.ts`).
- **Mobile app member session**: 90 days (`MOBILE_SESSION_TTL_SECONDS`).
- **Provider session**: 90 days, fixed (`PROVIDER_SESSION_SECONDS = 7776000`
  for both `expiresIn` and `updateAge`). It must outlive the longest consumer;
  otherwise session-state reports the provider session inactive and the site
  drops a mobile session early.

The client identifies itself on the login entry URL with `client=mobile`. The
value is stored in the sealed authorization transaction; the callback creates
the member session with the matching TTL and sets the `__Host-aegyo_member`
cookie `maxAge` to the same number of seconds. Any other value, or none, is web.
The social site applies the same rule.

### Why fixed rather than sliding

Equal `expiresIn` and `updateAge` mean reading a provider session never extends
it. Sliding renewal would only matter if something called Better Auth's
`get-session` on the provider during normal use, and nothing in either site
does: the sites call `session-state`, which reads the row without touching
`expiresAt`. A fixed cap also keeps the revocation story identical to the 8 h
version: one stored `expiresAt`, set at sign-in, plus the same server-side
checks. The cost is that a member who is active on day 89 still signs in again
on day 90.

### `client=mobile` is a convenience signal, not a security boundary

Anyone can add `client=mobile` to the login URL in a browser. They get a 90-day
session on their own account and nothing else: no extra scope, no other
member's data, no bypass of any check. Revocation does not depend on session
length (below), so a long session is not a long window after a ban or password
reset. The app also sends a WebView user agent suffix `AegyoArenaMobile/<version>`;
servers may log it but must not require it, since user agents are equally easy
to set.

## What changes

- Website members stay signed in for up to 1 day; mobile members for up to 90
  days, instead of 60 minutes.
- The provider session cookie lifetime follows `expiresIn` and becomes 90 days.

## What does not change

- Revocation. `readSessionState` still checks `banned`, `credentialVersion`,
  `securityVersion`, `passwordChangedAt` and `operatorRevokedAt`; the sites
  recheck every 30 s (`PROVIDER_STATE_MAX_AGE_MS`) and on every sensitive action.
  Password reset and operator revocation still delete provider sessions.
- `max_age=3600` on new authorization requests (`NORMAL_MAX_AGE_SECONDS` on both
  sites). It governs re-authentication for a new authorization, not the validity
  of an existing session.
- OAuth access-token lifetime (3600 s, asserted in `tests/provider.test.mjs`).
- Every callback check (state, nonce, PKCE, issuer, signed-state match, freshness
  and the single bounded reauthentication retry). The retry keeps the
  transaction's `client`.
- No schema change and no migration. `account_sessions.expires_at` already
  stores the per-row expiry.

## Rollout

Two independent parts:

- **Provider (90 days fixed)**: redeploy the Accounts service from the merged
  commit. It is uploaded to Railway from the tracked `services/accounts` source,
  not deployed by a merge. Sessions issued before the deploy keep their stored
  60-minute `expiresAt`; only sign-ins after the deploy get 90 days.
- **Arcade member sessions (web 1 day, mobile 90 days)**: deploy with `main` as
  usual. Until the provider is redeployed, every member session is still capped
  at the provider's 60 minutes by the session-state recheck.

Transactions sealed before the Arcade deploy (at most 10 minutes old) have no
`client` field and open as web. Rollback for either part is a redeploy of the
previous source.

## Verification

- `services/accounts/tests/runtime-unit.test.mjs` asserts the configured and
  resolved Better Auth session options (90 days, `updateAge === expiresIn`)
  without a database.
- `services/accounts/tests/provider.test.mjs` (real PostgreSQL proof) asserts a
  new session row lasts 90 days and that `get-session` does not move
  `expiresAt`.
- `tests/unit/account-session-lifetime.test.ts` covers `client` parsing, the
  login transaction (mobile, absent, bogus), the stored session expiry and the
  member cookie `maxAge` per client.
- `tests/unit/account-callback-route.test.ts` asserts the callback passes the
  per-client TTL to both the session and the cookie, and keeps `client` through
  the reauthentication retry.
