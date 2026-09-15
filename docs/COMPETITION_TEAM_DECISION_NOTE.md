# First competition: proposed defaults for team decision

**Decision meeting:** September 15, 2026

**Status:** proposed defaults only; material competition remains disabled

Approve, amend, or reject each row. Approval of this note alone does not open a
round. The final decisions must also appear in the public rules and frozen round
definition.

| Topic          | Proposed default                                                                                                                                            | Decision needed today                                                                    |
| -------------- | ----------------------------------------------------------------------------------------------------------------------------------------------------------- | ---------------------------------------------------------------------------------------- |
| Window         | Open `2026-09-20T00:00:00Z`; close `2026-10-01T00:00:00Z` (exclusive). Eleven UTC scoring days.                                                             | Approve exact instants and named launch/closure coverage.                                |
| Games          | Snake and Bias Flap (`snake`, `flappy`) only.                                                                                                               | Confirm both games and verifier v1 source freeze.                                        |
| Daily cap      | Three issued official attempts per member/game/UTC day. Issuance consumes quota; practice is separate.                                                      | Approve player-facing forfeiture/outage wording.                                         |
| Challenge time | 900 seconds, shortened automatically at round close.                                                                                                        | Approve after mobile play rehearsal.                                                     |
| Daily points   | Best verified attempt per game/day; fixed step tables below; zero points do not place. Maximum 2,000/day.                                                   | Approve only after representative-play calibration.                                      |
| Ranking        | Total positive points; then highest combined UTC-day total; then earlier receipt reaching final total. Remaining exact ties share rank.                     | Approve published shared-rank award treatment.                                           |
| Claims         | Proposed 14 calendar days from publication. Logged-in winner accepts instructions; operator records fulfillment once. No automatic payment or winner email. | Approve deadline, instructions, support/appeal owner, forfeiture and fallback treatment. |
| Awards         | No default. Do not infer ten awards from a top-ten display.                                                                                                 | Supply approved inventory, value, award keys, allocation and fulfillment owner.          |
| Eligibility    | No default.                                                                                                                                                 | Supply approved geography, age, exclusions, identity checks and official rules URL.      |

Proposed calibration candidate:

- Snake: `0→0`, `50→75`, `100→150`, `300→300`, `600→500`,
  `1000→700`, `1500→875`, `1950→1000`.
- Bias Flap: `0→0`, `30→75`, `60→150`, `140→275`, `220→400`,
  `360→525`, `520→650`, `760→775`, `1000→875`, `1350→950`,
  `1700→1000`.

These tables are calibration hypotheses based on authored progress milestones.
They require representative mobile and desktop results before approval. Do not
replace that evidence with perfect-run maxima.

The 14-day claim window is also a policy proposal. The current claim state
machine does not store or enforce a deadline, forfeiture, fallback winner, or
appeal window. Until that bounded workflow is implemented and tested, an
operator must not void or reallocate an unclaimed award.

Keep `ARCADE_MATERIAL_COMPETITION_ENABLED` unset or anything other than exact
`true`. Do not create/open the material round, announce prizes, enroll players,
or publish this note as official rules. The detailed checklist and deliberately
non-executable definition are in
[`FIRST_LIVE_COMPETITION_DRAFT.md`](FIRST_LIVE_COMPETITION_DRAFT.md) and
[`first-live-round.template.jsonc`](../scripts/competition/templates/first-live-round.template.jsonc).

## Record after the meeting

- Decision owner and timestamp: **REQUIRED**
- Schedule: **REQUIRED**
- Games and calibration: **REQUIRED**
- Eligibility/rules URL: **REQUIRED**
- Awards and shared-rank allocation: **REQUIRED**
- Claim/appeal/fulfillment policy: **REQUIRED**
- Named launch and closure operators: **REQUIRED**
