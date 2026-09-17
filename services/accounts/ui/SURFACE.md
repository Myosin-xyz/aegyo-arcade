# Accounts surface

Mode: Operate. A visitor must sign in, register, recover access, verify email, or leave a session without losing the product journey that brought them here.

The surface extends Aegyo Arena’s established dark navy, pink, mint, and gold arcade identity. The bunny mark and bold, compact title treatment establish continuity; quiet fields and restrained motion keep credential work calm. English and Spanish have equal structure and responsive behavior.

Server contract: `renderAccountPage({ page, locale, status, errorCode, email, token, continuationUrl, oauthQuery, trustedRedirectUri, signupAllowed, emailAvailable, user })`. Registration is closed unless `signupAllowed` is explicitly true. The server owns validation of `continuationUrl`, must pass `oauthQuery` exactly as signed by the provider, and may supply `trustedRedirectUri` only from its static registered redirect allowlist. An external provider response is followed only when its HTTPS origin and path exactly match that URI and it carries both `code` and `state`; the original authorize URL is never replayed after OAuth sign-in. Raw provider errors and untrusted profile HTML never enter the page. Browser forms call Better Auth under `/api/auth/*`; account enumeration is avoided on recovery. `emailAvailable: false` replaces recovery and verification forms with accurate unavailable guidance.
