# September community leaderboard release

Simon approved Dai Dai's monthly scoring, Claw, poll, Slang Memory, and tie
rules on September 22. Mateo chose a public **no-prize** first round on
September 23 with the three games that already have deterministic server replay:
Snake Freebies, Bias Flap, and Perfect Toss. It is a real public leaderboard,
not a synthetic test round. No prize entry or award claims exist in this round,
and its scores do not transfer to a future prize contest. Do not describe its
rankings as prize winners.

The first round opens September 23 at 15:00 UTC (11:00 a.m. New York) and closes
October 1 at 04:00 UTC (midnight New York). The private operator definition is
`.auth-proof/community-september-2026.json`; validate it before creating the
draft. It freezes two issued official attempts per member, game, and New York
calendar day. Only each game's best verified result per New York week counts.
The month sums those weekly game contributions. Full Arena adds 20 points when
all three eligible games have a positive verified tier in the same week. Ties
rank by total points, count of top-tier game results, then earliest receipt
reaching the final total; exact ties share rank.

| Game           | Rookie: 5 points | Fan: 10 points | Legend: 20 points |
| -------------- | ---------------: | -------------: | ----------------: |
| Snake Freebies |         score 50 |      score 100 |         score 300 |
| Bias Flap      |          score 1 |        score 5 |          score 10 |
| Perfect Toss   |          score 1 |        score 8 |          score 15 |

Scores below the Rookie threshold earn zero. The thresholds above are the
initial **no-prize** calibration and are frozen for this round. They are not
approval for a later material-prize score table. Claw, article polls, and
Slang Memory remain outside this round because their trusted member-linked
score sources are not implemented; adding them later cannot retroactively
change this round's rules or Full Arena requirement.

Release order: merge the reviewed branch after CI; verify the production build;
run the read-only production database preflight; confirm shared sign-in,
verified-email handling, and guest-history preservation; set only
`ARCADE_COMPETITION_ENABLED=true` (keep
`ARCADE_MATERIAL_COMPETITION_ENABLED=false`); deploy that configuration; create
and open the frozen community round with the guarded operator CLI; then check
the public page and one real member's enrollment/verified score on mobile and
desktop. A rollback turns the base competition flag off while keeping round,
attempt, and ledger records intact. Do not delete those records on rollback.

Before a prize round, publish its complete rules, prize allocation, eligibility,
claims, and exact-tie treatment; finish and verify every additional score
source; rehearse closure and fulfillment; and enable the separate material
flag only after its gates pass. The public community board is not a promise
that this month's scores will become prize entries.
