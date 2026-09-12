# Legacy account-copy rehearsal

September 12, 2026. This is a local design proof, not an executable production importer or cutover approval.

## Access checkpoint

The authenticated GitHub identity is `mateodaza`. The GitHub repository API reports `push=false`, `maintain=false`, `admin=false` for `Francisgood/kpop-lyrics`, and `push=true` / `admin=true` for `mateodaza/kpop-lyrics`. No push was attempted. The team can continue development in the existing adapter worktree and submit a fork PR without upstream Write access. Direct upstream pushes require Simon to grant at least Write access; branch protection may still require review.

Mateo confirmed Simon manages `aegyoarena.com` DNS. The pending Mailjet ownership record is available in the signed-in domain setup page; Simon can apply the exact record without sharing his Cloudflare account. The final Accounts hostname also needs the exact DNS target issued by the hosting service. Repository access and DNS are separate from the Mailjet sending suspension, which still requires provider review. No support message has been sent in this checkpoint.

## Proof boundary

`services/accounts/tests/legacy-copy.test.mjs` creates its own database inside the existing disposable Unix-socket PostgreSQL runner. It never reads a remote URL, credentials, an exported user file, or production data. Its synthetic source and destination tables share that disposable database. The copy helper is deliberately inside the test file and cannot be invoked as an import CLI.

The proof models a closed target, copies two synthetic legacy users, assigns opaque Accounts subjects, and inserts credential rows plus an explicit source-ID mapping journal in the same database transaction. It retains legacy verification state. An Aegyo owner remains a normal Accounts user: product-specific owner privileges stay in Aegyo, rather than becoming identity-provider administrator privileges.

It exercises the actual Better Auth HTTP handler after the copy:

- A failure after the first inserted identity rolls back all new users, credentials and mappings, leaving source rows and related history intact.
- Copied UTF-8 legacy passwords sign into the expected explicit Accounts subjects; verified and unverified states remain distinct, and local source IDs/history do not change.
- A normalized-email collision with another source identity aborts. Matching email is never an account-linking rule.
- Recovery replaces the copied password using the provider's actual reset route. A later copy attempt for the same source ID fails closed and cannot overwrite the recovered password. The old password remains rejected and the new one succeeds.

No test output contains real identities or hashes. The source fixture includes a legacy role and related history, but does not substitute for the separate production-schema proof covering runtime-added fields.

## Verification

The pinned Linux Node 24.21.0 container passed 25 unit/runtime/UI/email checks and 27 PostgreSQL tests (including the new parent case and its four subtests), zero skips. The runtime command was `docker run --rm --network none aegyo-accounts-proof:copy-20260912`; image ID `sha256:aea057d38f100383b5f62fc6b964045a6077d3059b9e8140f581b22d4d977761`. ESLint on the changed JavaScript, formatting, and diff whitespace checks passed.

The first rehearsal correctly failed because the provider's generated schema does not supply SQL defaults for `credentialVersion` and `securityVersion`. The copy fixture now inserts both explicitly as zero. Provider-level field defaults must not be assumed to execute during an operator SQL copy. All claims above refer to the corrected passing run.

## What remains before real copying

A reviewed operator importer must implement an authorized read-only source snapshot, the actual cross-database credential-write freeze, exact source namespace and issuer handling, a durable journal with restricted permissions, and the existing Aegyo reconciliation manifest format. It must report ambiguous commit outcomes by inspecting that journal, rather than blindly reimporting; this fixture intentionally rejects repeated source IDs instead of implementing production resume semantics.

A complete population/ownership reconciliation, safely isolated full-data restore, change-during-copy tests, signup provisioning/consent, and real three-origin browser flows remain required. The test's table lock and local source/journal foreign key only model the proof's single-database boundary; they are not a cross-database transaction or a production schema proposal. No production row, runtime service, DNS record, API key or user session was changed by this work.

Run with the pinned Node 24.21.0 Docker proof target, with runtime networking disabled, as documented in the Accounts README.
