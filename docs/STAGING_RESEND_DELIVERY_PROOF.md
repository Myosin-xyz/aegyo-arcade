# Staging Resend delivery proof

On September 12, 2026, Accounts staging configuration-only deployment `4546e488-b42c-43dd-b602-94fda7271c81` reported `SUCCESS` while retaining runtime source `3841cf5`. Guarded fixture source `13b920a` was copied to `/tmp` and ran offline on the current staging container; it was not deployed as runtime source. The fixture passed 45 real-PostgreSQL checks using the existing least-privilege staging role directly, with no additional service.

Staging used `ACCOUNTS_MAIL_MODE=resend`, a sending-only key held privately in Railway, and the temporary `onboarding@resend.dev` sandbox sender restricted to `mateo@myosin.xyz`. Signup remained disabled. No paid plan or production configuration changed.

The running Accounts service delivered both message types to the authorized Gmail mailbox:

| Message        | Resend ID                              | Observed result                                             |
| -------------- | -------------------------------------- | ----------------------------------------------------------- |
| Verification   | `94be5bcb-f5ff-409c-8c4e-078ddfe69be3` | Delivered to Gmail Spam; mailbox link consumed successfully |
| Password reset | `ee03f27c-57c6-41a4-a97a-4c2d61d078c8` | Delivered to Gmail Spam; mailbox link consumed successfully |

After verification, both existing synthetic provider sessions reported `emailVerified: true`. After reset, both retained provider sessions immediately returned null from `get-session`, the old password returned HTTP 401, replaying the delivered reset link reported invalid/already used, and browser login with the new password reached the verified “You're signed in” account page.

This delivery run did not retest the three product-local sessions; the earlier cross-product session and revocation proof remains separate. It also does not prove delivery or inbox placement from the branded Aegyo domain. The four DNS records in [Simon's handoff](SIMON_DNS_HANDOFF.md) remain unchanged and unapplied at this checkpoint.
