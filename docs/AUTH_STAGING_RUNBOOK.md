# Shared-auth staging proof runbook

The current provider is the independently operated Better Auth service described in [the provider decision](BETTER_AUTH_PROVIDER_DECISION.md). Auth0 setup/import/Action instructions in earlier revisions are historical. The original Auth0-specific helper files remain reference tests, not staging configuration.

Accounts, Aegyo, Arcade and Daebak are deployed at the four isolated staging origins in [the cross-product proof](CROSS_APP_STAGING_PROOF.md). The final candidates passed eleven real-browser checks and the pinned Linux image passed 66 local checks. Actual email delivery, real Privy identity linking, full-data restore/import/reconciliation and production approval remain open. Consult [the implementation checkpoint](AUTH_IMPLEMENTATION_CHECKPOINT.md) for the current deployment IDs and [Mailjet onboarding status](MAILJET_ONBOARDING_STATUS.md) for the selected provider's blocker.

## Local package proof

Use the `codex/shared-auth-proofs` worktree. The separate package does not change Arcade dependencies or its Vercel deployment. Select Node **24.21.0**, matching `services/accounts/.node-version` and its exact engine pin, before the commands below. The runner rejects other versions before starting PostgreSQL.

```sh
cd services/accounts
npm ci
npm test
npm run proof
```

The proof runner creates an empty local PostgreSQL cluster, no TCP listener, private temporary socket, and synthetic identities. It executes actual Better Auth request handlers and verifies signed ID tokens for three synthetic HTTPS callback origins. It shuts down only the cluster it created. No environment files, `DATABASE_URL`, production user rows, email or Privy calls. Database artifacts remain ignored and private in `.proof`; they are not production backups.

The proof demonstrates package-level identity, original `auth_time`, forced authentication, code/PKCE protections, native reset revocation, a persisted server-owned reset timestamp in verified ID tokens for all three clients, legacy hash compatibility and persistent rate counters. It does not exercise the three real applications, real browser redirects, full credential-copy/rehash lifecycle, the actual Railway environment or production Mailjet/Privy. The local database trigger and concurrency evidence are described in [credential transitions](CREDENTIAL_TRANSITION_PROOF.md). Do not count it as G1, T27 or T28 end-to-end completion.

The existing root `npm run test:auth-proof` tests remain useful for strict freshness, inventory and historical import contracts. The root `auth:preflight` and `auth:proof-fixture` scripts are Auth0-specific; do not use them to configure Better Auth.

## Same-account Railway staging

1. Use the existing aegyo-arcade Railway project, listed under Mateo Daza's Projects. Its separate Accounts staging service/database already exists, sourced from `services/accounts` with independent build/start/release/watch paths. No new hosting account or repo. Keep the image/runtime pinned to Node 24.21.0; repeat the Linux proof for relevant service changes. Resource IDs and source-bundle versus future Git-root settings are in the deployment contract.
2. Use isolated staging secrets, a separate database and stable issuer URL. A Railway-generated domain can be used for G1. The eventual `account.aegyoarena.com` DNS points to the production Accounts service. Do not mix staging/production issuers or change a live issuer without a migration.
3. Register three separate first-party clients with exact HTTPS callback/logout origins. Disable public/dynamic client registration, ordinary-user client administration, unused grants and implicit account linking. Use authorization-code/S256 PKCE and supported client libraries for issuer/signature/audience/state/nonce checks.
4. Set database rate storage, explicit rate limiting, reset-session revocation and no cookie-session caching. Validate actual edge IP headers and denial behavior with spoofed forwarded headers and requests across instances. `auth.api` does not exercise HTTP rate limits.
5. Mateo has completed the initial Mailjet account and domain setup, but sending on that account remains suspended and domain ownership validation is pending. Simon was not added because the account-sharing flow required an unapproved upgrade. After Mailjet clears sending and the domain is authorized, configure scoped credentials through secret storage and use the read-only sender preflight before delivery tests. Test real sign-in/signup/reset/verification pages, verification state, consent, locale and delivery on an authorized test mailbox. A metadata check or local memory mailbox is not an email delivery proof.
6. Bootstrap staff privileges through a reviewed operator procedure, never an email-to-role rule or public signup field. Establish backup/restore, independent rollback, signing-key retention, advisory notifications and patch ownership before production. No production migration is performed by a build command.

## Aegyo aggregate inventory and restored migration

Use the existing read-only collector with an explicitly selected source:

```sh
node scripts/auth-proof/inventory.mjs \
  --product aegyo \
  --database-env AUTH_PROOF_INVENTORY_DATABASE_URL
```

An authorized operator supplies the read-only connection, restored snapshot and effective hash-configuration verification through secure channels. The collector reads catalog/counts under a repeatable-read, read-only transaction with timeouts and rollback; it never fetches individual records. It requires User, Session, PasswordReset, EventRegistration and CommunityAnnotation and still inventories every public table. A missing expected table is investigation/exit-code-2, not a zero-user assumption or permission to create it. Reconfirm the deployment-to-database binding.

Rehearse the full credential/account write freeze, including in-flight reset/login/admin/email/signup/deletion operations. Copy hashes and stable IDs into a closed target with explicit format/credential version and unchanged verification flags. Record the scoped pepper transfer privately. Preserve all original product ownership, roles, sessions, aliases and consent. Reconcile before one coherent login/recovery cutover. Do not overwrite a newer password or resurrect a deleted user in a late copy.

Prove version-checked legacy hash modernization after successful login, concurrent login/reset/rehash, failures after password write, and rollback after a user has changed a password in Accounts. The custom verifier alone does not implement the upgrade. Preserve Aegyo's Session cookie/getSession consumers through its supported OIDC callback and additive Prisma mapping. Never run the main site's migration/seeding build against production as a read-only check.

## Reset, revocation and callback gate

Run T25/T27/T28 anew on Better Auth in real browsers, independently for every client:

1. Verify original `auth_time` differs from later token issuance; validate finite `max_age` on normal/silent authorization and force interactive login with zero. Reject forged/missing/malformed claims, wrong audience/issuer/nonce/state, code reuse and wrong PKCE verifier. Custom security fields must be server-owned.
2. On device A reset a synthetic password while B retains old IdP cookies. Clear only B's app cookies and open each app. Restore B's stale fixture for every test so the first fresh login does not mask later failures. Old IdP sessions and pre-issued codes must not authorize new app sessions or Privy provisioning.
3. Repeat with existing app cookies/tokens. Sensitive mutations check authoritative security state; ordinary private-state exposure must meet the maximum 30-second bound. Native IdP revocation and back-channel logout alone are not that proof.
4. Test concurrent old-password verification/session creation versus reset, reset-hook/database failure, admin revocation/ban and interrupted hash upgrades. Commit durable cutoff/version changes safely; do not mistake a `passwordChangedAt` field for serialization. Rerun the local database-trigger and paused-login cases inside the deployed Linux service. The current proof blocks authenticated/admin password writers and protects recovery; confirm recovery preserves existing UX, and prove any additional writer before enabling it. The timestamp is now written atomically by the credential trigger, not `onPasswordReset`. A post-commit hook can still fail after the credential changed; the UI must support retrying login or obtaining a new recovery link without a success claim. Use a separate migration owner and application database role; catalog both required triggers, prevent the application role from disabling them, and refuse service readiness if guards/schema are missing. The Accounts runtime migration/readiness layer implements these controls and has passed the isolated proof; revalidate them against each deployed release and its product adapters.
5. Keep reset/operator comparison strict. On recognized stale authentication, wait past the required whole-second cutoff, clear the affected local session and create one fresh transaction with `max_age=0` and no `prompt=none`. A second/unrelated denial ends recoverably. Five-second forward skew only bounds timestamp sanity, never relaxes cutoff comparisons.
6. Prove active guest/official games survive required renewal at safe boundaries. Verify supported back-channel logout delivery/validation separately; refresh-token behavior requires its own proof if later enabled.

## Privy continuity

The existing app has retained users/wallets; there is no zero-user shortcut. Production JWT entitlement, exact price and supported link-before-provision/direct-call restrictions remain pending product-owner confirmation. There is no recorded evidence here that an email request was sent. Do not enable the feature based on the development badge.

Authenticate the existing Privy identity and central identity before linking, preserve the same DID/wallet/grants/referrals, and verify provider state server-side. Interrupt before/after link persistence and repeat direct valid-JWT provisioning attempts. A new identity must not receive duplicate grants or replace an old wallet. Test fresh-browser login and existing wallet-only recovery. A dual-session link-table path remains a documented UX decision, not automatic completion of shared login.

## Exit and dates

Record evidence privately without real tokens/credentials or user exports in Git. The committed progress report records outcomes and gaps. G1 passes only with real three-app login, migration/restore/rollback, reset/revocation, email and Privy continuity evidence.

September 12 end of day, America/New_York: report access/hosting/DNS/email/Privy readiness. September 14 end of day: if real three-origin staging and reset revocation are missing, escalate scope/date explicitly. September 18 rollout stays conditional. No automatic reminder or advisory watch is active merely because this runbook names the checkpoints.
