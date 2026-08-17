# Game Rules - Bias Match

**Status**: IMPLEMENTED - DaiDai delivery port (2026-08-17)

**Surface**: accessible DOM, shell-owned fixed 60Hz loop

**Reference box**: 360x640 logical px

## Product rules

- Flip two photocards at a time to find matching fictional character pairs.
- Each level begins with a full-board peek. Peek time falls from 2.2 seconds
  on level 1 to 1.8 seconds on level 5.
- The board grows through 2x3, 3x4, 4x4, 4x6, and 4x7 layouts.
- Every level starts with five lives. A wrong pair costs one life; reaching
  zero ends the run.
- Each pair has a seeded 25% chance to be gold and score double. At least one
  gold pair is guaranteed on every board.
- All face selection, bonus assignment, and shuffling use `RunContext.random`
  so counted boards replay exactly from their server-issued seed.

## Scoring and server envelope

- A normal pair scores `10 x current level`.
- A gold pair scores `20 x current level`.
- Level-clear bonuses are 30, 40, 60, 80, and 100.
- The exact fully-gold ceiling is
  `90 + 280 + 540 + 1040 + 1500 = 3450`; the shared server rejects 3451.

## Portal adaptations

- The standalone backend, username, two-plays-per-day stub, and module-owned
  replay buttons are removed. The host owns counted attempts, practice,
  device identity, leaderboards, streaks, replay, and sharing.
- Real buttons retain the delivery's 3D flip, miss shake, gold outline, CRT
  scanlines, and result screens while adding focus visibility, accessible
  card labels, a polite status region, pause gating, and idempotent teardown.
- At the supported 320x568 floor, level five keeps every card at least 44px
  and uses a contained vertical board scroll so the last row stays reachable.
- Sixteen source JPGs are metadata-stripped and exported as 144 KB of WebP
  assets. The delivery identifies every portrait as generic and fictional.
- The landing card uses a localized 3-second capture of the deterministic
  `bias-match-preview-0` board: peek, flip-down, and a gold double-point match.
  The MP4 is attached only when the shared preview activation rules allow it.
- Background music reuses the existing lazy Guess the Slang puzzle track;
  no ninth catalogue audio file is shipped.
- English and Latin American Spanish cover the ready card, HUD, card state,
  feedback, transitions, and results.

## Required vectors (implemented)

1. Same seed produces the same deck; every selected face appears exactly
   twice and every board has a gold pair.
2. Peek-time input is rejected; a matching pair reveals and scores correctly.
3. A mismatch costs exactly one life and flips both cards back down.
4. Level transition restores five lives and grows the board.
5. Five real mismatches reach the authored game-over screen exactly once.
6. The all-gold server ceiling is exactly 3450.

## Intake record

Local source folder: `bias-match 2` (kept outside the served tree). The live
Netlify URL supplied with the handoff was used only as a visual/behavioral
comparison, not as the implementation source.

Complete source-tree digest, calculated from the sorted per-file SHA-256
manifest with `.DS_Store` excluded:
`aaf6370505c2818d36538749bd4ad5a572fd0e38e1737a26c7224cbc958a2015`.

Core delivery hashes:

- `README.md` - `432695652db0ca570bf41d0207ebaec20211a54030511ac593ce6303103155b0`
- `PRODUCT_BRIEF.md` - `6676518383faba87fac308ec3763098ec765cc4bbf97773c01054f25e0a02aa1`
- `BACKEND_INTERFACE.md` - `fa119defa553bbc9faa614c420e90483591a173bc9e84fb22c5ab012af49175d`
- `js/config.js` - `82f59b88740cc162b70aaec4225c182f50a8e2cd17a078e1a043573187659cf3`
- `js/game.js` - `2cfc0585b3992025f00505d2aed3d209abff4f5c4945729df7d0fff88e9671ba`
- `css/style.css` - `26a888db62c6d61f781dd268da1815f6c0af8f3e1ff0e1a781a7cd2919b6ec0b`

The sorted runtime face-WebP manifest digest is
`0937dd10ea20667a3d1ea538bcbb37370d77694f6289c8fa735826745f4459b6`.
DaiDai is an internal Myosin contributor under ADR 0006. The delivery says
the Banana Pro portraits depict no real band, brand, logo, or likeness.
