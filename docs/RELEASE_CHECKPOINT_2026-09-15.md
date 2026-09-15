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
2. **Actual migration rehearsal:** use an isolated fresh full-data clone, exact original-row fingerprints, the actual importer and reconciliation tools, and the legacy canary. Operator implementation alone is not rehearsal success. Production writers need not be frozen for an isolated exported-snapshot rehearsal; the final production cutover does need the coordinated writer freeze.
3. **Aegyo release ordering:** install only the reviewed additive auth schema before the adapter deploy, leaving mappings and latch empty and shared auth disabled. The runtime reads the latch even in legacy mode. Do not run the incompatible historical Prisma migration chain against production.
4. **Daebak ownership:** exercise the dual-session linking journey with a human-controlled existing Privy identity and its corresponding local row. Never link a real wallet identity to the shared synthetic test account. This fallback preserves Privy authorization but does not make Privy login automatic.
5. **Production cutover:** prepare production email, finish reconciliation, activate the same production issuer across the products, and run preservation and session smoke tests before opening the contest.
6. **Contest business decisions:** the user requested proposed defaults because rules and prizes are not finalized. The draft in [the team decision note](COMPETITION_TEAM_DECISION_NOTE.md) remains unapproved; material-prize competition stays disabled.
