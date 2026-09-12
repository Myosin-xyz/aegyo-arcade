# Competition implementation handoff

Status: implemented and tested locally; disabled by default. These competition changes have not been deployed remotely or opened to production users. Real three-product SSO acceptance remains separate. The implementation stays behind exact-string feature flags and the auth-first release gates in `AUTH_AND_LEADERBOARD_DELIVERY_PLAN.md`.

The delivered surfaces are `/account` (username and member session), `/championship` (enrollment, monthly standings, configured games, high scores, and award claims), official Snake/Flappy controls, and the operator CLI below. Homepage links appear only under their corresponding feature flags. Both pages evaluate flags at request time rather than freezing their state during a build.

The default championship selects the currently playable round, then the nearest scheduled round, then the latest past round. Opening next month's schedule cannot hide this month's active contest. Recent-round links and `/championship?round=SLUG` keep past results and claims accessible. Enrollment and official controls follow server-clock-adjusted opening/closure boundaries while the page stays open; final award claims remain available after play closes.

## Runtime boundaries

- `ARCADE_COMPETITION_ENABLED=true` enables competition routes and operations. Missing, `false`, or any other value keeps them unavailable.
- A `material_prize` round additionally requires `ARCADE_MATERIAL_COMPETITION_ENABLED=true`. Its frozen rules must contain an HTTPS rules URL and non-empty sponsor, operator, eligibility, prizes, claims, and approval fields. No prize defaults are supplied.
- Issuance requires `ARCADE_COMPETITION_SEED_SECRET` with at least 32 characters.
- Shared member authentication, verified email, username selection, and enrollment precede official play. Anonymous device play, history, streaks, and the existing cosmetic leaderboard remain separate and are not migrated into competition results.
- Rules version 1 permits three attempts per member/game/UTC day and supports the frozen eligible-game calibration in the round. The trace verifier accepts version 1 Snake and Flappy traces at 60 ticks/second and recomputes scores from the seed and ordered inputs.

Do not open competition enrollment before the shared-auth gate passes across Aegyo, Arcade, and Daebak. A local synthetic identity stub proves the Arcade integration shape; it is not evidence of real OIDC, returning-user, wallet, recovery, email, or cross-origin continuity.

## Member and score flow

An authenticated member accepts the exact rules digest and enrolls. Issuance reserves one of three daily attempts under the member identity and provider session. The server supplies the common per-game/day challenge seed. Submission stores the first evidence hash and immutable receipt before verification; a changed retry is rejected.

If the identity provider is unavailable at submission, the receipt remains `pending` with `security_confirmed=false`. There is no background identity retry worker. After identity service recovery, the same signed-in member must retry the same `PUT /api/competition/attempts/{attemptId}` with the identical trace. That confirms identity state and permits verification. The operator `settle` command only replays evidence already marked `security_confirmed=true`; it never grants identity confirmation. A still-unresolved receipt requires individual human review and the audited `reject-pending` command below. There is no blanket rejection command.

Verification replays the trace, enforces size/event/time bounds, and converts the recomputed score through the round's fixed calibration table. The serialized daily-best update writes only the point difference to the immutable ledger. Public cumulative standings include positive totals only. Their tie order is total points, maximum combined points on one UTC day, then the earlier receipt that reached the final total. A remaining exact tie retains a shared rank and requires explicit review; member identity is never a hidden tie-breaker. Public per-game high scores are display-only and do not alter prize rank.

The [replay source freeze](DECISIONS/0008-replay-source-freeze.md) pins the complete local dependency closure of verifier v1 with source hashes and a guard test. Do not refresh those hashes to make a changed game pass: preserve the old verifier and introduce a new trace version. The database freezes rules, dates, slug, evidence, ledger, candidate snapshot, final result, and operation audit at the relevant lifecycle stages, but does not pin a verifier build hash itself. Run the guard before every release; the deployment process must enforce this policy through final review and claims.

Replay establishes that an input sequence produces its reported result. It does not establish that a human played without automation. Keep published eligibility and finalist review in the prize process. Public rules use an explicit field allowlist: the approver identity and extra internal metadata are not published.

## Migration and release order

Apply the reviewed additive `src/db/migrations/0002_arcade_competition.sql` through the existing Drizzle migration process after `0000` and `0001`, before deploying code that reads the new profile/session fields. It creates competition tables and integrity triggers and adds `account_sessions.email_verified` with default `false`. It neither reassigns devices nor rewrites guest runs, old leaderboard rows, streaks, claw plays, or historical prizes. Existing member sessions need a fresh provider login before they carry a verified-email claim.

Rehearse against the isolated Arcade staging database and grant the runtime role only the table permissions required by the app. Keep ordinary runtime credentials separate from migration/operation credentials. Complete shared-auth, existing-user preservation, email, DNS, rules, and operational launch gates before opening a real round. Roll back visibility by turning off the flags; preserve the additive tables, receipts, and ledger. Do not reverse the migration by deleting evidence.

## Closure and awards

Closure takes a round-wide transaction lock and uses the database clock. It changes an elapsed `open` round to `closing`, then refuses to create a candidate snapshot while any receipt received strictly before `closes_at` remains pending. Receipts at or after the cutoff are late. Operators must settle the on-time pending set before retrying closure.

The successful retry freezes positive-point standings, per-member/game verified high scores, and a canonical source digest, then moves the round to `review`. Disqualification is allowed only while the round is `open` or `closing`; it voids the attempt, records the reason and actor, and recomputes the daily best plus ledger correction. There is deliberately no post-snapshot correction workflow yet.

Finalization requires an explicit operator review file. Every exact tie must name the complete tied member set, retain `shared_rank`, and provide the published rationale. Awards are an explicit list with an award key and allocation rationale; the code never manufactures a top-ten prize list. Finalization freezes the reviewed standings, creates unclaimed award records, and moves the round to `final`.

The authenticated claim endpoint is:

```text
POST /api/competition/awards/{awardId}/claim
Content-Type: application/json

{"acceptedInstructions":true,"idempotencyKey":"claim-request-0001"}
```

The body accepts only those two fields. Ownership is checked against the authenticated member, the acceptance proof is private, and member reads expose only `{id, awardKey, status, rank}`. An exact retry remains idempotent even after fulfillment. Fulfillment only records an operator-supplied key and reason exactly once; this code does not send email, transfer money, ship goods, or call a prize provider.

## Operator commands

The operator CLI never reads ordinary `DATABASE_URL` and never accepts a database URL on the command line. Put the credential in the dedicated environment variable so it is not exposed in the process argument list. Every command connects, reads `current_database()`, and refuses to proceed unless both database-name arguments match it exactly.

```sh
export COMPETITION_OPERATOR_DATABASE_URL='postgresql://...'
export ARCADE_COMPETITION_ENABLED=true
export ARCADE_SHARED_AUTH_ENABLED=true
# Required as well for an approved material_prize round:
# export ARCADE_MATERIAL_COMPETITION_ENABLED=true

./scripts/competition/operator.ts create-draft \
  --definition-file /absolute/path/to/round.json \
  --actor OPERATOR_ID \
  --idempotency-key create-2026-10-v1 \
  --expected-database EXACT_DATABASE_NAME \
  --confirm-database EXACT_DATABASE_NAME

./scripts/competition/operator.ts open \
  --round-id ROUND_UUID \
  --actor OPERATOR_ID \
  --idempotency-key open-2026-10-v1 \
  --expected-database EXACT_DATABASE_NAME \
  --confirm-database EXACT_DATABASE_NAME

./scripts/competition/operator.ts close \
  --round-id ROUND_UUID \
  --actor OPERATOR_ID \
  --idempotency-key close-2026-09-v1 \
  --expected-database EXACT_DATABASE_NAME \
  --confirm-database EXACT_DATABASE_NAME

./scripts/competition/operator.ts export-review \
  --round-id ROUND_UUID \
  --output /absolute/private/path/review.json \
  --expected-database EXACT_DATABASE_NAME \
  --confirm-database EXACT_DATABASE_NAME

./scripts/competition/operator.ts settle \
  --attempt-id ATTEMPT_UUID \
  --expected-database EXACT_DATABASE_NAME \
  --confirm-database EXACT_DATABASE_NAME

./scripts/competition/operator.ts reject-pending \
  --round-id ROUND_UUID \
  --attempt-id ATTEMPT_UUID \
  --reason REVIEWED_REJECTION_CODE \
  --actor OPERATOR_ID \
  --idempotency-key reject-ATTEMPT_UUID-v1 \
  --expected-database EXACT_DATABASE_NAME \
  --confirm-database EXACT_DATABASE_NAME

./scripts/competition/operator.ts disqualify \
  --round-id ROUND_UUID \
  --attempt-id ATTEMPT_UUID \
  --reason PUBLISHED_REASON_CODE \
  --actor OPERATOR_ID \
  --idempotency-key dq-ATTEMPT_UUID \
  --expected-database EXACT_DATABASE_NAME \
  --confirm-database EXACT_DATABASE_NAME

./scripts/competition/operator.ts finalize \
  --round-id ROUND_UUID \
  --review-file /absolute/path/to/review.json \
  --actor OPERATOR_ID \
  --idempotency-key final-2026-09-v1 \
  --expected-database EXACT_DATABASE_NAME \
  --confirm-database EXACT_DATABASE_NAME

./scripts/competition/operator.ts fulfill \
  --award-id AWARD_UUID \
  --fulfillment-key PROVIDER_OR_MANUAL_RECORD_KEY \
  --reason FULFILLMENT_REASON \
  --actor OPERATOR_ID \
  --idempotency-key fulfill-AWARD_UUID-v1 \
  --expected-database EXACT_DATABASE_NAME \
  --confirm-database EXACT_DATABASE_NAME
```

The finalization file has this shape:

```json
{
  "tieDecisions": [
    {
      "exactTieKey": "POINTS:MAX_DAILY:REACHED_AT",
      "resolution": "shared_rank",
      "memberIds": ["MEMBER_UUID_A", "MEMBER_UUID_B"],
      "rationale": "Published shared-placement rule reference"
    }
  ],
  "awards": [
    {
      "memberId": "MEMBER_UUID_A",
      "awardKey": "APPROVED_AWARD_KEY",
      "allocationRationale": "Published allocation rule reference"
    }
  ]
}
```

The round definition file contains only explicit values; there are no seeded calendar, game, calibration, or prize defaults:

```json
{
  "slug": "reviewed-round-slug",
  "opensAt": "2026-10-01T00:00:00.000Z",
  "closesAt": "2026-11-01T00:00:00.000Z",
  "rules": {
    "version": 1,
    "mode": "synthetic",
    "dailyAttempts": 3,
    "attemptTtlSeconds": 900,
    "games": [
      {
        "gameId": "snake",
        "calibration": [
          { "score": 0, "points": 0 },
          { "score": 100, "points": 1000 }
        ]
      }
    ]
  }
}
```

`create-draft` validates rules and requires a future UTC opening but may prepare a draft while runtime feature flags remain off. A material draft still needs the complete approval metadata enforced by `parseRules`. `open` requires shared auth and competition flags, plus the material flag for a material round; it rejects retroactive or overlapping active schedules. Opening freezes the slug, rules, and UTC boundaries. The review export is read-only, creates a new mode-0600 file exclusively, and refuses to overwrite a path. It includes candidate member IDs and pending attempt IDs needed for review, plus status, security-confirmation state, and a receipt digest; it contains no raw traces or contact data.

Use a fresh idempotency key for a changed operation. Reusing the exact key and payload returns the persisted outcome where supported; conflicting retries fail and their transaction rolls back. CLI output excludes the database URL and private claim proof.

## Local proofs

The database proof creates and removes an isolated PostgreSQL container and refuses inherited `DATABASE_URL` or `TEST_DATABASE_URL` values:

```sh
ARCADE_COMPETITION_PROOF_CONFIRM=disposable-local-postgres \
  node scripts/competition/prove-core.mjs
```

Add `--all` to the database proof for the complete root Vitest suite against the disposable database. The harness runs Vitest under its own Node binary rather than whichever `npx` happens to resolve. Use Node 24.21.0, the Accounts runtime already proved in this workspace; Node 26 exposes unrelated `localStorage` failures in existing UI tests. The local binary, when present, is `services/accounts/.proof/runtime/node-v24.21.0-darwin-arm64/bin/node`.

`node scripts/competition/browser-proof.mjs` requires local `initdb`, `postgres`, `createdb`, `psql`, and the installed Playwright Chromium browser. It creates a disposable local PostgreSQL cluster, a loopback identity-state stub, and a local HTTPS Next.js session for desktop/mobile journey evidence. It waits for the homepage's actual guest bootstrap before measuring identity preservation; a second synthetic bootstrap would create an artificial first-visit race. It is explicitly synthetic and is not a real shared-SSO proof. Unit and database suites also cover trace replay, quotas, receipt idempotency, UTC boundaries, daily-best corrections, closure retries, exact ties, immutable final reads, claim ownership, and fulfillment rollback.

Npm aliases are `test:competition:db`, `test:competition:browser`, and `competition:operator`. The operator uses the explicitly pinned `tsx` development dependency. Private local evidence remains in the ignored `.auth-proof/` directory and must not be added to a deployment source archive.

### Recorded validation — 2026-09-12

- Complete root suite under Node 24.21.0: **63 files / 499 tests passed**, including all four PostgreSQL integration suites against migrations `0000`–`0002`.
- Database race evidence: 25 simultaneous issuance requests consume exactly three attempts; 25 retries with one key consume one. Concurrent overlapping round openings admit exactly one round.
- Desktop/mobile browser proof: username, enrollment, official Snake replay, quota decrement, homepage entry points, and exact guest-cookie preservation through play and member logout. The identity-state service in this proof is a local synthetic stub.
- Source changes passed ESLint and TypeScript. The production Next.js build passed with the new flags disabled; `/account` and `/championship` remain request-rendered.

Evidence files: `.auth-proof/competition-final-regression.log`, `.auth-proof/competition-browser-final.log`, `.auth-proof/competition-build-final.log`, and `.auth-proof/competition-ui/report.json` plus the desktop/mobile screenshots. These are local proof records, not a Railway deployment report or evidence of real-user migration.

## Remaining operational gaps

Round creation/opening and private candidate export now have guarded commands, but there is no automated scheduler or background verifier queue. Operators must run closure, inspect the private review export, settle each eligible confirmed receipt, explicitly reject only reviewed unresolved receipts, rerun closure, complete tie rationales and award allocations, then finalize. There is also no implemented post-snapshot correction/appeal workflow, so all disqualifications and corrections must finish before the candidate snapshot.

Real SSO acceptance, migration reconciliation, material prize/legal approval, named operational coverage, production-domain testing, and remote deployment remain outstanding release gates.
