# Game Concept — Fan Day: This or That (`thisorthat`)

**Status**: M4.5 DISPOSABLE PROTOTYPE (2026-07-19) — built small on
purpose so Simon reacts to something playable; no pre-build feedback
gate. Everything here is cheap to change or delete.
**Surface**: `dom` (hangman's proven contract pattern)
**Mode**: PRACTICE-ONLY (`capabilities.counted: false`)

## Shape

Nine quick rounds; each presents two large choice cards; tap either side
to advance; progress reads "3 / 9". The final screen shows a lightweight
fan-day vibe result — Cozy, Creative, Adventurous, Energetic, or Social
— plus a recap of the player's nine picks. Reaching the result reports
`end("completed")` once through the FROZEN lifecycle; the registry's
`endPresentation: "game-authored"` keeps the in-DOM result visible
(no dark host overlay) while the HOST renders Play Again and owns the
restart with a fresh RunContext (M4.5 review P1).

## Content decisions (v1)

- NO official artwork, logos, or member photos. Abstract Aegyo-palette
  glyphs (one per vibe) + plain-text member first names only, so Simon
  understands the pairing concept (Mateo's call, 2026-07-19).
- Softened options from the source concept: "Drinking" → "Late-night
  snacks"; "Getting tattoos" → "Designing matching charms".
- Result = highest vibe tally across the chosen options' tags; ties
  resolve by fixed priority (creative → energetic → adventurous →
  social → cozy — deliberately low-frequency-first to counter skew).
  Deterministic — identical choices, identical result. Exhaustive
  512-combination snapshot: 13.9%–25.0% win spread, every vibe
  reachable (M4.5 review P2; a cozy-first order measured 42.6% cozy).
- Member names are registered in docs/CONTENT_REGISTER.md as INTERNAL
  PREVIEW ONLY — public use gated on nominative-reference guidance
  (§12.2 item 5).
- Complete EN + es-419 strings from the start (parity-tested).

## Deliberately excluded from the first build

No counted daily run, no database or server API, no leaderboard or
streak consumption, no share-image export, no analytics events, no
member-match / "which member are you" claim, no final title or branding
decision.

## Prototype acceptance bar (all unit/e2e-vectored)

Single-advance taps (300ms double-tap lock), pause disables cards AND
keyboard, keyboard works alongside touch, deterministic results,
restart clears every choice, leak-free destroy, 390px layout,
lazy-loaded (registry dynamic import — home bundle carries meta only).

## Parked for Simon's reaction

1. Fun choice recap vs member-match result?
2. Prompts and member pairings right?
3. Ending: emphasize sharing or replaying?
4. Promote from practice-only into the daily counted system?
