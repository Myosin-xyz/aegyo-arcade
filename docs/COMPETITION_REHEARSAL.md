# Three-game competition rehearsal

This drill proves the monthly competition lifecycle with Snake, Bias Flap and
Perfect Toss without opening a prize promotion. It uses `mode: "synthetic"`,
creates no award claims and does not require the material-competition flag.
The values are acceptance-test data, not proposed public scoring thresholds.

Production stays disabled during this drill. Run it only in the disposable
PostgreSQL proof or an isolated staging environment. Keep
`ARCADE_MATERIAL_COMPETITION_ENABLED` unset or `false` everywhere. Do not use
real users, announce results or fulfill anything from a synthetic round.

## Automated proof

Run:

```sh
ARCADE_COMPETITION_PROOF_CONFIRM=disposable-local-postgres \
  node scripts/competition/prove-core.mjs
```

The proof builds a clean database from every migration, including the additive
Perfect Toss constraint migration. The monthly rehearsal test then checks:

- exactly two official attempts per member, game and local day;
- a fixed `0/5/10/20` step table for every eligible game;
- one best result per game per Monday-based local week;
- a Full Arena bonus only after all three games have a positive weekly best;
- monthly totals made from multiple weekly contributions;
- immutable closure snapshot and source digest;
- finalization with `awards: []`, leaving no claim or fulfillment records.

## Optional staging operator drill

The template at
`scripts/competition/templates/three-game-synthetic-rehearsal.template.jsonc`
is intentionally invalid operator input because it contains comments and
required placeholders. Copy it to a private file outside the repository,
replace the slug and both dates, remove comments, and validate it before use.
The dates must be future staging dates and the close must follow the open.

Use a restricted staging database credential and spell the database name twice
for every operator command. `create-draft` is harmless while feature flags are
off. Opening the synthetic round requires shared auth and the base competition
flag in staging; it never requires the material flag.

Exercise enrollment and official runs for all three games with synthetic
members. During one scoring week, submit a lower and then a higher verified
result for one game and confirm only the improvement changes the ledger. Finish
all three games and confirm the Full Arena bonus appears once. If a receipt is
pending at close, settle or individually reject it before retrying closure.

After the staging database clock passes the configured close:

1. Run `close` and record the sanitized snapshot ID, digest and standing count.
2. Run `export-review` to a new mode-0600 file and inspect every exact tie.
3. Set `awards` to an empty array. Resolve exact ties only with the published
   shared-rank rehearsal decision.
4. Run `finalize` and confirm the round is final and the award-claim count is
   zero.
5. Repeat `close` and `finalize` with the same idempotency keys and confirm both
   report `repeated: true` without changing their immutable records.

Delete the private review export after evidence has been reduced to IDs,
digests and aggregate counts. Disable the staging base competition flag when
the drill finishes. The synthetic round is never reused as a live round.
