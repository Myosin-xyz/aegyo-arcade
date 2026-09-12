# DNS handoff for Simon

Verified against the signed-in Mailjet domain setup on September 12, 2026. Apply in Cloudflare's `aegyoarena.com` zone.

| Type | Name                | Content                            | TTL  |
| ---- | ------------------- | ---------------------------------- | ---- |
| TXT  | `mailjet._54f0dd00` | `54f0dd005f67b16d3c0914fa722a2716` | Auto |

The resulting full record name is `mailjet._54f0dd00.aegyoarena.com`. This is the Mailjet ownership challenge for the account managed by Mateo at Myosin. Enter the content as the exact string above, without adding quotation marks in the Cloudflare form. The name is relative to the Aegyo zone; do not append the domain twice.

Add this one TXT record. Keep existing SPF, DKIM, DMARC, MX, Beehiiv and website records unchanged. Mailjet currently reports Aegyo's SPF and DKIM as OK. Mateo will validate the domain in Mailjet after the TXT record resolves. Domain verification does not remove the account's sending suspension; Mailjet account review remains separate.

No `account` CNAME is ready to add yet. The final production Accounts service has not been assigned a verified custom-domain target. Do not point `account.aegyoarena.com` at the current synthetic staging service or guess a Railway target. Mateo will provide Railway's exact CNAME and any ownership record when the production service is ready. The existing Railway staging hostname is sufficient for ongoing development.

Optional repository access request: grant GitHub user `mateodaza` Write access to `Francisgood/kpop-lyrics`. Current upstream access is read-only; work and a draft PR can continue from `mateodaza/kpop-lyrics` in the meantime.

No DNS records were changed by the agent. An independent read through resolver 1.1.1.1 returned no TXT answer for the ownership name at this checkpoint; the default local resolver timed out. Recheck after Simon applies the record.
