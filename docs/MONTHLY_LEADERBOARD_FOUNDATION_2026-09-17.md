# Monthly leaderboard foundation

**Date:** September 17, 2026
**Status:** implemented on `codex/monthly-leaderboard-foundation`; material-prize launch remains disabled

## Product decisions represented in code

- A contest round can run for a calendar month.
- Each eligible game's best verified result counts once per local competition week.
- The monthly total is the sum of those weekly game contributions.
- When totals tie, verified top-tier weekly game results rank next, followed by
  the first receipt time at which the final total was reached. Engagement and
  Full Arena bonuses never count as top-tier game results.
- The public rules declare three winners.
- Full Arena uses the number of games frozen into that round. It is never hardcoded to ten.
- The Full Arena bonus can be changed in the round definition without changing application code.
- Version-2 score thresholds and championship point values are frozen in each
  round definition. Changing the approved values requires a new reviewed JSON
  definition, not an application release.
- Version-2 rounds allow two official attempts per eligible game per local competition day, using the round's IANA time zone. Existing version-1 rounds retain their three-attempt UTC behavior.
- Existing guest identity, practice history, verified attempts, receipts, and version-1 standings remain intact.

## Persistence and correction behavior

Migration `0003_monthly_scoring_windows.sql` adds a score-period key to every attempt, backfills existing attempts from their original day key, and copies existing daily best rows into the new period-best table. No existing scoring data is deleted or rewritten.

Each verified attempt can replace the member's best result for that game and week. The ledger receives only the difference. Completing every eligible game with a positive contribution creates one derived Full Arena bonus for that week. If an attempt is disqualified and the member no longer has every game, the bonus is removed and an equal negative ledger entry is recorded.

Round closure snapshots both game contributions and Full Arena bonuses. Existing award creation, member claims, and exact-once fulfillment records already support three prize recipients through the operator dashboard.

## Evidence completed

- Version-1 rule parsing and scoring behavior remain covered.
- New York local-day and Monday week boundaries are covered.
- Public version-2 rules expose cadence, winner count, time zone, weekly scoring, and Full Arena points.
- The championship explains weekly best scoring, the local reset zone, the dynamic game count, the bonus, and the top-three monthly outcome.
- The disposable PostgreSQL proof applies every migration, exercises the pre-0004 upgrade path, and passes all 70 competition database tests.
- The database proof adds and then reverses a Full Arena bonus after a source attempt is voided.

## Deliberately pending product input

The following values are not guessed in code and require the reviewed round
definition or a trusted source integration:

- final Full Arena bonus amount;
- the final Claw values and verified plush-letter evidence (Dai Dai's September
  22 proposal conflicts with Simon's earlier `+10`/`+100` suggestion);
- the trusted Aegyo poll-vote feed, eligible-poll snapshot and member mapping;
- the Slang Memory game and verifiable score source, which are not yet present;
- how an exact tie crossing third place affects prize allocation;
- exact prize-to-rank assignments, eligibility, claim deadline, and fulfillment copy.

These values belong in a frozen version-2 round definition or a reviewed engagement-source policy. A material-prize round cannot open until its public HTTPS rules and approval fields are complete and `ARCADE_MATERIAL_COMPETITION_ENABLED` is enabled.

## Next implementation after the reply

1. Record the approved score tables and Full Arena value in a new version-2
   definition together with their decision references.
2. Freeze the proposed tie order in the published rules once Simon approves it;
   the candidate snapshot calculation and operator view now implement it.
3. Add a trusted poll source after the Aegyo vote/member mapping is proven.
4. Add the Claw scoring adapter after the server records the awarded plush
   letter and links the play to a verified Accounts member.
5. Create the first monthly round as a draft, assign rank-one through rank-three prize keys in the operator dashboard, and run the full staging lifecycle before opening it.
