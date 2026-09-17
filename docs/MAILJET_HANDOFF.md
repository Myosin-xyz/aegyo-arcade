# Mailjet setup handoff

**September 12 update:** Railway access now exposes two existing key pairs. Both reject sandbox sends; the verified-sender pair explicitly reports a blocked Mailjet account requiring support. No message was delivered and no production settings changed. Obtaining keys alone is no longer the blocker. See the [current transactional email decision](TRANSACTIONAL_EMAIL_DECISION.md); the September 11 handoff below is retained for an eventual Mailjet recovery path.

September 11, 2026. Mateo confirmed proceeding with Mailjet and that Simon holds account access. No Mailjet subscription, credential, sender, DNS, contact or mailing-list change has been made. Mailjet is the email transport; Aegyo's application database remains the source of existing login identities. Newsletter contacts must not become login accounts automatically.

## What Simon provides

Use the existing Aegyo Mailjet account. Through Railway or the team's secret manager, provide an appropriately scoped API key pair and an approved, verified sender for the Accounts service. Do not paste secrets, reset links or user exports into Slack, chat or Git. Prefer a separate staging key/subaccount if the current plan permits it; do not rotate the existing site's key as part of this task.

The code uses these variable names:

| Current Aegyo variable | Accounts service variable |
| ---------------------- | ------------------------- |
| `MJ_APIKEY_PUBLIC`     | `MAILJET_API_KEY`         |
| `MJ_APIKEY_PRIVATE`    | `MAILJET_SECRET_KEY`      |
| `MAIL_FROM`            | `MAILJET_FROM_EMAIL`      |

Also confirm the account owner, current plan, available daily/monthly capacity shared with other senders, and verified domain status. The publicly listed Free plan is 6,000 emails/month with a 200/day cap; Starter is $9/month for 8,000 without a daily cap, as checked September 11. These are not evidence of this account's entitlement. A creator/event campaign can exceed the free daily cap even when monthly usage is low. No upgrade is authorized by this document. [Mailjet pricing](https://www.mailjet.com/pricing/)

## Read-only sender check

The check uses one Mailjet sender-metadata GET scoped to the configured sender domain. It does not send mail, register or validate senders, inspect contacts, change DNS, or access any product database. It refuses missing settings, does not load `.env`, never follows HTTP redirects, bounds response size/time, and outputs only status/booleans. API bodies, sender addresses, IDs and secrets are not printed.

From `services/accounts`, using the pinned Node 24.21.0 runtime and existing credentials injected into the environment:

```sh
# Existing Aegyo environment names; explicitly set the approved MAIL_FROM.
npm run mail:preflight -- --source aegyo

# Accounts environment names after securely configuring the staging service.
npm run mail:preflight -- --source accounts
```

The current Aegyo helper has a default From address if `MAIL_FROM` is absent. The checker intentionally requires an explicit sender; a fallback in code is not proof of domain verification. Do not put secret values in command-line arguments. The standalone script performs no package installation, migration, seed, build or deployment.

Exit 0 means an active exact sender or active exact domain sender was found and delivery can be tested. Exit 2 means configuration, API access or sender metadata needs attention. In both cases `deliveryVerified` and `capacityVerified` remain false. A key permitted to send but not inspect sender metadata may require manual dashboard verification; do not broaden production privileges merely to pass this check. [Mailjet sender API](https://dev.mailjet.com/openapi/openapi-mailjet/sender-addresses-and-domains/get_v3_sender)

## Staging delivery acceptance

1. Verify SPF, DKIM and DMARC and the actual daily/monthly limits in the existing account; the metadata check is not a DNS or deliverability audit.
2. Configure only the isolated Accounts staging service and set `ACCOUNTS_MAIL_MODE=mailjet`. Keep signup closed until delivery and account-mapping acceptance are complete.
3. Use a team-authorized test mailbox with a synthetic staging account to receive verification and recovery messages. Verify arrival, sender, expiration, link origin, one-use recovery and return to the requesting product. Test supported locales. The previous in-memory recording proof does not count as delivery.
4. Repeat the two-browser stale-session/reset proof using the delivered link. Keep links/tokens out of screenshots and committed evidence. Record only status and timing.
5. Confirm monitoring/ownership for rejected mail and quota exhaustion. Do not open enrollment if event-day verification messages could be blocked by a daily cap.

The Accounts sender is isolated behind `createMailSender`; changing providers later does not require changing user IDs, password hashes, product ownership or wallets. Production cutover continues to depend on the full shared-auth acceptance gate.
