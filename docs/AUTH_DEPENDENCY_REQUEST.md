# Shared-auth dependency request

Draft for Mateo to send to Simon and Fernando. **Not sent.** The access/entitlement requests below are concrete dependencies for G1; this document does not approve spend or enable provider features.

## Combined team message

Hey Simon and Fernando — the architecture audit is closed, and the first auth proof code and read-only Arcade/Daebak inventories are ready. Existing accounts, wallets and guest progress need to be preserved.

To keep the September 14 migration proof on track and protect the leaderboard launch before September 21, we need these resolved by end of day September 12:

1. **Auth0:** confirm the tenant owner and billing owner, approve the Professional B2C budget, and give me access to the approved tenant. We also need an owner for SMTP credentials and the sending domain so we can test login and recovery emails.
2. **Privy:** assign a support ticket and get written confirmation of whether our existing Daebak app can use custom JWT authentication in production, which plan is required, and the exact recurring cost. The dashboard labels it “Scale,” while the public feature table is less specific. Please also confirm the supported way to link our existing users before any new identity/wallet is created. Custom authentication is currently off.
3. **Simon / Aegyo:** provide a read-only connection for aggregate counts and schema inventory, a restorable snapshot for isolated staging, and the person who can restore/deploy/roll back. Please confirm privately whether `AUTH_SECRET` is set in the deployed environment; keep its value and all connection credentials in our secure sharing channel, not this message.

If the tenant or Aegyo access is still missing at that checkpoint, the September 14 proof is at risk and we should adjust the delivery commitment then. We can keep preparing locally, but cannot call shared auth ready until the migration and all-three-app tests pass.

## Privy support details for the assigned owner

Use the existing Daebak Markets app's support context. Ask for written confirmation of production custom-JWT availability, the exact tier/price for the existing account, and whether any grandfathered or account-specific terms apply. The authenticated dashboard shows a development-mode app, the custom-auth switch off, and a Scale badge; the public page groups JWT authentication under Developer. Do not infer the answer from either label alone.

Also ask which supported flow links an already-existing Privy identity to the external JWT subject without first creating another user or wallet, and how to enforce that restriction against a direct client JWT call. No user export, personal records, secrets or wallet addresses are needed in the ticket.

## Checkpoint and scope

Checkpoint timezone: America/New_York. Record actual tenant/access readiness and the Privy support response by September 12 end of day; G1 remains September 14 subject to those dependencies. No automatic follow-up has been scheduled.

The dual-session link-table alternative avoids Privy's custom-JWT feature requirement, but may add a Privy login on fresh browsers. It needs an explicit scope/UX decision and continuity proof; it is not an automatic fallback.
