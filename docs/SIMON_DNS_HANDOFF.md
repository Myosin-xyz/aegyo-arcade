# DNS handoff for Simon

Verified against the signed-in Resend domain setup on September 12, 2026. Apply in Cloudflare's `aegyoarena.com` zone.

| Type  | Name                | Content                                                                                                                                                                                                                      | Priority | TTL  |
| ----- | ------------------- | ---------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- | -------- | ---- |
| TXT   | `resend._domainkey` | `p=MIGfMA0GCSqGSIb3DQEBAQUAA4GNADCBiQKBgQDx6eW7yVUU38uM3uz5Vu5cHTv0fH1w/35hen1keMLC1B0B1hf8cqm6pzvsUgGAyPNHuVtEgVcQXIWQawgmX630CZOhII6gyZ7VZHTaNbVsl10lPg1TvDiiBlCXFlL3FNgi9bHhvIJ7d1ZzE+Y54WFZE/VYEXA1lanMwBF5re/gyQIDAQAB` | —        | Auto |
| MX    | `send`              | `feedback-smtp.us-east-1.amazonses.com`                                                                                                                                                                                      | 10       | Auto |
| TXT   | `send`              | `v=spf1 include:amazonses.com ~all`                                                                                                                                                                                          | —        | Auto |
| CNAME | `account`           | `d5d1smmz.up.railway.app`                                                                                                                                                                                                    | —        | Auto |

The Resend domain was created in the Myosin team by `mateo@myosin.xyz`; domain ID `1c6c34a8-56e6-4105-8193-b7173c84a205`, region `us-east-1`. Sending is on and receiving is off. Enter each name relative to the Aegyo zone and each value exactly as shown, without adding quotation marks or appending the domain twice.

Before adding the `send` records, check whether that subdomain already has an MX or SPF TXT record. Do not create a second SPF record for the same name; stop and reconcile any conflict. Use DNS-only for the new Accounts CNAME during certificate provisioning. Do not move the root MX, replace root SPF or DMARC, or change existing Beehiiv, website, DKIM or other mail records. Simon can ignore the earlier unadded Mailjet ownership challenge. Existing Mailjet authentication records, if any, do not need to be deleted as part of this handoff.

Railway returned the exact CNAME above for `account.aegyoarena.com` on September 15, 2026. It belongs to the relocated, separate production service `aegyo-accounts-production` in the Aegyo project, not the synthetic staging service. Custom-domain resource: `5c0b7ea4-033e-45c2-94a9-3053c50448bc`. Railway reported `REQUIRES_UPDATE`; its authoritative DNS-status response requested only the CNAME and did not request an additional ownership TXT for this hostname. Do not add a Railway TXT record unless Railway later displays a host and value for one.

The production service is deployed but deliberately dormant: health succeeds, while readiness and authentication traffic fail closed because traffic and signup remain disabled. DNS setup therefore does not activate authentication or migrate users. Its dedicated private database is ready at schema version 1 with credential-guard revision 2, three OAuth clients, and zero users, accounts, sessions or OAuth tokens. See [production relocation](ACCOUNTS_PRODUCTION_RELOCATION_2026-09-15.md).

Resend's sending domain is verified, branded Gmail inbox delivery is proven, and the required repository push access is confirmed. No DNS records were changed during the relocation. Recheck the exact Accounts CNAME and Railway certificate after Simon applies it.
