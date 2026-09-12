# Staging Resend delivery proof

Create the fixture only through `services/accounts/scripts/seed-mail-staging-fixture.mjs` using the migration-owner connection, exact staging database, both reviewed TLS inputs, the explicit confirmation, and an exclusive path under `services/accounts/.proof`. It calls the maintained signup API with a no-network recorder, commits one unverified `mateo@myosin.xyz` staging identity, removes its signup session, and writes its generated password only to the private artifact. It refuses an existing email and never overwrites an identity.

After the staging runtime is configured with Resend and public signup remains disabled:

1. Sign in with the private fixture credentials in two isolated browser contexts. Confirm two distinct provider sessions.
2. From `/account`, request email verification. In the already-authorized `mateo@myosin.xyz` mailbox, verify sender, recipient, subject, and that the link origin is exactly the staging Accounts origin before opening it. Do not paste the link into logs or chat. Confirm `/account` reports verified and a newly issued ID token contains signed `email_verified: true`.
3. Request password recovery from `/forgot-password`. Inspect the newly delivered message in the same mailbox, verify its exact staging origin, and open it only in an isolated context. Set a new generated password stored in the private proof directory.
4. Start the revocation timer at reset submission. Within 40 seconds, both pre-reset provider sessions and already-issued product sessions must fail authoritative state checks. The old password and recovery-link replay must fail; the new password must work and issue a later reset-state/security version.
5. Confirm no other recipient, user, wallet, grant, referral, competition entry, or production database changed. Remove the fixture and private credential artifacts through a separately reviewed staging cleanup after evidence is retained.

Mailbox inspection is an operator step because a sending-only Resend key cannot read delivered mail. This procedure does not treat a Resend API acceptance response as inbox-delivery evidence.
