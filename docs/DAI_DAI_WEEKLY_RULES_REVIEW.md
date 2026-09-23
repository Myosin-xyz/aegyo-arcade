# Dai Dai weekly leaderboard rules: implementation decision

**Reviewed:** September 23, 2026
**Sources:** the `aegyo_arena_leaderboard` handoff supplied by Mateo; Dai Dai's
September 22 reply; Simon's September 22, 21:57 approval (“Good to go! Great
idea!”).
**Status:** the product rules below are approved. This records the decision; it
does not mean each scoring source is implemented or eligible for prizes. The
current implementation record is
[`MONTHLY_LEADERBOARD_FOUNDATION_2026-09-17.md`](./MONTHLY_LEADERBOARD_FOUNDATION_2026-09-17.md).
Prize competition remains disabled pending the launch, legal, prize, and source
verification gates below.
Mateo approved a September 23 public **no-prize** leaderboard with only Snake,
Bias Flap, and Perfect Toss while those gates are completed. Its scores do not
transfer into a later prize contest.

The handoff is product input, not an installation package for this repository.
Its Supabase SQL and browser client target a different architecture and must not
be run or copied into production. Arcade already has PostgreSQL persistence,
Accounts OIDC identity, guest-history linking, issued competition attempts and
deterministic server replay. The tier model will be implemented on that existing
foundation.

## Working rules

- A verified run earns one tier: **Rookie = 5**, **Fan = 10** or
  **Legend = 20** points.
- Only the best verified tier for each eligible game in a weekly round counts.
- A player who scores in every active eligible game earns a **20-point Full
  Arena bonus**.
- Each member receives **two issued official attempts per eligible game per
  local competition day**. Issuing the attempt consumes the allowance; practice
  play stays unlimited and separate.
- The weekly round resets Monday at 00:00 in `America/New_York`. The service
  computes those boundaries with the IANA time zone and stores exact UTC
  instants, including across daylight-saving changes.
- Approved monthly ranking order is total points, most top-tier game results,
  then whoever reached that total first. The implementation uses receipt time,
  rather than asynchronous verification completion time, as the recorded time.
  A remaining exact tie keeps a shared rank; how that tie affects prize
  allocation still needs to be published.
- Instant quits and verified zero results earn no tier.
- Thresholds are frozen for the whole weekly round. Calibration changes create
  a new rules version and take effect only in a later round.

## Game mapping and launch status

| Proposed game        | Arcade ID         | Proposed tier signal  | Prize-verification status          |
| -------------------- | ----------------- | --------------------- | ---------------------------------- |
| Freebie Frenzy       | `freebie`         | level/completion      | replay verifier required           |
| Cross to the Concert | `frogger`         | level/completion      | replay verifier required           |
| Claw Machine         | `claw`            | grab/win/first try    | authoritative event trace required |
| Fanchant Hero        | `fanchant-hero`   | phase/completion      | authoritative event trace required |
| Comeback Climb       | `jumper`          | level/completion      | replay verifier required           |
| Photocard Stack      | `photocard-stack` | verified stack height | replay verifier required           |
| Bias Match           | `bias-match`      | level/completion      | replay verifier required           |
| Aegyo Pop            | `aegyo-pop`       | level/completion      | replay verifier required           |
| Snake Freebies       | `snake`           | level/completion      | **verified replay exists**         |
| Bias Flap            | `flappy`          | level/completion      | **verified replay exists**         |
| Perfect Toss         | `perfect-toss`    | verified catches      | **verified replay exists**         |

The repository also contains Hangman and This or That. Hangman's replay verifier
is available for synthetic rehearsals, but material rounds reject it because the
answer and deterministic seed are visible in browser code. It needs an approved
participation-point/abuse policy or a different challenge design before it can
award prize points. This or That remains outside the material proposal.

The September launch can safely award material points for Snake Freebies, Bias
Flap and Perfect Toss. The other proposed games become eligible only after their server
verifier reproduces a recorded run and rejects altered evidence. Client-supplied
`level`, `height`, `completed` or flag fields are display hints, never prize
evidence.

Full Arena always means all games listed in the frozen round definition. If the
first round launches with three verified games, its weekly maximum is 80 points:
`3 games × 20 + 20 bonus`. Public copy must say three games. Any larger maximum
becomes true only when the additional games are verified and frozen into the round.

## Approved weekly scoring and monthly prize rules

The approved product model uses weekly scoring windows and a monthly
championship:

1. For each game, each player's best score for the week converts to points once
   for that week.
2. The monthly leaderboard adds each player's weekly totals across the month.
3. The approved tie order is total points, most top-tier results, then earliest
   time reaching the final total.

The monthly round's exact opening and closing instants resolve partial weeks at
month boundaries. Public copy must state those instants and the New York daily
and weekly boundaries before launch. The monthly aggregation and general tier
foundation are described as implemented in the linked implementation record;
the approved Claw, poll, and Slang Memory scoring below are not implemented as
prize sources.

Dai Dai proposed the following values on September 22; Simon approved the reply
at 21:57:

- Claw Machine: target about one win in five tries; count at most one win per
  member per week. Award 20 points for A or E, 30 for D, B, or K, and 50 for
  `!`. These rules are approved, but the current Claw server records only
  `win`, `miss`, or `drop` against a guest device. It does not prove the plush
  letter or attach the win to an Accounts member, so Claw cannot yet award
  prize points. The current aimable plush set is `D/A/E/B/K/A2`; there is no
  `!` plush in the game manifest or aim grid yet.
- Article polls: award 10 points per vote, limited to polls on the last five
  articles on the homepage, for a maximum of 50 points per member per week.
  Aegyo currently stores poll votes in its own database. A trusted member
  mapping and a frozen eligible-article/poll list are required before votes
  can enter the Arcade ledger; browser-submitted claims cannot be accepted.
- Slang Memory: the best weekly score converts using the same tier system as
  the other games, once per week. The game and prize-verifiable score source
  are not in either current Arcade or upstream Aegyo code, so it cannot yet
  award prize points.

The approved tie order is implemented for current verified-game standings.
Only a weekly game best at that game's highest frozen tier counts as a top-tier
result; Full Arena and engagement points do not increase that count. An exact
tie after all three rules retains a shared rank, while its prize allocation
still needs a published rule.

## Identity and existing users

- Entry is for a signed-in Accounts member with a verified email and unique
  public username. Newsletter subscription is independent and is not an
  eligibility test.
- A guest keeps the existing local device identity and all prior Arcade history
  when signing in. Historical guest scores remain visible under the existing
  cosmetic leaderboard rules but do not enter a prize round retroactively.
- Emails, device IDs, internal member IDs and wallet identifiers are never
  exposed on the public board.

## Implemented foundation and remaining work

1. Tier rules, New York boundaries, two-attempt allowance, weekly best-per-game
   contributions and the dynamic Full Arena bonus are implemented in version 2.
2. The issue, trace, replay, receipt and immutable-ledger path remains intact;
   every game tier derives from a versioned server replay result.
3. The championship UI shows attempts, weekly scoring, Full Arena progress and
   the localized reset zone.
4. Continue extending the verifier one game at a time. Every added game needs deterministic
   reproduction tests, tamper tests and a frozen source manifest.
5. The monthly total aggregates weekly game contributions. The newly approved
   Claw, poll, and Slang Memory sources still need implementation and trusted
   verification before they can contribute prize points.
6. Keep material competition behind `ARCADE_MATERIAL_COMPETITION_ENABLED` until
   public rules, prizes, eligibility, claim handling and production rehearsals
   are approved.

## Remaining launch, legal, and source-verification gates

1. Publish how an exact shared rank that reaches or crosses third place
   allocates prizes.
2. Set the prize assigned to each rank, approximate retail value, eligible
   geography and age, claim deadline, and fulfillment owner.
3. Before a material-prize round, approve the eligible game set and frozen
   calibration with the published rules. The initial no-prize leaderboard uses
   only the three currently verified games.
4. Implement and rehearse trusted Claw-letter/member attribution, poll
   article/vote/member sourcing, and the Slang Memory game and score verifier
   before those sources award prize points. Alternatively, launch with only
   the verified sources.

## Launch acceptance

- Production Accounts sign-in, signup and password reset pass on the final DNS
  hostname, and an existing Aegyo user retains the same local identity.
- A guest with Arcade history signs in and keeps that history.
- Every eligible game proves a positive recorded run, a rejected modified trace,
  the two-attempt limit and best-tier replacement on mobile and desktop.
- Monday New York boundaries and daily allowance boundaries pass tests on both
  sides of a daylight-saving transition.
- Full Arena is awarded once, only after every game in the frozen round has a
  positive tier.
- Standings use public usernames only and retain shared rank for an exact tie.
- Closing, snapshot, award allocation, claim and exact-once fulfillment pass in
  staging with the final rules version.
- The public rules and the stored round definition match before the material
  competition flag is enabled.
