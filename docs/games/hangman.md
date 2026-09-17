# Game Rules Seed — Guess the Slang

**Status**: IMPLEMENTED (M2, 2026-07-18); competition replay v3 added 2026-09-17 — launch dictionary v1 (7 reviewed single-word terms); multi-word candidates parked pending fan-fluent review; daily term via server seed `daily:hangman:v1:<dayKey>`
**Source**: Nicole's playable mock and v0.1 keep/change review
**Surface**: `dom`
**Reference box**: responsive portal content area

## Product baseline

- Framing: guess a K-pop fan term from a translated hint.
- Six incorrect guesses are allowed.
- Practice selects from the reviewed dictionary locally.
- A counted run uses the server-selected daily term for the current `day_key` and content version; the surface is cosmetic and the answer is not represented as cheat-proof.
- Score on solve: remaining lives (1–6). Ties share a rank under the shared competition-ranking policy (`accepted_at` orders display only); any duration-based secondary metric requires a separate approved policy.
- End: solve is `completed`; sixth wrong guess is `lost`.

## Competition evidence

- Official runs record normalized A–Z guesses plus pause and resume events in
  trace version 3. Practice runs remain unchanged and produce no trace.
- The server reconstructs the term from the issued seed, reapplies every guess
  to the frozen Hangman rules, and derives the remaining-lives score. Claimed
  scores and terminal states are never trusted.
- The replay dependency closure includes the term list, rules, and seeded RNG.
  Its raw source hashes are frozen in the replay manifest.
- Hangman is available to synthetic version-2 rehearsal rounds, but material
  prize rounds reject it. Its answer and deterministic seed are necessarily
  visible in browser code, so replay can prove the submitted guesses while it
  cannot prove unaided recall. A reviewed participation-point and abuse policy,
  or a different server-hidden challenge, is required before it can award
  material championship points.
- Replay proves that submitted inputs produce the result. As with the other
  deterministic browser games, it does not claim to prevent automation or a
  player inspecting code delivered to their own browser.

## Seed dictionary

Recovered terms include `DAEBAK`, `BIAS`, `MAKNAE`, `COMEBACK`, `AEGYO`, `FANCHANT`, and `SASAENG`. `ULZZANG` is excluded from the launch seed pending content review; candidate additions include `BIAS WRECKER` and `LIGHTSTICK`. Multi-word display/guess normalization must be documented before adding spaces or punctuation.

Fan terms stay English in every locale. Instructions, hints, accessibility labels, and explanations are translated and reviewed by a fan-fluent speaker.

## Keep

- Word list and hints as the strongest content asset in the mock.
- Six-life loop.
- Fan-fluent voice and simple letter-selection interaction.

## Change from the mock

- Rebuild as a DOM module with real buttons, focus states, and live status text.
- Move reviewed terms/hints into a versioned content file; restore mojibake deliberately rather than copying corrupted text.
- Disable already-guessed letters and normalize case consistently.
- Use shell-owned counted context, pause, restart, and teardown.

## Rule edges

- Repeated letter selection has no effect and costs no life.
- A correct letter reveals every matching position.
- Spaces/punctuation, when supported, are pre-revealed and not guessable.
- The final correct letter resolves solve before any loss condition.

## Required vectors before implementation

1. Repeated, correct, and incorrect letter behavior.
2. Multi-occurrence letters and case normalization.
3. Sixth-error loss and final-letter solve precedence.
4. Daily content-version/day-key selection.
5. Keyboard/focus and screen-reader status behavior.
