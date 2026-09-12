# DNS handoff for Simon

Verified against the signed-in Mailjet domain setup on September 12, 2026. Apply in Cloudflare's `aegyoarena.com` zone.

| Type  | Name                | Content                            | TTL  |
| ----- | ------------------- | ---------------------------------- | ---- |
| TXT   | `mailjet._54f0dd00` | `54f0dd005f67b16d3c0914fa722a2716` | Auto |
| CNAME | `account`           | `2tmkqmk3.up.railway.app`          | Auto |

The resulting full record name is `mailjet._54f0dd00.aegyoarena.com`. This is the Mailjet ownership challenge for the account managed by Mateo at Myosin. Enter the content as the exact string above, without adding quotation marks in the Cloudflare form. The name is relative to the Aegyo zone; do not append the domain twice.

Add these two records. Use DNS-only for the new Accounts CNAME during certificate provisioning. Keep existing SPF, DKIM, DMARC, MX, Beehiiv and website records unchanged. Mailjet currently reports Aegyo's SPF and DKIM as OK. Mateo will validate the domain in Mailjet after the TXT record resolves. Domain verification does not remove the account's sending suspension; Mailjet account review remains separate.

Railway returned the exact CNAME above for `account.aegyoarena.com` on September 12, 2026. It belongs to the separate production service `aegyo-accounts-production`, not the synthetic staging service. Custom-domain resource: `6e053623-76ed-487d-89a2-629230be2f32`. Railway reported `REQUIRES_UPDATE` and did not request an additional ownership TXT for this hostname.

The production service is deployed but deliberately dormant: health succeeds, while login, signup, recovery and discovery return HTTP 503. DNS setup therefore does not activate authentication or migrate users. Its separate private database is empty and has not been connected to the app. See [production preparation](PRODUCTION_ACCOUNTS_PREPARATION.md).

Optional repository access request: grant GitHub user `mateodaza` Write access to `Francisgood/kpop-lyrics`. Current upstream access is read-only; work and a draft PR can continue from `mateodaza/kpop-lyrics` in the meantime.

No DNS records were changed by the agent. An independent read through resolver 1.1.1.1 returned no TXT answer for the ownership name at this checkpoint; the default local resolver timed out. Recheck after Simon applies the record.
