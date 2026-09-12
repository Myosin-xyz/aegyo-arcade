# Transactional email investigation — September 12, 2026

Research only: no support request, provider signup, API-key creation, subscription,
DNS change, test email, or deployment occurred during this investigation.
Mailjet remains the previously selected provider; Resend is a recommendation for
an alternative, not an activated replacement.

## Mailjet: what the account actually shows

The signed-in Myosin Primary account still reports “Your sending activity is
currently suspended.” The dashboard shows 0/6,000 emails and 1/1,000 contacts.
The Primary API Key page shows its secret as “Not generated”; no credential was
revealed or generated. The visible settings do not identify the suspension cause.

A focused search of the Myosin mailbox for Mailjet in the last seven days,
including spam and trash, found three messages: activation, a login code and a
welcome message. Only the welcome message was opened; the login code was not
read. The welcome message recommends adding/authenticating a sending domain for
deliverability, but does not state why the account is suspended or promise that
DNS will lift the suspension. No suspension or Test Mode review request appeared
in those search results.

Quota exhaustion is not supported by the observed usage. A new-account review or
incomplete domain verification remains possible; neither is established as the
cause. The [Mailjet troubleshooting article](https://documentation.mailjet.com/hc/en-us/articles/360042624754-Blocked-or-Limited-Account-Reasons-and-How-to-Restore-Full-Functionality)
lists several independent causes. Its Test Mode instructions concern a 10/hour
limit and an account-specific email; they do not prove this account is in that mode.

Earlier Railway credentials belong to older configurations. Their recorded
verified-sender/block response must not be treated as a diagnosis of this newly
created browser account. Domain verification and account permission to send are
distinct checks, but we have no evidence that support intervention is definitely
required after DNS for this account.

## Practical alternatives

| Provider | Published sending allowance | Implication here |
| --- | --- | --- |
| Mailjet Free | 6,000/month; 200/day | Larger free allowance, unresolved suspension. [Limits](https://documentation.mailjet.com/hc/en-us/articles/360043048393-What-is-this-200-emails-per-day-limit-on-free-accounts) |
| Resend Free | 3,000/month; 100/day | Suitable for initial controlled testing; a creator campaign could exceed the daily cap. [Pricing](https://resend.com/pricing) |
| Resend Pro | $20/month; 50,000/month; no daily cap | More campaign headroom; spending still needs authorization. [Pricing](https://resend.com/pricing) |
| Amazon SES | Base outbound price $0.10/1,000, plus applicable data/features | Low sending cost, but adds AWS setup and a production-access review. [Pricing](https://aws.amazon.com/ses/pricing/), [sandbox](https://docs.aws.amazon.com/ses/latest/dg/request-production-access.html) |

Supabase's built-in sender is intended for testing, restricted to team addresses
and currently two messages/hour. Production Supabase Auth still needs a custom
SMTP provider; it is not an independent production mail service for Better Auth.
[Supabase SMTP documentation](https://supabase.com/docs/guides/auth/auth-smtp).

## Recommendation and implementation boundary

Resend is the simplest replacement to evaluate because this branch already has
its explicit transport and configuration, introduced in `1f2259e`. Its tests use
controlled HTTP responses and were included in the latest Linux unit suite; they
are not live delivery evidence. Accounts remains on Railway with the same user
storage and identity rules. Changing the sender does not require migrating user
accounts, wallet identities, Arcade history or Beehiiv subscriptions.

An authorized Resend account, a scoped sending key, provider-generated DNS records,
and actual staging verification/reset delivery are still needed. For production
mail to arbitrary users, [Resend requires a verified domain](https://resend.com/docs/dashboard/domains/introduction).
Its shared `resend.dev` sender can only send test messages to the Resend account's
own address, so it can help an initial mailbox test before DNS but cannot serve
the public campaign. [Testing restriction](https://resend.com/docs/knowledge-base/403-error-resend-dev-domain).
Resend also has account review restrictions; successful activation and delivery
must be observed rather than assumed. [Provider documentation](https://resend.com/docs/dashboard/emails/schedule-email).

If switching, obtain Resend's exact domain records before Simon applies the DNS
handoff so both the Accounts hostname and email changes can be handled together.
Use the verified sending/return-path subdomain records without replacing existing
root mailbox or Beehiiv records. No record values are invented here. Free can be
used for controlled proof; choose paid campaign capacity only after budget approval.
