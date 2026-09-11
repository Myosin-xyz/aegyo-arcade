# Shared-auth dependency request

Current draft for Mateo to send to Simon and Fernando. **Team message not sent.** Auth0 subscription is no longer a dependency. The separate Privy entitlement/continuity inquiry was sent to `support@privy.io`; Gmail confirmed Message sent. No response or feature approval yet.

## Team message

Hey Simon and Fernando — we're proceeding with a shared login service on our existing Myosin Railway account and Arcade project, without an Auth0 subscription. The code stays in the Arcade repo, with a separate login service/database so game deployments don't affect sign-in across the three products. The first local provider checks pass; real-user migration and all-three-app testing remain.

Simon, I still need access for a read-only Aegyo database inventory, an isolated restored snapshot and the reviewed deploy/rollback path. Please confirm privately whether the production hashing secret is configured and transfer the required credential material only through our secure channel. We also need the owner who can point `account.aegyoarena.com` at the new service and provide the Mailjet sender/configuration for real recovery-email testing.

I've contacted Privy about production custom-auth pricing and linking existing users without replacing their wallets. We'll keep those accounts and wallet IDs intact. A fallback that adds another Privy login would need an explicit UX decision.

The next gate is September 14: three real staging origins working with password-reset revocation and migration/continuity evidence. If access or provider terms are still missing at the September 12 checkpoint, we'll flag the impact then. September 18 rollout remains conditional on the proofs.

## Privy inquiry status

The inquiry identifies Myosin as the company and uses Mateo's personal Privy account for the reply. It asks for the exact tier/recurring price and account-specific terms for the existing app's production JWT authentication, plus the supported existing-user link-before-provision flow and protection against direct client JWT calls. No user export, wallet addresses or credentials were sent, and no upgrade/configuration changes were authorized.

The dashboard Slack invitation expired. The sales form did not submit because it required additional social/payment-volume details, so the request was sent directly to Privy's published support address. Do not submit the form again as a duplicate.

## Checkpoints

Use America/New_York for September 12 and September 14 end-of-day checkpoints. No automatic follow-up or advisory watch has been activated. The [provider decision](BETTER_AUTH_PROVIDER_DECISION.md) and [progress record](AUTH_PROOF_PROGRESS.md) are the current technical record.
