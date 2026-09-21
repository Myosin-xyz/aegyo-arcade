# Production authentication cutover operator

Status: operator implementation only. Nothing in this document schedules a run,
changes Railway, imports production users, or inserts the activation latch.

The operator is deliberately manual and fail closed. Every invocation requires a
phase-specific confirmation, a fresh Railway attestation, exact production
service and private database identities, and a bundle built from reviewed Git
commits. It never reads the ordinary runtime `DATABASE_URL` and its public output
contains only counts, digests, phase state, and boolean gates.

## Current operational checkpoint (2026-09-22, America/Bogota)

These observations record today's state. They are not constants for a future
cutover; the operator discovers the population and requires newly reviewed
digests after the credential freeze.

- Aegyo's latest observed successful deployment before the final freeze is
  `5b72320d-93f9-42db-aae9-cea58d8d5799` at
  `17b2eb619e94b73fabb8f6db55d873b76ffe8e34`. It contains the reviewed public
  and hidden-writer freeze protections from PR #15. A final freeze/config
  change will produce a new deployment ID. The reviewed commit must remain on
  Francisgood's `upstream/main` and contain freeze commit
  `a01aa0fcbcb654dc16f3bb0e7b76909de20b823d`.
- The read-only Aegyo observation was 55 users, 27 sessions (8 active), 51
  public tables, 70 event registrations, no live reset codes, no shared-auth
  mappings, and no activation latch. A fresh Railway backup completed at 08:39
  local and was 266 MB.
- Accounts was observed with zero users, accounts, sessions, and JWKS; three
  OAuth clients; schema version 1; and guard revision 2. A fresh Accounts backup
  completed at 09:14 local and was 863 MB.
- Arcade's 1.11 GB production backup completed before migrations 0001-0004 were
  applied from deployed SHA `46f0419`. The exact journal hashes were verified,
  the 12 preexisting tables were preserved in the migration transaction, and
  the public table count became 27. New account and competition tables remained
  empty; flags stayed off and gated routes stayed 404. Post-operation guest
  counts were 2,570 devices/device sessions, 371 runs, 180 leaderboard rows, 231
  streaks, and 69 claw plays. Devices grew while that operation ran.
- `account.aegyoarena.com` now has the required CNAME and ownership TXT.
  Railway accepted the domain after it was reattached with the same record
  values. The public endpoint presents a certificate whose SAN is exactly
  `account.aegyoarena.com`, `/healthz` returns 200, and the response no longer
  carries `x-railway-fallback`. Every phase must still recheck the live public
  endpoint rather than relying on this dated observation.
- Operator service `57406cd0-f9ae-4000-b893-684aa2e0db16` has no persistent
  volume. This implementation does not require one: each run obtains a fresh
  snapshot, reconstructs reconciliation from the committed import journal, and
  verifies the approved snapshot, preservation, and mapping digests. Private
  scratch files are disposable. Reviewed approvals and the live attestation are
  handed in through a new private bundle for each phase.

## Required sequence

1. Take and verify fresh Aegyo and Accounts backups. Record completion, size,
   retention, and restore owner outside the operator container.
2. Put Aegyo credential mutation behind `AEGYO_AUTH_CUTOVER_FREEZE=true`. Drain
   application requests and pause every direct database writer, including event
   registration, administrative writers, write-on-GET adapter paths, and the
   buffered view counter. Wait at least for the 30-second view-count buffer to
   flush and for the reviewed freeze deployment to succeed. Keep Accounts
   traffic and Aegyo shared auth off. The metadata flags document this external
   drain; they do not replace it.
3. On a trusted local host, use
   `production-cutover-attestation.mjs inspect <private-json>` to query current
   Railway variables and successful deployment metadata. The file must be owned
   by the current user and mode 0600. Build a private operator bundle with
   `build-production-cutover-bundle.mjs`, the exact Aegyo checkout, reviewed
   Aegyo ref, and that attestation. Do not reuse a bundle for another phase.
4. Run `inspect` with confirmation `inspect-frozen-production-cutover`. Review
   the newly discovered user count, source snapshot digest, and complete
   49-table preservation digest. Before the auth snapshot, every phase takes two
   complete preservation fingerprints 45 seconds apart and refuses any change.
   This observed quiet period covers the known 30-second buffered view-count
   flush; it does not excuse missing a writer from the external drain. The user
   count is an operator input for later phases; it must never be copied from this
   dated checkpoint without a fresh observation.
5. Create a new `apply` attestation and bundle. Supply the explicitly approved
   snapshot and preservation digests and confirmation
   `import-frozen-production-users-and-install-reviewed-mappings`. Apply imports
   only into the empty prepared Accounts database. It then reconstructs every
   local mapping and reconciles every catalog FK to `User`, including
   `KimchiRating`, `PointEvent`, and `SuggestedEdit.reviewedById`, before it
   installs mappings. It does not insert the activation latch.
6. If any commit response is uncertain, run `status` with a fresh status
   attestation and confirmation `inspect-production-cutover-status`. The import
   journal and source mappings distinguish `not_started`,
   `imported_not_mapped`, `mapped_not_active`, and `active`. Resume from that
   state. Never delete or reimport committed users.
7. While the Aegyo freeze and full writer drain remain in effect, enable
   Accounts traffic and set Aegyo shared auth on. Products still remain closed
   because there is no latch. Wait for the new config-only Accounts and Aegyo
   deployments and attest those fresh deployment IDs, the reviewed image/source,
   and the live flags.
8. Through the custom HTTPS domain, prove `/readyz`, OIDC discovery, JWKS,
   exactly three callbacks, deployed-runtime legacy-password sign-in, code and
   token exchange, and the authenticated session-state endpoint. Complete a
   public recovery request for the imported canary, receive the message, reset
   the password, verify old-password rejection, prior-session revocation,
   single-use token rejection, and new-password sign-in. Store only a timestamp,
   the approved snapshot/mapping digests, a SHA-256 provider message-ID digest,
   and boolean outcomes in a mode-0600 recovery evidence file. Do not store the
   address, password, reset link, raw token, or provider message ID.
   Sign the canary out and verify the proof left no sessions or OAuth tokens.
9. Create a fresh `activate` attestation referencing that recovery evidence and
   build a new bundle. Run `activate` with confirmation
   `activate-reviewed-production-mappings`. The operator re-snapshots the frozen
   source, requires at least one persistent JWKS row and zero existing Accounts
   sessions/access tokens/refresh tokens, reconstructs exact mappings and
   ownership, calls the public deployed Accounts sign-in path for the imported
   canary, checks OIDC/JWKS/state, revokes the canary tokens, removes the new
   canary session, locks all source tables, rechecks preservation, and inserts
   the immutable latch as its final database action.
10. Run `status` after any ambiguous activation response. Release the Aegyo
    credential freeze only after status reports `active` and separate product
    acceptance is complete. The operator never releases the freeze or enables
    product features.

## Recovery evidence shape

The activation attestation accepts a private JSON object with this allowlisted
shape. All booleans must be true, both cutover digests must match the approved
activation inputs, the provider digest must match the separately attested live
configuration value, and `capturedAt` must be no more than 24 hours old.

```json
{
  "version": 1,
  "capturedAt": "2026-09-21T00:00:00.000Z",
  "sourceSnapshotDigest": "<sha256>",
  "mappingDigest": "<sha256>",
  "deliveryProviderIdDigest": "<sha256>",
  "publicRecoveryRequested": true,
  "delivered": true,
  "resetCompleted": true,
  "legacyPasswordSignin": true,
  "oldPasswordRejected": true,
  "priorSessionsRevoked": true,
  "replayRejected": true,
  "newPasswordSignin": true
}
```

The live Accounts Railway configuration must expose only the matching digest as
`ACCOUNTS_PRODUCTION_RECOVERY_PROVIDER_ID_DIGEST`; it must not contain the raw
provider message ID.

## Stop conditions

Stop without retrying a write when an output says the commit outcome is unknown.
Run the status phase first. Also stop for a changed count/digest, any unrecognized
or partial journal/mapping state, an unexpected host/database/role/service, an
old or wrong-phase attestation, active signup, missing drain, missing custom TLS,
missing JWKS, callback drift, canary/recovery failure, ownership-catalog drift,
or any source content change. A new review and explicit approval are required
for new digests.
