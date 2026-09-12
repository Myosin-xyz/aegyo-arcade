# Mailjet onboarding status — September 12, 2026

Mateo explicitly chose Mailjet and signed into the account owned by `mateo@myosin.xyz`. The onboarding page confirms account activation and the default sender address are complete. The account is on Free, with the dashboard showing 0 of 6,000 messages sent. No upgrade or purchase was made.

## Completed preparation

- Selected the Developer onboarding guide for transactional API use.
- Added `aegyoarena.com` with the label **Aegyo Arena transactional email**. Mailjet confirmed the domain was added, but ownership validation is pending. Its DNS ownership challenge is available in the signed-in domain setup page. No DNS changes or verification files were deployed.
- The SPF/DKIM tab reports **OK / OK for aegyoarena.com** and **Error / Error for myosin.xyz**. These are Mailjet UI observations, not an independent DNS/delivery proof. Preserve existing authentication records; do not overwrite them simply because this account is being configured. Ownership validation is separate from SPF/DKIM status.
- Prepared `simon@myosin.xyz` with **Manager access** to the Primary account. After permissions were selected, the final action was **Upgrade**, not an invitation submit button. The account-sharing page explicitly offers Premium. **Simon has not been invited and has no new access.** His prepared form is left open; no subscription was purchased.

## Current blocker

The signed-in account repeatedly displays **“Your sending activity is currently suspended.”** This persists despite email activation being marked completed. The UI does not establish why it is suspended or whether it is the same account represented by either previously inspected Railway key pair. Do not describe this account as a proven working replacement, assume DNS alone will lift the suspension, or connect its credentials to production.

The Account Management support-ticket form was opened but no ticket was submitted. Mateo has been asked whether to send the review request and who controls Aegyo's DNS. Sending the ticket is pending that answer. No support PIN, API key or secret is stored in this document.

Suggested support message, not sent:

> Hello Mailjet Support, I am setting up our Myosin account for Aegyo Arena (https://aegyoarena.com). Account activation is marked complete, but the dashboard says that sending activity is suspended. We plan to send user-requested verification and password-reset emails through your API. The Aegyo domain has been added and ownership verification is pending. Our team also found a blocked older Mailjet configuration for this product, so please confirm the reason for the suspension and the correct approved account setup before we send. What information or verification is required to enable transactional delivery? Thank you, Mateo.

## Next steps

1. Obtain Mailjet's account review and confirmation that sending is permitted.
2. Complete the domain ownership challenge with the authorized DNS operator, retaining existing SPF/DKIM and Beehiiv configuration. Review any automatic DNS connector permissions before authorizing it.
3. Resolve the optional Premium/account-sharing decision separately from email readiness. Adding Simon is still outstanding; no budget was approved.
4. Configure scoped credentials only in isolated Accounts staging, then prove actual verification/reset delivery to an authorized synthetic test mailbox and verify campaign quota headroom.

No API credentials were retrieved or rotated in this onboarding session. No test emails, campaigns, contact imports, Railway changes or production deployments occurred. Existing user identities and Beehiiv subscriptions remain unchanged. Resend remains an unused implementation alternative, not the selected provider.
