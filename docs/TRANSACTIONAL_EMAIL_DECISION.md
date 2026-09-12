# Transactional email decision — September 12, 2026

**Current decision: Mateo selected Resend.** The domain was created in the Resend Myosin team under `mateo@myosin.xyz` on September 12, 2026. Its domain ID is `1c6c34a8-56e6-4105-8193-b7173c84a205`, region `us-east-1`; sending is on and receiving is off. The exact pending DNS records are in [Simon's handoff](SIMON_DNS_HANDOFF.md). Staging runtime delivery now works through Resend's temporary sandbox sender; branded-domain delivery remains pending DNS.

Mailjet was considered first because Aegyo already integrated it. The accessible account rejected sandbox sends and reported a temporary block. That suspension is historical provider-selection evidence, not the selected delivery blocker. No Mailjet ownership challenge needs to be added for the current plan, and existing Mailjet authentication records do not need to be removed.

Mateo authorized managing the email setup after observing failed password recovery. The Accounts source supports the selected Resend transport while retaining Mailjet as an explicit alternative. Staging uses `ACCOUNTS_MAIL_MODE=resend` with a sending-only key held privately in Railway and the temporary `onboarding@resend.dev` sender restricted to `mateo@myosin.xyz`; public signup remains closed. Production and existing Aegyo production settings remain unchanged, as does Beehiiv.

## Why this option

A small HTTP transport change lets us replace the broken dependency without changing identity storage, passwords, wallets, or product integrations. We do not need Supabase Auth to deliver emails for the Better Auth provider. Existing Supabase experience is useful operational context, but does not establish an available transactional sender or quota for this application.

As verified September 12, Resend Free includes 3,000 transactional emails/month with a **100/day cap**. Pro lists $20/month for 50,000 emails with no daily cap. The free daily cap is lower than Mailjet's advertised free cap and may be too small for a creator campaign. This is a practical replacement candidate, **not a claim that it is universally cheapest or that the free plan covers launch volume**. No paid plan is authorized by this document. [Resend pricing](https://resend.com/pricing).

Beehiiv remains the newsletter/marketing system. Its 270 subscribers must not be imported as auth users, and existing subscription preferences must not change as a side effect of account creation or migration.

## Configuration and behavior

For Resend, configure only the isolated Accounts service being tested or activated:

- `ACCOUNTS_MAIL_MODE=resend`
- `RESEND_API_KEY`: a private, appropriately scoped sending key for the authorized domain.
- `RESEND_FROM_EMAIL`: the approved bare sender address on that verified domain.
- Keep `ACCOUNTS_SIGNUP_ENABLED` false until delivery and new-user/migration acceptance pass.

Mailjet remains selectable with `ACCOUNTS_MAIL_MODE=mailjet` and the three `MAILJET_*` settings, but it is not the selected rollout provider. Do not reuse its credentials for Resend.

The transport uses the provider's HTTPS API, refuses redirects, times out after ten seconds, bounds response size, validates provider acknowledgement, and suppresses raw error bodies and reset links from thrown errors. Resend receives an opaque idempotency key per recipient and logical reset/verification link; retrying that same message uses the same key. A provider acknowledgement means accepted by the API, not delivered to an inbox. [Resend send-email API](https://resend.com/docs/api-reference/emails/send-email).

## Required live proof

Configuration-only staging deployment `4546e488-b42c-43dd-b602-94fda7271c81` reported `SUCCESS` on the existing runtime source `3841cf5`. Guarded fixture source `13b920a` was copied to `/tmp` and exercised offline on the current staging container; it was not deployed as runtime source. That fixture passed 45 real-PostgreSQL checks.

The running Accounts service delivered a verification message (`94be5bcb-f5ff-409c-8c4e-078ddfe69be3`) and password-reset message (`ee03f27c-57c6-41a4-a97a-4c2d61d078c8`) to the authorized Gmail mailbox. Both arrived in Spam under the sandbox sender. The verification link read from the actual mailbox was consumed successfully, and both existing synthetic provider sessions then reported `emailVerified: true`. The delivered reset link was also consumed successfully in the browser: both retained provider sessions immediately returned null from `get-session`, the old password returned HTTP 401, replaying the link reported invalid/already used, and browser login with the new password reached the verified “You're signed in” account page. The three product-local sessions were not retested in this delivery run; earlier cross-product revocation evidence remains separate. These checks prove runtime submission and receipt through Resend's sandbox; they do not prove branded-domain delivery or inbox placement. See the [focused staging proof](STAGING_RESEND_DELIVERY_PROOF.md).

1. Establish the Myosin-owned account/access and verify the sending domain using the provider's exact DNS records. Inspect existing SPF/DKIM/DMARC and Beehiiv records before adding anything; do not invent records or replace a working root SPF indiscriminately.
2. Confirm plan limits and expected peak verification/reset volume. Define an owner for quota/rejection monitoring and a recovery path for failed mail before opening signup.
3. Repeat the delivered verification/reset journey with the verified branded sender after DNS. Prove arrival, sender, correct origin, expiry, one-use reset, return path, supported-language behavior and acceptable inbox placement.
4. Repeat the stale-device/cookies-cleared security test using the **delivered** reset link. A mock transport, sandbox response, or captured in-memory link does not satisfy delivery acceptance.
5. Review any production email fix separately from the auth migration; this candidate sender belongs to the Accounts service and has not repaired the current site's recovery route.

Mailjet can remain a future alternative if support unblocks it and capacity/delivery are proven. No automatic fallback is enabled: silently switching providers would complicate diagnosis and delivery accounting.
