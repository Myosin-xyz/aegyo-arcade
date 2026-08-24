# Game Rules - Aegyo Pop

**Status**: IMPLEMENTED - DaiDai delivery port (2026-08-24)

**Surface**: `canvas`, shell-owned fixed 60Hz loop

**Reference box**: 390x780 logical px

## Product rules

- Aim with pointer movement/drag or the arrow keys, then tap/press Space to
  launch the orb from the lightstick handle. The guide reflects the real
  trajectory, including side-wall bounces.
- A connected group of three or more same-icon orbs pops. Any non-captive orb
  left without a path to the ceiling becomes an orphan and falls.
- Consecutive successful pops grow the multiplier by 0.2x, capped at 2.5x. A
  shot that lands without a match resets the combo.
- Rainbow-ring color bombs clear every remaining orb of their matched color.
- Ice orbs introduced on level three take two independent hits. Orphan removal
  uses the same hit-point-aware removal path, so it cannot bypass the rule.
- Captive hearts on levels two, four, and five never match or orphan-drop. A
  captive is rescued only after all neighboring cells are empty.
- Every level has a finite reinforcement budget. A row arrives after the
  configured shot interval until `maxDrops`; the final one announces LAST
  WAVE, and no later shot can create another reinforcement row.
- Crossing the pulsing red danger line loses the run. Clearing the board
  advances through five levels; the timer pauses on level-transition cards.
- Initial boards, specials, shooter queue, reinforcement rows, and projectile
  spin use `RunContext.random`, so counted runs replay from the issued seed.

## Scoring and server envelope

- Popped orb: `10 x level`, with the current combo multiplier.
- Color-bomb extra: `20 x level`, with the same combo multiplier.
- Orphan drop: `10 x level`; captive rescue: `150 x level`.
- Level-clear bonuses: 50, 70, 100, 140, and 200.
- The refillable shooter in the standalone source has no natural shot-count
  ceiling: a player can leave one ceiling-connected orb alive and farm matches.
  The port therefore saturates raw gameplay points at **49,999**.
- A five-level clear adds **50,000**, so every completed run ranks above every
  incomplete run through the portal's score-only V1 endpoint. The exact server
  envelope is **99,999**.
- Elapsed time and shots remain on the authored result screen. The current
  generic portal leaderboard stores one score integer, so the delivery's
  separate `completed DESC, score DESC, time ASC` tuple is encoded as
  completion-first score bands rather than a separate time tiebreak column.

## Portal adaptations

- The standalone backend, username lookup, client two-plays gate, global
  resize/pointer listeners, interval timer, and private rAF loop are removed.
  The host owns identity, daily counted issuance, practice, input, pause,
  timing, audio, submission, replay, sharing, and teardown.
- Pixel-per-frame projectile and particle tuning is converted to elapsed-time
  motion. Collision movement remains sub-stepped to prevent tunneling.
- Player-facing copy is localized in English and Latin American Spanish. The
  host renders the localized intro/mode chooser; the canvas retains the
  authored HUD, transition, and result presentation.
- Five 200x200 source PNG badges are metadata-stripped and exported to 48 KB of
  runtime WebP. The delivery identifies them as generic fictional fan badges
  with no real group, brand, logo, or likeness.
- Background music reuses the existing lazy Freebie Frenzy action track. Eight
  synthesized shell-owned SFX cover shots, matches, bombs, danger, waves,
  level clears, losses, and the final clear.
- The landing card uses localized deterministic `aegyo-pop-preview-v1`
  captures: 360x360 WebP posters and 3-second muted H.264 clips, loaded under
  the portal's shared hover/focus/mobile-visibility rules.

## Required vectors (implemented)

1. Same seed produces the same opening; a different seed changes it.
2. A connected three-plus group pops, and a color bomb clears its color
   board-wide with the documented score.
3. An orphaned ice orb cracks on the first pass and disappears on the second.
4. Orphan detection protects a captive; exposure rescues it exactly once.
5. Reinforcement rows stop at `maxDrops` and emit one LAST WAVE event.
6. Farmable raw points saturate at 49,999; a full clear reaches at most 99,999.
7. Real InputBus pointer input detaches the shooter orb; pause freezes flight;
   restart/transition input reuses the same initialized instance cleanly.

## Intake record

Local source folder: `/Users/mateodazab/Downloads/aegyo-pop` (outside the
served tree). The supplied Netlify build was used only for visual and behavior
comparison; implementation comes from the readable local delivery.

Complete source-tree digest, calculated from the sorted per-file SHA-256
manifest with `.DS_Store` excluded:
`d1f8fae4b25800a5ce171b2f5515e74869c60113516c0003bdd3a35ccdf18ae0`.

Core delivery hashes:

- `README.md` - `499abcb3bc9f30dff1d8bc43316e235a9e3a4b7bedf61b2b1887c4196fc8f821`
- `PRODUCT_BRIEF.md` - `5e22ecb6f1b9810a8f07c90316a922cc76e4a85a4cad7e64be0594c908961048`
- `BACKEND_INTERFACE.md` - `ee356bc3df1b2400ebed6737a7af9fc64a8971b78a603708177193d9b3f9f8a0`
- `js/config.js` - `9f8fa46f8fcf7f10d9e671c99ec9ab81c2747fc2232155c22f801279a1fcd74d`
- `js/game.js` - `633169cdb9b80f60de21b70a5c28a30e4841cf0d385fd2d9117a02202dd048b2`
- `css/style.css` - `b577bea858f78f54c2e2c7f16fd4dcbc966078179847846efb7c5de472af8845`

The sorted five-orb runtime WebP manifest digest is
`82a353e4403a11235f5f39dd176af50749507a66c5dc9e57888dee6043ec976c`.
DaiDai is an internal Myosin contributor under ADR 0006. The delivery states
that the orb icons are generic/fictional and contain no real band, brand, logo,
or likeness.
