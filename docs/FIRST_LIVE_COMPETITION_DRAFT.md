# First live competition: decision draft

September 15, 2026. This is a review packet, not approved rules and not an
instruction to open a round. The companion
[`first-live-round.template.jsonc`](../scripts/competition/templates/first-live-round.template.jsonc)
is deliberately not valid operator input: it contains comments and required
placeholders. Resolve every item below, publish the final rules, then create a
new plain JSON definition for review.

## Proposed calendar

- Proposed opening: `2026-09-20T00:00:00.000Z` (Sunday), inclusive.
- Proposed closing: `2026-10-01T00:00:00.000Z` (Thursday), exclusive.
- This creates eleven UTC contribution days: September 20 through September 30. In Colombia (`America/Bogota`, UTC-5), the boundaries display as 7:00 PM
  on September 19 and September 30. A player's quota and daily best still reset
  at `00:00 UTC`, which is 7:00 PM Colombia time for this round.
- Do not shift the stored boundaries to local midnight. Publish the UTC reset
  rule and show each viewer the localized boundary. Opening later than the
  proposed instant requires a newly reviewed schedule; never backdate an open
  round or admit pre-opening guest scores.

The short window is a proposed calibration round ending at the already planned
October boundary. It must not open merely because the date arrives. If the
launch gates are not complete before the proposed opening, choose and review a
new future opening rather than shortening the disclosed window silently.

## Proposed play and scoring policy

The implemented v1 contract fixes the allowance at **three issued official
attempts per member, per eligible game, per UTC day**. Issuance consumes an
attempt. Practice remains separate. One daily contribution per game is the best
verified result, converted through the frozen step table; only the improvement
is added to the ledger. Zero-point results remain receipts but do not enter the
standings.

Proposed eligible games are `snake` and `flappy` (Bias Flap). Proposed challenge
TTL is 900 seconds, capped automatically at round close. Before publication,
product copy must disclose that issuance consumes quota, reload/abandonment
does not grant another attempt, the UTC reset time, and that an on-time pending
receipt may verify after close.

The following is an explicit **calibration candidate for representative-play
testing**, not an approved prize table. Its thresholds use authored progress
milestones and add intermediate steps; they do not claim that code maximum is a
fair population percentile.

| Game      | Candidate score → championship points                                                                                |
| --------- | -------------------------------------------------------------------------------------------------------------------- |
| Snake     | `0→0`, `50→75`, `100→150`, `300→300`, `600→500`, `1000→700`, `1500→875`, `1950→1000`                                 |
| Bias Flap | `0→0`, `30→75`, `60→150`, `140→275`, `220→400`, `360→525`, `520→650`, `760→775`, `1000→875`, `1350→950`, `1700→1000` |

With two games, this candidate permits at most 2,000 points per UTC day and
22,000 points over the proposed eleven-day window. That arithmetic is a bound,
not a prediction of player results. Approval requires a recorded sample of
representative mobile and desktop play for both games, threshold distribution
and completion rates, and a decision that the relative difficulty does not
systematically overweight one game. If that evidence changes any threshold,
create a new definition and review it in full before enrollment.

Ranking is already fixed as total positive points, then the maximum combined
UTC-day total, then the earlier receipt that reached the final total. A tie that
still remains keeps a shared provisional rank. Published rules must state how
an approved award is allocated across a shared rank; an operator cannot invent
a hidden ordering during final review.

## Required decisions before an executable definition exists

- [ ] Business owner approves the exact opening/closing instants and confirms
      named launch and closure coverage.
- [ ] Representative-play calibration evidence supports every threshold for
      both eligible games; the exact table and verifier v1 source freeze are signed
      off together.
- [ ] A public HTTPS rules URL exists and matches the frozen JSON: eligibility,
      geography/age, sponsor, operator, entry method, UTC boundaries, attempt-loss
      behavior, scoring, moderation/disqualification, shared-rank allocation,
      claims, privacy/retention, support and appeals.
- [ ] Prize inventory, number of awards, award keys, values, fallback handling,
      fulfillment owner and claim deadline are approved. No prize values or top-ten
      allocations are supplied by this draft.
- [ ] `approval.sponsor`, `operator`, `eligibility`, `prizes`, `claims`, and the
      private `approvedBy` value name the reviewed sources/owners rather than
      placeholders.
- [ ] Shared auth production acceptance is complete and enrollment requires a
      verified email and unique competition username; guest history preservation
      has been checked on the release build.
- [ ] Production migration/readiness, restricted runtime and operator roles,
      backups, monitoring, support escalation and rollback-by-feature-flag are
      ready. Turning flags off must preserve receipts and the ledger.
- [ ] A positive-score staging rehearsal proves issuance, replay, points,
      replacement by a better same-day attempt, public standings, and per-game high
      scores with real Accounts SSO.
- [ ] A staging lifecycle rehearsal proves close refusal on an unresolved
      on-time receipt, individual settle/reject handling, snapshot retry,
      disqualification before snapshot, shared-rank review, finalization, member
      claim and exact-once fulfillment recording.

## Controlled operator sequence after approval

1. Copy the template to a private working file, resolve every placeholder,
   remove comments, and independently compare its digest and rendered public
   rules with the signed decision record. Keep all competition flags off.
2. Use `create-draft` with the dedicated operator database URL, exact expected
   database name, exact confirmation, named actor and unique idempotency key.
   This stores only a draft. Export/read it back and have a second reviewer
   compare slug, UTC boundaries, games, calibration and approval metadata.
3. Run the positive-score and full lifecycle staging rehearsals above. Record
   deployment, database, round, verifier/source-freeze and sanitized result
   identifiers. Do not reuse the synthetic proof round as the live round.
4. Enable shared auth and the base competition flag only after release gates
   pass. A material round additionally requires
   `ARCADE_MATERIAL_COMPETITION_ENABLED=true`. Run `open` once with an explicit
   round UUID and a new idempotency key; verify public rules before announcing.
5. During the round, monitor rejected/pending receipts and operator coverage.
   Do not grant identity confirmation automatically. The same member retries
   identical evidence after an identity outage; confirmed evidence may be
   replayed with `settle`; unresolved eligibility needs individual audited
   review and `reject-pending`.
6. After the database clock reaches close, run `close`. Resolve every on-time
   pending receipt and all disqualifications before retrying. Once a candidate
   snapshot exists, it is immutable and this implementation has no
   post-snapshot correction/appeal path.
7. Export the private mode-0600 review file. Review exact ties and insert only
   approved award allocations and rationales. Run `finalize`; members claim
   their own awards, and the operator records fulfillment exactly once. The
   software does not transfer prizes or send winner messages.

## Current evidence and remaining gaps

Local Node 24 and disposable PostgreSQL evidence already covers positive Snake
replay, quotas and idempotency, daily-best replacement/correction, positive-only
standings, closure with pending receipts, immutable snapshots, exact ties,
claims and fulfillment rollback. The recorded full-suite result remains **63
files / 499 tests** from September 12; this planning pass did not rerun it.

The recorded staging browser report used real Accounts OIDC and an existing
synthetic member. Its Flappy receipt was verified at score 0/points 0, and its
public standings were correctly empty. It therefore does not establish a
positive deployed score, deployed daily-best replacement, or deployed
close/review/finalize/claim/fulfillment behavior. Those are the meaningful
competition workflow gaps. The operator flow is manual: there is no scheduler,
pending worker or post-snapshot correction mechanism. Business/legal rules,
actual awards, staffing, representative calibration, production auth/DNS
acceptance and production release evidence also remain launch blockers.
Although the claim/fulfillment state transitions are implemented, claim
deadlines, forfeiture, fallback allocation and appeals are not. The proposed
14-day window therefore needs both a business decision and a reviewed
enforcement workflow before any unclaimed award can be voided or reassigned.
