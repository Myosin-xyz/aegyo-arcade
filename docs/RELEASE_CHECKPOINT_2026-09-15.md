# Release checkpoint — September 15, 2026

This checkpoint supersedes the September 12 dependency status. It records bounded observations, not continuous monitoring or production activation.

## Email delivery is working

Resend reports `aegyoarena.com` **Verified**. The observed authoritative DNS contains its DKIM TXT and the `send` subdomain MX/SPF records. The existing sending-only staging key is now restricted to this domain. Accounts staging uses `accounts@aegyoarena.com`, Resend mode, and signup disabled; configuration-only deployment `7bb806a0-7975-46b4-95bb-a8382689062f` succeeded with runtime source `3841cf5`.

A dedicated dated alias in Mateo's Myosin mailbox received both verification and recovery messages in Gmail **Inbox**. Gmail displayed `send.aegyoarena.com` as mailed-by, `aegyoarena.com` as signed-by, and TLS. Both actual mailbox links were exercised:

- Verification marked the exact staging fixture verified; both retained provider sessions reflected it.
- Recovery invalidated both retained provider sessions; the old password returned HTTP 401.
- Reopening the used recovery link returned `INVALID_TOKEN` and the invalid/already-used page.
- The new password reached the signed-in page with “Email verified.” Signout completed.
- A final exact-fixture database read confirmed verified email, a persisted password-change timestamp, and zero sessions.

Temporary remote proof files and local retained cookies/old password were removed. The staging identity remains available for future recovery-based tests. No ordinary user's password was changed. This run did not repeat product-local reset tests or prove production email configuration, future inbox placement, or campaign sending capacity.

## Access and preservation baseline

Mateo accepted the pending repository invitation. GitHub now reports push access to `Francisgood/kpop-lyrics`. PR #12 remains a separate reviewed release step; accepting access does not merge it.

A dedicated nonprivileged legacy canary was created through Aegyo's actual production signup route with newsletter subscription explicitly false. Its old password was accepted by the actual login route for the exact same source ID, and both resulting sessions were signed out. Its unverified email status must remain unchanged during migration. Its password and source ID are kept only in the ignored private handoff file.

The subsequent read-only inventory found **54 users, 26 sessions and 48 public tables**. These counts are a checkpoint, not a substitute for complete row reconciliation or a frozen production cutover snapshot. The naturally occurring population can change before cutover.

Railway's normal backup listing contains backup `eeac675a-427d-4a5c-b85b-304f6753808b`, named `pre-shared-auth-rehearsal-20260915`, created `2026-09-15T14:20:15.005Z` (261 MB referenced). The workflow-status endpoint refused authorization; the recorded evidence is the authorized backup-list result. Restore usability must be proved separately.

## Remaining release gates

1. **Accounts hostname:** authoritative DNS still lacks `account.aegyoarena.com`. Required DNS-only CNAME: `account` → `2tmkqmk3.up.railway.app`. Resend DNS is a different set of records and is complete.
2. **Final production migration:** the actual restored-data rehearsal passed for all 54 users, 26 legacy sessions and 48 original tables. Production still requires a fresh coordinated credential-writer freeze, snapshot, import, mapping reconciliation and activation; a successful clone does not migrate the live products.
3. **Aegyo release ordering:** install only the reviewed additive auth schema before the adapter deploy, leaving mappings and latch empty and shared auth disabled. The runtime reads the latch even in legacy mode. Do not run the incompatible historical Prisma migration chain against production.
4. **Daebak ownership:** exercise the dual-session linking journey with a human-controlled existing Privy identity and its corresponding local row. Never link a real wallet identity to the shared synthetic test account. This fallback preserves Privy authorization but does not make Privy login automatic.
5. **Production cutover:** prepare production email, finish reconciliation, activate the same production issuer across the products, and run preservation and session smoke tests before opening the contest.
6. **Contest business decisions:** the user requested proposed defaults because rules and prizes are not finalized. The draft in [the team decision note](COMPETITION_TEAM_DECISION_NOTE.md) remains unapproved; material-prize competition stays disabled.

## Further work completed at this checkpoint

- PR #12 was updated to `4b0ef938837595f799d194e89b0610107c5a2ecb`. Its guarded additive installer was independently rerun against the saved production schema in isolated PostgreSQL 18: full catalog preservation, an unchanged Prisma journal, empty mappings/latch, and rerun refusal passed. The PR remains draft pending the actual migration rehearsal; no production schema was changed.
- The [staging competition lifecycle](STAGING_COMPETITION_LIFECYCLE_PROOF.md) passed positive scoring, daily-best replacement, public standings, immutable close/finalize, authenticated claims, and exact-retry fulfillment. The no-value synthetic round reconciled to two ledger deltas totaling 200 points, one final result, and one fulfilled synthetic award. Material contest approval is separate.
- The existing Daebak email login selected by Mateo succeeded in production and staging. A scoped Privy lookup and production read-only query confirmed one local user, the same derived/stored smart wallet, two grant records, and no referral codes/attributions. The guarded initializer was corrected for the existing RPC binding and a temporary restricted operator role. One exact owned identity is now prepared in staging. An independent database read confirmed one user, zero bindings, and zero grant/referral/beta/notification rows. The browser reached “Sign in to Aegyo Accounts”; human Accounts sign-in and explicit linking remain pending. No financial transaction or grant was requested.
- Two new empty rehearsal databases were created on the existing private restored PostgreSQL service, preserving the September 12 clone. Their separate owner/reader/runtime roles are restricted; public database access is revoked. No additional Railway account, service or public proxy was created for them. Both the literal wrapper proof and remote execution passed; see the observed result below.


## Real restored-data import passed

The initial inspect restored all 48 tables and verified full original-row fingerprints. Its subsequent snapshot step refused a CA-versus-leaf fingerprint mismatch. The preserved clone remained intact. Correcting the independently observed leaf pin and running the read-only resume produced the approved 54-user snapshot without copying production a second time.

Clone-only apply deployment `be03f22f-0a3f-43e2-8242-bd69b9ab11ba` succeeded once. Independent reads found 54 Accounts users, 54 credential accounts, 54 import identities, one import batch, 54 Aegyo mappings, and one clone activation latch. The clone retained 54 users and 26 sessions. The canary kept the exact mapping, unverified email and ordinary user role; its existing password worked through the restricted Accounts runtime role. The full snapshot and ownership reconciliation passed. Production was not connected during apply. Operator connection strings, passwords, pepper and canary secrets were cleared after acceptance. Full details are in [the real import operator record](REAL_AEGYO_IMPORT_OPERATOR.md).

## Production preparation and remaining human steps

The reviewed additive production schema installer was attempted once after the rehearsal. Its preservation assertion refused an Album fingerprint mismatch, and PostgreSQL rolled back the transaction. A separate read confirmed 54 users, 26 sessions and no partial mapping, latch or operator-journal table. No adapter deployment or auth cutover occurred. Diagnose and fix the assertion before another attempt; never interpret a failed installer as installed schema.

The production Aegyo start override includes a non-idempotent seed command. Set it to `npm start` after schema installation and before merging the adapter. Preserve the reviewed `npx prisma generate && next build` build override: the historical Prisma migration chain must not run against this catalog. Keep shared auth disabled and mappings/latch empty through the adapter smoke test.

Production Accounts now has the verified branded sender and selected Resend configuration saved without deployment. It reuses the existing domain-restricted sending-only key; production does not yet have an independent key. Traffic and signup remain false, and production delivery is still unproven. No paid plan was selected. Accounts DNS, the human-owned Daebak link, the final frozen production migration and approved contest rules remain the activation gates.
