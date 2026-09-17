# Dai Dai weekly leaderboard rules: implementation decision

**Reviewed:** September 16, 2026  
**Source:** the `aegyo_arena_leaderboard` handoff supplied by Mateo  
**Status:** product rules accepted as the working proposal; prize competition
remains disabled until the decisions and launch gates below are complete

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
- Ranking order is total points, number of Legend tiers, then the receipt time
  at which the final total was reached. Receipt time, rather than asynchronous
  verification completion time, is used. A remaining exact tie keeps a shared
  rank and requires the published award-allocation rule.
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

The repository also contains Hangman and This or That. They are not part of
this ten-game proposal.

The September launch can safely award material points for Snake Freebies and
Bias Flap today. The other eight games become eligible only after their server
verifier reproduces a recorded run and rejects altered evidence. Client-supplied
`level`, `height`, `completed` or flag fields are display hints, never prize
evidence.

Full Arena always means all games listed in the frozen round definition. If the
first round launches with two verified games, its maximum is 60 points:
`2 games × 20 + 20 bonus`. Public copy must say two games. The 220-point maximum
becomes true only when all ten games are verified and active.

## Weekly engagement and the monthly prize

The original request names a cumulative monthly winner, while this handoff
defines weekly resets. The clean combined model is:

1. players see a fresh weekly leaderboard every Monday;
2. a monthly campaign explicitly lists the weekly round IDs that count; and
3. the monthly championship total is the sum of those frozen weekly totals.

Explicit round membership avoids ambiguous partial weeks at month boundaries.
If the team wants a weekly prize instead, that replaces this model and must be
stated in the public rules before launch.

## Identity and existing users

- Entry is for a signed-in Accounts member with a verified email and unique
  public username. Newsletter subscription is independent and is not an
  eligibility test.
- A guest keeps the existing local device identity and all prior Arcade history
  when signing in. Historical guest scores remain visible under the existing
  cosmetic leaderboard rules but do not enter a prize round retroactively.
- Emails, device IDs, internal member IDs and wallet identifiers are never
  exposed on the public board.

## Required implementation changes

1. Add tier rules, weekly New York boundaries, two-attempt allowance, weekly
   best-per-game contributions, Legend count and Full Arena bonus to the current
   versioned round contract.
2. Preserve the current issue, trace, replay, receipt and immutable-ledger path;
   derive each tier only from the replay result.
3. Update the championship UI with tier feedback, attempts remaining, weekly
   game progress, Full Arena progress and localized reset time.
4. Extend the verifier one game at a time. Every added game needs deterministic
   reproduction tests, tamper tests and a frozen source manifest.
5. Add an explicit monthly campaign aggregate only if the team confirms the
   weekly-plus-monthly model.
6. Keep material competition behind `ARCADE_MATERIAL_COMPETITION_ENABLED` until
   public rules, prizes, eligibility, claim handling and production rehearsals
   are approved.

## Decisions still needed from Simon and Dai Dai

1. Does the prize go to the monthly cumulative winner, weekly winners, or both?
   If monthly, approve the explicit sum-of-weekly-rounds model.
2. Is the prize for first place only or the top three, and how is an exact shared
   rank allocated?
3. Confirm the prize, approximate retail value, eligible geography/age, claim
   deadline and fulfillment owner.
4. For the first public round, approve the two currently verified games or move
   the date to allow all ten game verifiers to be completed and rehearsed.

## Launch acceptance

- Production Accounts sign-in, signup and password reset pass on the final DNS
  hostname, and an existing Aegyo user retains the same local identity.
- A guest with Arcade history signs in and keeps that history.
- Both eligible games prove a positive recorded run, a rejected modified trace,
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
