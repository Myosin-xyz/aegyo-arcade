# Real restored-data Accounts rehearsal operator

This is a two-phase, private rehearsal in the pinned Aegyo Railway project and environment. It targets two new databases on the existing restored PostgreSQL service. It refuses production database names, public hosts, normal `DATABASE_URL`, open traffic/signup, changed service identities, or an unpinned Aegyo revision.

## Reviewed source bundle

The current builder pins the reviewed Aegyo operator files at `f27b14f0c35fd710726cb5e1394d17c99d4ec348`. A semantic probe refuses a bundled reconciler that ignores linked-row or anonymous-poll content digests.

Build with `node services/accounts/scripts/build-real-import-rehearsal-bundle.mjs /Users/mateodazab/Documents/myosin/kpop-lyrics-shared-auth services/accounts/.proof/real-import-bundle <reviewed-accounts-commit>`. The builder reads allowlisted files with `git show`: no working tree, `.env`, proof directory, credential, or repository metadata enters the bundle. The image pins Node 24.21.0, PostgreSQL client 18 and the minimal locked Prisma 5.22 dependency closure.

All URLs, CA certificates, certificate pins, role passwords, provider secret, legacy pepper, and canary credential remain secret Railway variables. The actual population count is reviewed at snapshot time; it is currently expected to be 54, including the naturally unverified team canary created via the real legacy signup route with `subscribe:false` and verified via real legacy sign-in.

## Phase 1: inspect

Set `ACCOUNTS_REAL_IMPORT_REHEARSAL_PHASE=inspect` and confirmation `restored-data-accounts-import-reconciliation-inspect`. Supply the production read-only source URL and the new empty clone owner URL. The pinned restore operator requires durable source read-only role attributes, exports one repeatable-read snapshot, computes every source-table row fingerprint, and uses that same snapshot for `pg_dump`. It restores atomically into the empty clone and compares all fingerprints.

Set the explicit source schema status: `legacy` requires the original 48 public tables; `additive-v1` requires 51, including the already-installed auth schema and its operator journal. Use fresh empty databases for both targets. Never reuse an activated clone or imported target to replace missing historical evidence.

The operator then runs the actual Accounts importer snapshot against the clone and emits only `{count,snapshotDigest}` plus aggregate success flags. The clone becomes the immutable reviewed import source. Production writes may continue: the exported snapshot provides consistency during cloning, and no production writer freeze is required for this isolated rehearsal.

Review the count/digest. Provision a durable read-only role on the clone and retain the owner only for the additive Aegyo rehearsal changes. Do not change clone user/credential rows between phases.

## Phase 2: apply

Set `ACCOUNTS_REAL_IMPORT_REHEARSAL_PHASE=apply`, confirmation `restored-data-accounts-import-reconciliation-apply`, the approved digest, the clone reader URL, clone owner URL and empty Accounts target URL. Apply refuses any production source connection. The importer re-snapshots the immutable clone and requires the reviewed digest, then migrates Accounts schema v1, installs its operator-only journal and applies atomically. Its existing `source-writers-and-target-traffic-frozen` confirmation describes the immutable clone plus disabled Accounts traffic; it does not require freezing production.

Before import or mapping writes, the operator captures ownership in one repeatable-read, read-only transaction. It requires the exact CamelCase tables and actual ownership columns: `Session`, `Favorite`, `Comment`, `SuggestedEdit`, and `SlangVote` use `userId`; `Follow` uses `followerId` and preserves `targetSlug` through its full-row digest; profile `PollVote` rows use `voterRef`. Unknown vote types, orphan owners, partial auth schema, and missing required tables fail closed.

Evidence includes exact linked-record IDs and canonical row-content digests. Anonymous device votes are separate and always included without exporting their device references or contents. The five new Session metadata columns are the sole canonicalization exception across legacy/additive schema: they must remain null for every retained legacy session. All other original Session fields are covered. The isolated clone must have no external writers.

For `legacy`, the operator installs the pinned additive schema. For `additive-v1`, it skips repeated DDL only after the before-snapshot confirms the complete additive shape with zero mappings and zero latches. It then runs the pinned reconcile/install/activate/status CLIs, captures ownership again, and requires an identical manifest, complete mappings and one activation latch.

The canary check constructs a private query-free URL for the restricted Accounts application role, verifies `current_user`, and then signs in through maintained Better Auth with the old password. It therefore tests runtime grants rather than migration-owner privileges.

## TLS and failures

Libpq connects to the resolved private address while setting TLS hostname `localhost` (`host=localhost&hostaddr=...`) to match the Railway database certificate. Node `pg` validates the supplied CA and reviewed leaf SHA-256 pin. Prisma connects to `localhost` through a raw loopback-only TCP relay. TLS is not terminated by the relay: certificate verification and PostgreSQL 18 SCRAM channel binding remain end to end. Prisma requires `sslmode=require`, `sslaccept=strict`, and the private CA path. The operator separately checks the same leaf certificate CA and SHA-256 pin before starting the relay.

Child output and private artifacts remain in a mode-0700 phase directory. Public failures contain only allowlisted phase codes. Failed databases/artifacts require inspection; never infer rollback, delete imported identities, or repoint this operator at production. Accounts traffic and signup remain disabled, and no external mail is sent.

## Initial real-data rehearsal — 2026-09-15

**Evidence correction:** the initial ownership collector skipped CamelCase tables, so its linked-record comparison was empty and cannot prove their preservation. Full restore fingerprints, exact account mappings and the legacy-password canary below remain valid observations. A fresh isolated rehearsal with the corrected collector was required and is recorded below; the activated old clone could not recreate its missing before-snapshot.

The pinned operator restored a consistent production snapshot into `aegyo_auth_rehearsal_20260915_cutover` and verified complete row fingerprints for all 48 source tables. The first importer snapshot attempt stopped after that verified restore because the configured target pin described the CA certificate rather than the live PostgreSQL leaf. No import journal or Accounts mutation existed at that point. A clone-only `resume-inspect` run used the CA-validated live leaf pin, refused a production source URL, verified 54 users, 26 sessions, 48 tables and the absence of `SharedAuthIdentity`, then produced the reviewed snapshot digest. The original short-lived production reader was removed before apply.

Deployment `be03f22f-0a3f-43e2-8242-bd69b9ab11ba` applied that reviewed immutable snapshot to `accounts_rehearsal_20260915_cutover`. The operator reported complete restore fingerprint evidence, mapping coverage, rehearsal activation and imported-canary sign-in. Independent read-only checks found:

- 54 Accounts users, 54 credential accounts and 54 import identities;
- one committed import journal batch and Accounts schema marker version 1;
- 54 `SharedAuthIdentity` mappings and one activation latch in the restored Aegyo clone; and
- the designated canary mapped exactly, remained unverified with role `user`, and authenticated through maintained Better Auth with its original legacy password using the restricted Accounts application role.

Production was not connected during apply. The source snapshot came exclusively from the immutable clone, and production did not require a writer freeze. Accounts traffic and signup remained disabled. After evidence capture, all operator URLs, passwords, provider secret, legacy pepper and canary variables were removed without a redeploy. The one-shot deployment is complete with restart policy `NEVER`; its stopped ephemeral filesystem may contain private artifacts and is not a reusable source of truth. The two rehearsal databases remain preserved for review, and their temporary target roles expire on 2026-09-16 at 02:00 UTC.

## Corrected fresh rehearsal — 2026-09-15

The corrected bundle was built from Accounts `56e6740fcefa0e5645c3ec5859f5ac9c082db890` and the reviewed Aegyo operator files at `f27b14f0c35fd710726cb5e1394d17c99d4ec348`. Its 27-file manifest digest was `564db4e482caa82cb8ec055187b435bf4be8cbaeb4a8847a6ee025a0678eff73`. Fresh empty targets `aegyo_auth_rehearsal_20260915_ownv2a` and `accounts_rehearsal_20260915_ownv2a` preserved both earlier clones.

Inspect deployment `678f2d11-c440-49ea-b80f-d0380a15ae1c` succeeded in `additive-v1` mode. All 51 original table fingerprints matched after restore. The reviewed 54-user **import snapshot** digest was `8a001fd3eb9b2824d55b69d091fd1a5511a0be7f7f7ae162846ab42049d9e48c`; this is distinct from the linked-record reconciliation digest. The short-lived production reader was revoked and dropped, and source connection variables were scrubbed before apply.

Clone-only apply deployment `21575df6-0520-4d5d-a102-b8c5d91131d2` succeeded once. The reviewed operator captured the corrected ownership snapshot before import, skipped repeated additive DDL only after validating the installed empty auth schema, installed exact mappings and the clone latch, then required identical normalized before/after ownership manifests. The existing-password canary also passed through the restricted Accounts application role with its unverified state and ordinary role retained.

Independent post-run queries found:

- Aegyo clone: 51 tables, 54 users, 26 sessions, 54 mappings, one latch and zero populated shared-session metadata fields.
- Covered records: 26 sessions, two favorites, 90 comments, 275 suggested edits, zero slang votes, two follows, zero profile poll votes and five anonymous device poll votes.
- Accounts clone: 54 users, 54 credential accounts, 54 import identities, one import batch, schema version 1 and guard revision 2.
- Persisted immutable mapping digest: `e7ea11150e37feb9a9d0752c3ef2b389a222a9e5b3c261420fd349339db16f06`.

The before/after ownership comparison is execution evidence from the pinned operator reaching success after its exact comparison; the post-run counts and persisted mapping digest were verified separately. The ownership `localSnapshotDigest` value was not exported and must not be confused with the import snapshot digest above. No completed job was restarted to recover ephemeral files.

The operator stopped and its variables were replaced with only the `apply-complete` marker. Four isolated review roles remain restricted and time-expiring; the clones remain private for review. This closes the corrected restored-data rehearsal gate. It does not migrate production users, prove the human Daebak link, activate shared login, or approve a prize contest.
