# Game Rules Seed — Guess the Slang

**Status**: Recovered v0.1 content baseline; finalize reviewed dictionary/hints before M2 implementation
**Source**: Nicole's playable mock and v0.1 keep/change review
**Surface**: `dom`
**Reference box**: responsive portal content area

## Product baseline

- Framing: guess a K-pop fan term from a translated hint.
- Six incorrect guesses are allowed.
- Practice selects from the reviewed dictionary locally.
- A counted run uses the server-selected daily term for the current `day_key` and content version; the surface is cosmetic and the answer is not represented as cheat-proof.
- Score on solve: remaining lives (1–6). Leaderboard ties use shorter server-observed duration, then earlier accepted time.
- End: solve is `completed`; sixth wrong guess is `lost`.

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
