# Game Rules - Photocard Stack

**Status**: IMPLEMENTED - DaiDai delivery port (2026-08-17)

**Surface**: `canvas`, shell-owned fixed 60Hz loop

**Reference box**: 360x640 logical px

## Product rules

- One input: tap anywhere or press Space to drop the moving photocard.
- A successful overlap becomes the next card. Any overhang is trimmed and
  falls away; every later card inherits the narrower width.
- A drop within 1.4% of the playfield width is PERFECT: it snaps to the
  card below, preserves the full width, and grows the perfect combo.
- Every 10th landed card is holographic and adds 50 points.
- The collector rank thresholds are 0, 10, 20, 35, and 50 landed cards.
- A total miss or a card narrower than 4.5% of the playfield ends the run.
- Card choices, opening direction, and later directions use
  `RunContext.random`; cosmetic particles alone may use `Math.random()`.

## Scoring and server envelope

- Trimmed drop: 5 points.
- PERFECT drop: `10 + 2 x current perfect combo`.
- Holographic milestone: +50 points.
- At height `H`, the exact perfect-play upper bound is
  `H x 10 + H x (H + 1) + floor(H / 10) x 50`.
- The supplied backend brief calls heights above 1,000 absurd. The shared
  score-only V1 submit endpoint therefore caps the score at **1,016,000**,
  the exact perfect score at height 1,000.

## Portal adaptations

- The standalone backend/username/two-plays-per-day stub is removed. The
  portal owns device identity, one counted portal run per local day,
  unlimited practice, streaks, and weekly leaderboards.
- The prototype's pixel-per-frame motion is converted to fixed-step,
  elapsed-time motion, while retaining its 60Hz tuning.
- The raw JPG cards are exported to 22 lazy WebPs. Player-facing strings
  are localized in English and Latin American Spanish.
- The game-authored result keeps height, rank, score, and best height on
  screen while the host owns restart, sharing, and counted-run receipts.
- Background music reuses the existing lazy Freebie Frenzy catalogue track;
  no duplicate audio asset is shipped.

## Required vectors (implemented)

1. Seeded opening equality.
2. PERFECT snap, width preservation, and growing combo.
3. Trimmed overhang width and normal-drop score.
4. Every-10th holographic milestone and rank transition.
5. Total-miss terminal state.
6. Exact 1,000-card server score ceiling.

## Intake record

Local source folder: `photocard-stack 2` (kept outside the served tree).
Complete source-tree digest, calculated from the sorted per-file SHA-256
manifest with `.DS_Store` excluded:
`ef027f4a54dc1903092c166ce938eedf1f1279a5a7eb890c903760b2bcbf272e`.

Core delivery hashes:

- `README.md` - `2e2a0f57cc8c768f53e022f5e47b6916e6979784b020ba8f7b4e162067286c97`
- `PRODUCT_BRIEF.md` - `dc6e71558fad3c0adc6924b79e447be5d2b509bdaf570c0c36cdc02d45ef5920`
- `BACKEND_INTERFACE.md` - `2d4e5b32b900562608c894bdf3bdd9ee171c6148fa9510ab8fd485f5db37fa11`
- `js/config.js` - `c7b80fb0f2fc470991b366d83c2a5c03ecad73c0fb20fdad9fa913f626d6f6ee`
- `js/game.js` - `45633a21543069168746fdc237061c3e7463bed1b8591cc29cc4e9fadaaed48d`
- `css/style.css` - `7302c8b3de1346274302a42a257ec59b7445a933b9869608cc7ec162b55413b3`

DaiDai is an internal Myosin contributor under ADR 0006. The delivery
identifies the portraits as fictional, with no real person, group, or logo.
