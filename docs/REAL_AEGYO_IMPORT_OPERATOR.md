# Real restored-data Accounts rehearsal operator

This is a two-phase, private rehearsal in the pinned Aegyo Railway project and environment. It targets two new databases on the existing restored PostgreSQL service. It refuses production database names, public hosts, normal `DATABASE_URL`, open traffic/signup, changed service identities, or an unpinned Aegyo revision.

## Reviewed source bundle

Build with `node services/accounts/scripts/build-real-import-rehearsal-bundle.mjs /Users/mateodazab/Documents/myosin/kpop-lyrics-shared-auth services/accounts/.proof/real-import-bundle <reviewed-accounts-commit>`. The builder reads allowlisted files with `git show`: no working tree, `.env`, proof directory, credential, or repository metadata enters the bundle. The image pins Node 24.21.0, PostgreSQL client 18 and the minimal locked Prisma 5.22 dependency closure.

All URLs, CA certificates, certificate pins, role passwords, provider secret, legacy pepper, and canary credential remain secret Railway variables. The actual population count is reviewed at snapshot time; it is currently expected to be 54, including the naturally unverified team canary created via the real legacy signup route with `subscribe:false` and verified via real legacy sign-in.

## Phase 1: inspect

Set `ACCOUNTS_REAL_IMPORT_REHEARSAL_PHASE=inspect` and confirmation `restored-data-accounts-import-reconciliation-inspect`. Supply the production read-only source URL and the new empty clone owner URL. The pinned restore operator requires durable source read-only role attributes, exports one repeatable-read snapshot, computes every source-table row fingerprint, and uses that same snapshot for `pg_dump`. It restores atomically into the empty clone and compares all fingerprints.

The operator then runs the actual Accounts importer snapshot against the clone and emits only `{count,snapshotDigest}` plus aggregate success flags. The clone becomes the immutable reviewed import source. Production writes may continue: the exported snapshot provides consistency during cloning, and no production writer freeze is required for this isolated rehearsal.

Review the count/digest. Provision a durable read-only role on the clone and retain the owner only for the additive Aegyo rehearsal changes. Do not change clone user/credential rows between phases.

## Phase 2: apply

Set `ACCOUNTS_REAL_IMPORT_REHEARSAL_PHASE=apply`, confirmation `restored-data-accounts-import-reconciliation-apply`, the approved digest, the clone reader URL, clone owner URL and empty Accounts target URL. Apply refuses any production source connection. The importer re-snapshots the immutable clone and requires the reviewed digest, then migrates Accounts schema v1, installs its operator-only journal and applies atomically. Its existing `source-writers-and-target-traffic-frozen` confirmation describes the immutable clone plus disabled Accounts traffic; it does not require freezing production.

The operator captures Aegyo ownership for every present supported table (`Session`, `Favorite`, `Comment`, `SuggestedEdit`, `SlangVote`, `PollVote`, and both `Follow` directions), including exact linked record IDs. It installs only the pinned additive shared-auth schema, runs the pinned reconcile/install/activate/status CLIs, captures ownership again, and requires an identical manifest and complete mapping count.

The canary check constructs a private query-free URL for the restricted Accounts application role, verifies `current_user`, and then signs in through maintained Better Auth with the old password. It therefore tests runtime grants rather than migration-owner privileges.

## TLS and failures

Libpq connects to the resolved private address while setting TLS hostname `localhost` (`host=localhost&hostaddr=...`) to match the Railway database certificate. Node `pg` validates the supplied CA and reviewed leaf SHA-256 pin. Prisma connects to `localhost` through a raw loopback-only TCP relay. TLS is not terminated by the relay: certificate verification and PostgreSQL 18 SCRAM channel binding remain end to end. Prisma requires `sslmode=require`, `sslaccept=strict`, and the private CA path. The operator separately checks the same leaf certificate CA and SHA-256 pin before starting the relay.

Child output and private artifacts remain in a mode-0700 phase directory. Public failures contain only allowlisted phase codes. Failed databases/artifacts require inspection; never infer rollback, delete imported identities, or repoint this operator at production. Accounts traffic and signup remain disabled, and no external mail is sent.
