# ADR 0009 — Provider session lifetime aligned with site sessions (8 h)

**Date**: 2026-10-18
**Status**: Proposed (product owner decides; not active until the Accounts service is redeployed)

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
`s."expiresAt" > now()`. The social site deletes its local session when `active`
is false; its `SESSION_TTL_SECONDS` is 8 h and its root layout calls
`getSession()` on every page. The Arcade member session
(`MEMBER_SESSION_TTL_SECONDS` in `src/accounts/config.ts`) is also 8 h. The
nominal 8 h local sessions were therefore effectively 60 minutes, on web and in
the mobile app (observed on an emulator on 2026-10-18).

No earlier decision document records a reason for 3600 s. The provider decision
requires proving "session expiry" and keeping the 30-second private-state bound;
neither depends on the provider session being one hour.

## Decision

Set the provider session to 8 h (`PROVIDER_SESSION_SECONDS = 28800`) for both
`expiresIn` and `updateAge`. Equal values keep the lifetime absolute: reading a
session never extends it, and a member signs in again at most every 8 h.

## What changes

- Members stay signed in for up to 8 h on web and mobile instead of 60 minutes.
- The provider session cookie lifetime follows `expiresIn` and becomes 8 h.

## What does not change

- Revocation. `readSessionState` still checks `banned`, `credentialVersion`,
  `securityVersion`, `passwordChangedAt` and `operatorRevokedAt`; the sites
  recheck every 30 s (`PROVIDER_STATE_MAX_AGE_MS`) and on every sensitive action.
  Password reset and operator revocation still delete provider sessions.
- `max_age=3600` on new authorization requests (`NORMAL_MAX_AGE_SECONDS` on both
  sites). It governs re-authentication for a new authorization, not the validity
  of an existing session.
- OAuth access-token lifetime (3600 s, asserted in `tests/provider.test.mjs`).
- No schema change and no migration.

## Rollout

Redeploy the Accounts service from the merged commit (it is uploaded to Railway
from the tracked `services/accounts` source, not deployed by a merge). Sessions
issued before the deploy keep their stored 60-minute `expiresAt`; only sign-ins
after the deploy get 8 h. Rollback is a redeploy of the previous source.

## Verification

- `tests/runtime-unit.test.mjs` asserts the configured and resolved Better Auth
  session options without a database.
- `tests/provider.test.mjs` (real PostgreSQL proof) asserts a new session row
  lasts 8 h and that `get-session` does not move `expiresAt`.
