# DNS handoff for Simon

Verified against the signed-in Resend domain setup on September 12, 2026. Apply in Cloudflare's `aegyoarena.com` zone.

| Type  | Name                | Content                                                                                                                                                                                                                      | Priority | TTL  |
| ----- | ------------------- | ---------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- | -------- | ---- |
| TXT   | `resend._domainkey` | `p=MIGfMA0GCSqGSIb3DQEBAQUAA4GNADCBiQKBgQDx6eW7yVUU38uM3uz5Vu5cHTv0fH1w/35hen1keMLC1B0B1hf8cqm6pzvsUgGAyPNHuVtEgVcQXIWQawgmX630CZOhII6gyZ7VZHTaNbVsl10lPg1TvDiiBlCXFlL3FNgi9bHhvIJ7d1ZzE+Y54WFZE/VYEXA1lanMwBF5re/gyQIDAQAB` | —        | Auto |
| MX    | `send`              | `feedback-smtp.us-east-1.amazonses.com`                                                                                                                                                                                      | 10       | Auto |
| TXT   | `send`              | `v=spf1 include:amazonses.com ~all`                                                                                                                                                                                          | —        | Auto |
| CNAME | `account`           | `2tmkqmk3.up.railway.app`                                                                                                                                                                                                    | —        | Auto |

The Resend domain was created in the Myosin team by `mateo@myosin.xyz`; domain ID `1c6c34a8-56e6-4105-8193-b7173c84a205`, region `us-east-1`. Sending is on and receiving is off. Enter each name relative to the Aegyo zone and each value exactly as shown, without adding quotation marks or appending the domain twice.

Before adding the `send` records, check whether that subdomain already has an MX or SPF TXT record. Do not create a second SPF record for the same name; stop and reconcile any conflict. Use DNS-only for the new Accounts CNAME during certificate provisioning. Do not move the root MX, replace root SPF or DMARC, or change existing Beehiiv, website, DKIM or other mail records. Simon can ignore the earlier unadded Mailjet ownership challenge. Existing Mailjet authentication records, if any, do not need to be deleted as part of this handoff.

Railway returned the exact CNAME above for `account.aegyoarena.com` on September 12, 2026. It belongs to the separate production service `aegyo-accounts-production`, not the synthetic staging service. Custom-domain resource: `6e053623-76ed-487d-89a2-629230be2f32`. Railway reported `REQUIRES_UPDATE` and did not request an additional ownership TXT for this hostname.

The production service is deployed but deliberately dormant: health succeeds, while login, signup, recovery and discovery return HTTP 503. DNS setup therefore does not activate authentication or migrate users. Private database configuration is present, although dormant runtime does not initialize a connection. The database is separately ready at schema version 1 with credential-guard revision 2, three OAuth clients, and zero users or sessions. See [production preparation](PRODUCTION_ACCOUNTS_PREPARATION.md).

Optional repository access request: grant GitHub user `mateodaza` Write access to `Francisgood/kpop-lyrics`. Current upstream access is read-only; work and a draft PR can continue from `mateodaza/kpop-lyrics` in the meantime.

No DNS records were changed by the agent. Recheck all four exact records and the Railway certificate after Simon applies them, then verify Resend's domain status and real delivery separately.
