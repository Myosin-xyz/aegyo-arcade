# Shared-auth staging proof runbook

This runbook executes G0/G1 of the delivery plan. All checks use approved isolated staging resources. Do not run the main site's default build against a production database: it invokes migration and seeding.

## Local preparation

Use the `codex/shared-auth-proofs` worktree. Existing dependencies are available through a local `node_modules` symlink; a fresh checkout can install from the lockfile normally.

```sh
npm run test:auth-proof
npm run typecheck
npm run auth:preflight
```

Preflight exit code 2 means configuration is missing or unsuitable. It is expected before provisioning. It never creates a tenant or changes external settings. When an approved staging configuration exists, load it explicitly without displaying secrets:

```sh
node --env-file=.auth-proof/staging.env scripts/auth-proof/preflight.mjs
```

The script reports required variable **names**, never values. The three origin values must be separate HTTPS staging origins. An all-localhost proof is insufficient. Verify separately that these hostnames and credentials belong to staging; syntactic validation cannot establish resource ownership or production isolation.

## Aggregate inventory

The collector never implicitly loads `.env.local`. Choose exactly one explicit connection source. From this worktree, the known Arcade read-only inventory command is:

```sh
node scripts/auth-proof/inventory.mjs \
  --product arcade \
  --railway-cwd /Users/mateodazab/Documents/myosin/aegyo-arcade \
  --service postgres-prod \
  --environment production
```

For another authorized source, use an environment variable populated through the team's existing secret handling:

```sh
node scripts/auth-proof/inventory.mjs \
  --product aegyo \
  --database-env AUTH_PROOF_INVENTORY_DATABASE_URL
```

Allowed products are `aegyo`, `arcade` and `daebak`. Inspect the resulting local `.auth-proof/*-inventory-*.json` inside the authorized environment. Counts are exact within one read-only snapshot; a timeout or permission failure produces no completed report. Missing expected tables returns exit code 2 and requires investigation, not an assumption that there are zero users.

Inventory records public-table names, counts, column types and constraint names/status. It does not read data rows or use ORM schemas as the full database catalog. Cross-check Privy's aggregate dashboard total separately, including provider-only users. Re-run before the final freeze. Independently verify deployment-to-database binding and restoration permissions.

## Auth0 and Aegyo migration proof

1. Confirm the actual plan/connection entitlement, three separate product clients and production email-provider configuration. Allowlist exact callback/logout origins. Configure the selected OIDC SDK's signature, issuer, audience, state, nonce and code-flow protections. Do not replace those with the freshness helper.
2. `npm run auth:proof-fixture` generates two synthetic records in `.auth-proof/synthetic-users.json`, refusing overwrite. The fake `.invalid` emails cannot receive messages; use a separate explicitly authorized test mailbox for SMTP/recovery delivery. Synthetic passwords and salt are visible only in the fixture source and are not production credentials.
3. In the approved isolated database connection, import the synthetic file and inspect the job report privately. Confirm old-password login, expected `auth0|<legacy-id>` subject mapping and unchanged verification state. The local hash test does not substitute for this provider check.
4. Restore an authorized staging snapshot. Inventory all real/runtime tables and relationships; prove that credential configuration matches the actual source. No production credential material goes into source control, task output, fixtures or analytics.
5. Rehearse the freeze of every credential/account writer, including in-flight signup/reset/email change/admin actions and deletion. Snapshot, export, import, reconcile, validate, then switch login and recovery together. Keep imported login inaccessible until validation. Record the measured freeze window and all manifest checks privately.
6. Preserve existing local IDs, Session rows/cookie consumers, roles, profile URLs, consent and event/community data. Replace unusable old reset links with an understandable fresh-recovery path. Test legitimate writes after the snapshot and a failed import/cutover.
7. After a provider login or reset, do not assume re-import can overwrite its password. Prove rollback keeps the right credential authority and does not silently revert a user's new password. No production credential freeze is authorized by running local tests.

## Freshness, reset and retry proof (T25/T27/T28)

The supplied Action is a **staging fallback candidate**. It emits the signed reset-state contract for the adapters. It does not yet enforce the cutoff centrally. Configure `AEGYO_CLIENT_ID`, `ARCADE_CLIENT_ID` and `DAEBAK_CLIENT_ID` as Action configuration, distinct from the local preflight variable names. Do not deploy it onto unrelated clients.

Implement each callback with the selected OIDC SDK, then call the policy on already-verified claims before creating local sessions or downstream Privy authority. Source `operatorCutoffMs` from authoritative shared state. Missing state must not default to null/no revocation. Preserve the original `auth_time`; never substitute token `iat`.

1. Every ordinary/renewal authorization sends explicit finite `max_age`. Capture sanitized confirmation that each top-level `prompt=none` request executes the Action. Set and measure the actual session lifetime and accepted read/write revocation window.
2. Establish whether `event.authentication.methods` contains a suitable original authentication timestamp and whether it matches the relevant `auth_time` semantics. Do not infer freshness from arbitrary MFA/custom-method completion. Central enforcement can replace the reset comparison only after equivalence is proven; every adapter still performs normal OIDC freshness validation and operator-cutoff checks.
3. Disable the asynchronous password-change Action. Sign into provider SSO on device B, then reset the same synthetic identity on device A. Clear only B's app cookies. Open each product independently with pre-reset SSO. Restore the stale-session setup before each product test; a successful fresh login in the first app must not mask failure in another.
4. Confirm that no local session, member provisioning, Privy provisioning or protected write is granted from the stale authentication. Wait until the policy's `notBeforeMs` before issuing the single fresh transaction with `max_age=0` and **without** `prompt=none`. Validate state/nonce and the returned freshness. Repeated denial stops at a recoverable error. Unrelated `access_denied` responses do not enter the retry flow.
5. Repeat with reset/login in the same second, existing local sessions, no reset yet, missing or malformed Action claims, unsupported connections, operator revocation, app-state loss and network/Action failure. Record timestamp units/precision and measured timing without logging full ID tokens or identity data.
6. Preserve an active game through renewal. If the existing-session exposure exceeds the accepted bound, G1 fails even if new callbacks are correct. Refresh-token flows, if enabled later, need separate proof.

## Privy continuity proof

Use the existing app and retain every existing identity; the inventory rules out assuming there are no users. Current enabled methods are email and external wallets according to the inspected dashboard; do not treat absent Google/Apple settings as evidence about historical identities without the authorized inventory.

Resolve custom-auth enablement and actual production entitlement first. The dashboard's development-mode allowance is not a production entitlement. No toggle or upgrade is part of the read-only inspection.

For the retained identity, prove the legacy Privy session and shared session before linking. Preserve Privy DID, embedded/external wallet ownership, grant identity/idempotency, referral attribution and recovery. Interrupt linking before/after mapping persistence, repeat requests and attempt a direct valid-JWT call to Privy. No path may create a second valued identity/wallet or duplicate grant. Prove fresh-browser behavior across all three origins; a local ownership link alone is not shared login.

## Evidence and exit

Keep provider/job reports, aggregate manifests, screenshots without personal data, restore results and sanitized timing evidence in approved private storage. The committed progress report contains status and blockers only. Mark G1 passed only after observed runtime evidence covers migration, three-app login, recovery, Privy continuity, direct-call bypass attempts and rollback. Then proceed to the account foundation and the verified competition phases.
