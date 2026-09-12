# Transactional email decision — September 12, 2026

Mailjet was chosen initially because Aegyo already integrated it. That assumption has now been tested: the accessible account rejects sandbox sends with HTTP 401 and explicitly reports a temporary account block. Sender metadata access and a verified sender do not establish permission to send. The offline Railway configuration-holder service is unrelated to the provider block.

Mateo authorized managing the email setup after observing failed password recovery. The source now supports **Resend as an alternative** while retaining Mailjet support. Resend is not yet configured, purchased, or deployed. Provider-account ownership and DNS access are pending. The default remains email disabled with public signup closed; existing Aegyo production settings and Beehiiv are unchanged.

## Why this option

A small HTTP transport change lets us replace the broken dependency without changing identity storage, passwords, wallets, or product integrations. We do not need Supabase Auth to deliver emails for the Better Auth provider. Existing Supabase experience is useful operational context, but does not establish an available transactional sender or quota for this application.

As verified September 12, Resend Free includes 3,000 transactional emails/month with a **100/day cap**. Pro lists $20/month for 50,000 emails with no daily cap. The free daily cap is lower than Mailjet's advertised free cap and may be too small for a creator campaign. This is a practical replacement candidate, **not a claim that it is universally cheapest or that the free plan covers launch volume**. No paid plan is authorized by this document. [Resend pricing](https://resend.com/pricing).

Beehiiv remains the newsletter/marketing system. Its 270 subscribers must not be imported as auth users, and existing subscription preferences must not change as a side effect of account creation or migration.

## Configuration and behavior

For Resend, configure only the isolated Accounts staging service:

- `ACCOUNTS_MAIL_MODE=resend`
- `RESEND_API_KEY`: a private, appropriately scoped sending key for the authorized domain.
- `RESEND_FROM_EMAIL`: the approved bare sender address on that verified domain.
- Keep `ACCOUNTS_SIGNUP_ENABLED` false until delivery and new-user/migration acceptance pass.

Mailjet remains selectable with `ACCOUNTS_MAIL_MODE=mailjet` and the three `MAILJET_*` settings. Do not reuse its credentials for Resend or copy the blocked configuration merely to satisfy startup validation.

The transport uses the provider's HTTPS API, refuses redirects, times out after ten seconds, bounds response size, validates provider acknowledgement, and suppresses raw error bodies and reset links from thrown errors. Resend receives an opaque idempotency key per recipient and logical reset/verification link; retrying that same message uses the same key. A provider acknowledgement means accepted by the API, not delivered to an inbox. [Resend send-email API](https://resend.com/docs/api-reference/emails/send-email).

## Required live proof

1. Establish the Myosin-owned account/access and verify the sending domain using the provider's exact DNS records. Inspect existing SPF/DKIM/DMARC and Beehiiv records before adding anything; do not invent records or replace a working root SPF indiscriminately.
2. Confirm plan limits and expected peak verification/reset volume. Define an owner for quota/rejection monitoring and a recovery path for failed mail before opening signup.
3. Use an authorized test mailbox and synthetic staging identity to receive verification and reset messages. Prove arrival, sender, correct origin, expiry, one-use reset, return path, and supported-language behavior.
4. Repeat the stale-device/cookies-cleared security test using the **delivered** reset link. A mock transport, sandbox response, or captured in-memory link does not satisfy delivery acceptance.
5. Review any production email fix separately from the auth migration; this candidate sender belongs to the Accounts service and has not repaired the current site's recovery route.

Mailjet can remain a future alternative if support unblocks it and capacity/delivery are proven. No automatic fallback is enabled: silently switching providers would complicate diagnosis and delivery accounting.
