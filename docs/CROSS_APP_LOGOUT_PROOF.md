# Accounts cross-app logout evidence

## Proven provider behavior

Accounts uses Better Auth 1.7.4's maintained OAuth Provider endpoints and hooks. The disposable PostgreSQL proof registers Aegyo, Arcade, and Daebak as separate clients, issues an ID token for a relying party, and invokes `POST /api/auth/oauth2/end-session` with an ID token hint, client ID, exact registered post-logout redirect URI, and state.

The proof verifies that Accounts:

- deletes the provider session identified by the signed ID token;
- accepts the client's exact registered redirect URI and caller state;
- posts one signed logout token to every client that received a grant for that session;
- signs each token with `typ: logout+jwt` and the expected issuer, audience, subject, session ID, event, expiry, and unique ID; and
- omits `nonce`, as required for an OpenID back-channel logout token.

The same proof makes a receiver return HTTP 503. Provider-session deletion still succeeds, and `/api/internal/session-state` reports the session inactive. Back-channel delivery therefore accelerates local cleanup but is not the authority for access.

## Relying-party contract

Each product client needs `enable_end_session`, an exact allowlist of post-logout redirect URIs, and a public HTTPS `backchannel_logout_uri`. Set `backchannel_logout_session_required` when the product stores an Accounts session-ID mapping.

A receiver must accept only a form-encoded `logout_token`, verify the JWT with the Accounts discovery/JWKS keys, require `typ: logout+jwt`, and validate the exact Accounts issuer and its own client ID as audience. It must require the back-channel logout event, `sub`, `sid`, `iat`, `exp`, and `jti`, reject a token containing `nonce`, and delete the matching local session idempotently. The durable mapping key is the exact Accounts `(issuer, sub, sid)` tuple. Email is not an identity or logout key.

The browser-facing product should clear its own cookie even if the provider request or redirect fails. RP-initiated logout removes the provider session named by the ID token hint; it is not an all-device account logout.

## Authoritative fallback

Better Auth performs back-channel calls as best-effort, single-attempt notifications. Network errors and non-2xx responses do not restore the deleted provider session. Password reset and operator revocation delete sessions inside PostgreSQL security-definer guards, so those database-triggered deletions do not pass through Better Auth's adapter hook and do not emit back-channel notifications.

Every product must therefore query the authenticated Accounts session-state endpoint at its existing sensitive-action and bounded-renewal checkpoints. An inactive state must delete the local product session and deny the action. This preserves reset and operator revocation even when notification delivery is unavailable. Logout deletes sessions and OAuth tokens; it does not alter Accounts users, product mappings, roles, wallets, grants, or application account records.

## Evidence limits

The proof runs with synthetic identities in the pinned Node 24.21.0 Linux image and a disposable local PostgreSQL cluster. Receiver HTTP calls are intercepted locally so their tokens can be inspected. It does not prove deployed DNS/TLS reachability, a real Aegyo or Daebak receiver, browser navigation and cookie behavior across origins, or delivery through a production network. Those require a browser and deployed-client rehearsal after each product implements the receiver and authoritative state checks.
