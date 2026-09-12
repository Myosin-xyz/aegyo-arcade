# Aegyo production evidence — September 12, 2026

Railway access is now verified. G1 has **not** passed: the observations below unblock preparation but do not authorize a production auth cutover. Existing product login behavior and user data were not modified. One protective on-demand production database backup was created.

## Deployment and database binding

The `kpop-lyrics` Railway project is `a719c26e-33b9-4a1c-8759-d5401c1e181a`, in francisgood’s Projects. The successful production app deployment inspected was `7ebbba12-8ede-489d-be4b-407d5929301b`, upstream commit `3f334045583914f86c82b2a5ec2b9d4f9f2a20c2`. The implementation branch incorporates this upstream state in `271642a`; the upstream delta from `4808319` was event copy. Recheck the production commit before opening or updating the release PR.

The deployed application’s actual database URL was compared privately with its configured Railway value and matched. The app connects to PostgreSQL 18.4. The existing staging app uses a different database; neither its old deployment nor either existing staging database was overwritten.

Railway overrides the repository scripts:

- Build: `npx prisma generate && next build`.
- Start: `npx prisma db seed && npm start`.
- This deployment does **not** run `prisma migrate deploy`.

The four successfully applied production migrations are `20260521000000_init`, `20260523114400_add_roles_auditlog`, `20260523162030_add_annotation_votes_comments`, and `20260525171253_add_points_system`. Their names and checksums do not match the checked-in historical chain. Do not run that chain against production or blindly mark historical migrations applied. The auth release needs an explicit reviewed additive SQL step, with its exact checksum and reconciliation evidence.

## Aggregate inventory

The collector ran through the deployed app's Prisma connection in a repeatable-read, read-only transaction with statement/lock timeouts and an explicit rollback. It inspected catalog metadata and counts across all 48 public base tables. No user rows, email addresses, password hashes, reset codes, or credentials were exported.

| Table               |  Rows |
| ------------------- | ----: |
| User                |    52 |
| Session             |    25 |
| PasswordReset       |     2 |
| Favorite            |     2 |
| Follow              |     2 |
| EventRegistration   |     4 |
| PointEvent          | 7,469 |
| CommunityAnnotation |   342 |
| CommunityComment    |   132 |
| Comment             |    90 |
| GiveawayEntry       |   216 |
| GiveawayEntryLsf    |    47 |

All 52 password hashes have the expected lowercase 64-character hex shape; no normalized-email duplicate groups were found. Thirty users are marked email-verified. Shape checks do not prove a returning user's password succeeds.

`AUTH_SECRET` is absent from both the running environment and the effective environment after the app's Next environment loader. The deployed code therefore uses its legacy fallback. **Do not add or rotate this variable during preparation:** existing passwords and reset codes depend on the effective legacy value. Configure the authorized migration with that exact effective value through a private secret transfer; never commit or print it. Credential modernization remains separately gated.

The actual User table also contains runtime-added `role`, `is_owner`, mailing address, phone, rewards, push, and postal-code fields. Preserving only the Prisma model would be insufficient. Ownership is preserved by keeping local User IDs and application rows in place, adding explicit issuer/subject bindings, and never matching identities automatically by email.

## Backup and rehearsal

A native on-demand backup was created for the production Postgres volume. Railway displayed it as **September 12 at 09:22, 260 MB**, completed with Restore available. No restore or production redeploy occurred. The UI showed no prior backup schedule. It also reports a disconnected source image and unavailable PITR; reconnecting that source could trigger a deployment and was not attempted.

A native backup's existence is not restore proof. Railway documents a restore as a staged volume swap followed by deployment; do not use production Restore as a rehearsal. Cross-service restore compatibility was not established. A safe full-data recovery rehearsal remains open. [Railway backups](https://docs.railway.com/volumes/backups), [PITR](https://docs.railway.com/volumes/point-in-time-recovery).

A private **schema-only** dump was obtained with `pg_dump --schema-only --no-owner --no-privileges`. The new `tests/shared-auth-production-schema-proof.sh` restored it into disposable PostgreSQL 18 with networking disabled and no host mounts, then inserted synthetic users and history. It passed the additive auth migration, unique/FK checks, immutable cutover-latch checks, mapping checks, and preservation assertions for profile, role, owner, password hash, sessions and related ownership. It also checked the additive migration checksum. The parent independently reran this proof successfully under the pinned Node runtime. No production user data was copied into the rehearsal.

The reconciliation tool validates complete explicit source-ID-to-subject mappings and before/after ownership evidence. The actual Accounts user-copy journal, a full-data restore rehearsal, a returning-user password test, and production cutover reconciliation are **not completed** by this schema proof.

## Email and newsletter findings

Beehiiv contains **270 active newsletter subscribers**. They are a separate consent-bearing list, not 270 login accounts. No subscribers were exported, added, merged, or emailed. Newsletter signup/consent remains separate from password reset and verification.

The Railway app and the offline `Mailjet-email` configuration holder have different Mailjet key pairs. Sender metadata returned HTTP 200 for each: the app pair has no registered sender; the holder pair has an active exact sender. Both Send API checks, using `SandboxMode: true`, returned HTTP 401. The holder response explicitly states that the account is temporarily blocked and requires Mailjet support. No message was delivered by those checks.

The offline holder is not a mail-delivery worker: the app calls Mailjet directly. Starting it or swapping keys would not resolve the confirmed block. The current application's forgot-password route suppresses the failed-send result, explaining why a reset request can appear successful without mail arriving. No production email configuration was changed. See [transactional email decision](TRANSACTIONAL_EMAIL_DECISION.md).

## Remaining acceptance work

1. Configure a usable transactional sender, verify its domain and campaign capacity, and prove delivery to an authorized synthetic test mailbox.
2. Complete an isolated full-data restore and identity-copy reconciliation, including the effective legacy pepper and all runtime-added profile/ownership fields. Rehearse the short credential-write freeze and invalidation of pre-cutover reset codes.
3. Deploy the Aegyo and Daebak adapters only to isolated previews; prove returning-user continuity and the fresh-browser journey across all three products. Daebak dual-session linking is a fallback, not completed single sign-on.
4. Finish new-user provisioning, consent, recovery and failure UX, domain configuration, and cross-app logout/revocation checks before requesting production release approval. Shared-auth acceptance still precedes the contest.

Aggregate reports, schema dump and runtime-binding evidence are in ignored `.auth-proof/` files with private permissions. None of those files or production credentials belongs in Git or a shareable report.
