# Real restored-data Accounts rehearsal operator

This operator is a reviewed rehearsal path for the existing Aegyo Railway project. It cannot target the production database names, another project, another environment, another PostgreSQL service, another operator service, an unpinned Aegyo source revision, a public database host, or an Accounts service with traffic or signup enabled.

It performs one bounded sequence after an operator has created two new empty databases on the existing private restored PostgreSQL service: a fresh Aegyo restore target and a dedicated Accounts target. It does not create Railway services, domains, TCP proxies or accounts.

## Source bundle

Run `node services/accounts/scripts/build-real-import-rehearsal-bundle.mjs /Users/mateodazab/Documents/myosin/kpop-lyrics-shared-auth services/accounts/.proof/real-import-bundle <reviewed-accounts-commit>` from this repository. The builder requires the Aegyo checkout HEAD at commit `e9e0468fe7dc477e3188d18d0ab769d5bddb990e` and writes a new private directory. It reads every file from that commit with `git show`; working-tree changes, untracked files, environment files, proof artifacts and repository metadata cannot enter the bundle.

The generated Docker build has separate locked dependency installations for Accounts and the minimal Aegyo operator (`@prisma/client` and Prisma 5.22.0 only). The pinned Aegyo commit intentionally does not track its ignored local package lock, so the recipe never copies that untracked file. It pins Node 24.21.0 and installs PostgreSQL 18 client tools, OpenSSL and stunnel. Review the reported commits and file count before uploading only that generated directory to the existing stopped operator shell.

## Required private inputs

Supply all connection URLs, CA certificates, server pins, role passwords, provider secret, legacy pepper, canary email/password/source ID and the approved source snapshot digest as secret operator variables. Do not put them in the source bundle, command arguments, logs or chat. The actual population count must be read and reviewed after the fresh canary exists; never assume 53.

The canary was created through the actual legacy signup route with `subscribe:false`, signed in through the actual legacy login route as the same source ID, and signed out. It is naturally unverified and must stay that way through restore and import. This proves a new credential emitted by the actual legacy writer. It does not replace full-row preservation evidence for the older users.

The source database role must be a short-lived durable read-only role. The two destination database names must match `aegyo_auth_rehearsal_YYYYMMDD_SUFFIX` and `accounts_rehearsal_YYYYMMDD_SUFFIX`; both must be new and empty. Revoke `CONNECT` from `PUBLIC`, grant each role only its database, and keep the two destinations on the existing private restored PostgreSQL service. This shares a PostgreSQL instance and volume, so it is rehearsal isolation rather than production-topology independence.

## One-shot behavior

`real-import-rehearsal-operator.sh`:

1. validates the exact Railway and git identities, private URLs, new database names, closed traffic, closed signup, reviewed count and digests;
2. runs Aegyo's pinned restore operator, using one exported repeatable-read source snapshot for `pg_dump` and complete per-table row fingerprints, and requires exact restored fingerprints;
3. installs Accounts schema version 1 in the empty target and its restricted runtime role;
4. snapshots the restored source with the actual Accounts importer and requires the resulting digest to equal the separately approved digest;
5. installs the operator-only import journal and performs the guarded atomic import while the externally established source-writer freeze remains active;
6. builds the private Aegyo reconciliation inputs, installs only the additive shared-auth migration, invokes the pinned reconciliation and mapping CLIs, and activates only the database whose name is constrained to the rehearsal pattern;
7. reruns reconciliation after mapping, requires an identical manifest, checks complete mapping status, and signs the canary into the maintained Accounts provider with its old password and exact mapped subject; and
8. removes the short-lived credential proof and prints only boolean aggregate success lines.

The Aegyo Prisma CLI has no CA/pin parameters. The operator therefore checks the restored server certificate against the supplied CA, `localhost` certificate identity and SHA-256 pin, then exposes it only on container loopback through stunnel. Prisma uses plaintext only over that one-shot container's loopback; no public or private-network plaintext connection is created.

Any unexpected child output stays in the mode-0700 work directory. The public failure is an allowlisted phase code. A failed or interrupted run leaves both rehearsal databases and the private operator artifacts for inspection. Never infer rollback, rerun with different inputs, delete imported identities, or point the service at production. Use importer `status` with the original snapshot/digest to resolve an uncertain import commit.

## Remaining operational gates

This code does not create the source-writer freeze. The parent operator must close and drain legacy signup, login password writes, recovery, email changes, deletion and administrator credential writers before the reviewed snapshot/apply interval. Accounts traffic and signup remain off throughout. No external mail is sent. Production activation remains prohibited regardless of rehearsal success.
