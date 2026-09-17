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

## Deployed browser evidence — September 12

The guarded `scripts/auth-proof/cross-app-staging-logout.mjs` runner passed five
checks against the four actual staging HTTPS origins under pinned Node 24.21.0.
Aegyo local logout clears its existing session cookie and SSO restores it.
Accounts UI Sign out removes the current provider session; the three retained
product sessions returned their exact unauthenticated statuses/bodies after
26.396 seconds, within the 30-second state-cache bound plus ten
seconds for network observation. The timer starts before clicking Sign out.
Arcade's guest cookie remains identical. Separate contexts restored with the old
provider cookies cannot mint a new session in any product. Another independently
authenticated browser stays signed in.

This closes the current-browser cross-product sign-out journey. It does not
claim an all-device logout or deployed back-channel receiver/RP-end-session
proof. The receiver-delivery limitations above remain separate. No database,
proxy, email or Privy administration was used by the browser runner.

Run with `ACCOUNTS_LOGOUT_PROOF_CONFIRM=synthetic-staging-only` and the pinned
Node binary; it reads only the ignored synthetic `staging-seed.json` fixture.
The report/screenshots remain private and mode 0600. Report SHA-256:
`ba28ffbd1b4413c7c87a4deff4057e40234d08efd99c1e2baa54b228a5e353d0`. See [deployment readiness](DEPLOYMENT_READINESS_STATUS.md).

### Revision-2 deployment rerun

The same five-check browser runner passed again at 18:18 UTC against Accounts
staging deployment `15423d18-07b4-478d-b795-77c42ea54d57`, after the credential
guard revision-2 upgrade. Retained product sessions became unauthenticated after
25.772 seconds. The guest cookie and independent browser session checks passed.
Report SHA-256:
`23f7389d330436e30c500ae5ecb1a787433f455d4b1e669a994dcc05f6ed72b5`.
This is browser logout evidence, separate from the local token-reset revocation
proof and the private staging database-upgrade verification.
