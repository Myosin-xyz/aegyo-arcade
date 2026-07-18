# Freebie Frenzy (`freebie`) — M2.5 shell migration

**Status**: IMPLEMENTED (rebuilt from Daidai's delivered microsite)
**Surface**: `canvas` (ShellLoopGame), designBox **480×760**
**Counted completion**: `generic-submit` (portal default)
**Delivery**: `files_freebie_frenzy/` (gitignored raw intake — monolithic
646KB `game.html`, Supabase site shell, PSD)

## Intake record (2026-07-18)

Accepted at M2 review as milestone M2.5. Daidai is a Myosin contributor
(ADR 0006) — no external rights gate; this hash-recorded local archive is
the authoritative acceptance source; shared-storage mirroring is
housekeeping.

SHA-256 manifest of the delivered archive:

```
79f0acbd3056ae8d0a70af2171c58a15016d0ba3a62a9fb95fe67383bde71ee8  game.html
f09b0116233c448d259613f2407e143f1a752ea00cdd00d52c019f77911ae8dc  index.html
c192c14b7f23a0da9ba5fa9f5ded0ce0240ef4c724ddec80719b696bea17d78c  leaderboard.html
d2921ed587c57d5f22b6938491de14b4600325fa856f1cda94ece559f1c213dc  backend-supabase.js
64eada84c3ddd5e1f38097e492459f22b7b4d8fa76dd7c99ee63afde5a40a446  config.js
efa1053f89f8cfa883bc9a285f03ea9f241a36f7fee15d2e0819a47e79230b44  supabase_setup.sql
580838bc2ff1f04dc4925b2c8dbcc31cd2f92f591122dd040ae4efd42fe6fa58  BACKEND_INTERFACE.md
723f260969a01f2404c7e5afd8415e45d24c3beaacc7c4effb1200244c231c31  README.md
eb9c9215b5f9221f215048d6b1c813d5d04e04b3efa1dc8f9c631a8c6d65e36b  freebie_frenzy_game_applati.psd
```

## Rules (acceptance rubric — ported verbatim from the delivery)

Catch falling K-pop freebies with the fan character; miss one and lose a
life. 3 lives per level (reset each level), 5 levels, clear all 5 to win.

### Tiers

| idx | item                | points | baseSpeed px/s |
| --- | ------------------- | ------ | -------------- |
| 0   | Sticker sheet       | 5      | 95             |
| 1   | Friendship bracelet | 10     | 118            |
| 2   | Keychain charm      | 15     | 140            |
| 3   | Photocard           | 20     | 162            |
| 4   | Fan banner          | 30     | 190            |
| 5   | Lightstick          | 50     | 230            |

### Levels (10 items each, always)

| level | spawnMs | speedMul | pool (tiers) |
| ----- | ------- | -------- | ------------ |
| 1     | 1400    | 1.00     | 0–1          |
| 2     | 1220    | 1.14     | 0–2          |
| 3     | 1060    | 1.28     | 0–3          |
| 4     | 900     | 1.44     | 0–4          |
| 5     | 760     | 1.62     | 0–5          |

Queue build per level: 9 weighted picks from the level pool (weights
`[30,25,20,15,8,4]` sliced to pool size), then ONE guaranteed lightstick
(tier 5) inserted at a random slot — every level contains exactly one
guaranteed rare, even level 1. Level ends when all 10 items are resolved
(caught or missed).

### Scoring

- Catch: `combo++` FIRST, then `gained = Math.round(points × comboMultiplier)`.
- `comboMultiplier = 1 + min(5, floor(combo/4)) × 0.1` → catches 1–3 ×1.0,
  4–7 ×1.1, 8–10 ×1.2 (×1.3+ unreachable: 10 items/level, combo resets on
  miss and at level start).
- JS half-up `Math.round` is load-bearing (`16.5 → 17`, `55 → 55`).
- Clean-clear bonus on level completion: `level × 50` (the delivery's
  `lives > 0` guard is a dead branch — a run with 0 lives never reaches
  level completion).
- **Maximum score = 2277** (per-level bests 208/309/406/554/800), proven
  by rule vector through the production scoring path.

### Geometry (480×760 design box)

- `GROUND_Y = 760×(3440/4097)` ≈ 638.1; hero 45.45×71.4 (PSD-derived).
- Catch line `CATCH_Y = GROUND_Y − HERO_H×0.62` ≈ 593.9, window ±30.
- Horizontal catch: `|drawX − catcher.x| < HERO_W/2 + size/2 − 6` where
  `drawX = x + sin(wobble)×8` — **wobble is collision-relevant**, so it
  lives in the deterministic logic layer, not the renderer.
- Item size `46 + tier×4`; spawn `x ∈ [40, 440)`, `y = −30`,
  `vy = baseSpeed × speedMul`; miss when `y − size/2 > 760`.
- Movement: hold accel 1800 px/s², max 420 px/s, friction ×0.86 per 60Hz
  step; drag lerp `x += (target − x)×min(1, dt×14)`; clamp
  `x ∈ [w/2+6, 480−w/2−6]`.

## Portal adaptations (documented deviations from the delivery)

1. **Supabase/email/pseudonym stack DELETED** — portal device session +
   counted-run API + shared board policy. `levelReached` is not submitted
   (boards are score-only).
2. **Deterministic 60Hz fixed step** replaces the variable-dt (≤35ms) rAF
   loop; all randomness from `run.random` (seeded).
3. **RNG stream is canonical to the port**, not draw-parity with the
   delivery: the delivery's dead draws (50 never-rendered stars, the inert
   item-count draw) and cosmetic particle/shake draws are dropped.
   Gameplay draws per level: 9 weighted picks → 1 guaranteed-slot index →
   9 Fisher–Yates swaps → 4 per spawn (x, rot, rotSpeed, wobble phase) →
   1 per tier≥4 catch (callout variant).
4. **Input**: keyboard (Arrow/A/D) + pointer-drag-anywhere via InputBus.
   The delivery's DOM LEFT/RIGHT hold buttons are dropped — drag covers
   mobile (95% of the audience) and buttons duplicated the keys path.
5. **VFX reduced**: score popups, catch callouts, hero glow/hop kept;
   particles/shockwaves/screen-shake/spotlights dropped (cosmetic only).
   The delivery's 300ms death-beat delay before game-over is dropped.
6. **Level recap** is an in-canvas overlay ("tap to continue") inside ONE
   counted run; the run ends only at all-cleared (`completed`) or
   out-of-lives (`lost`).
7. Assets re-encoded WebP under `public/games/freebie/` (160KB total vs
   646KB monolith): `bg` (HUD chrome baked in — numbers drawn at the
   baked box positions), `tier0–5`, `hero`. Delivery button art unused.
8. Fan-rank phrases condensed to titles only; strings centralized in
   `en.json` under `game.freebie.*`.

## Rule vectors (tests/unit/freebie-rules.test.ts)

Queue composition per level (10 items, exactly-one-guaranteed-rare rule,
pool bounds), combo curve incl. unreachable-cap documentation, rounding
vectors (16.5→17), collision boundary vectors (X strict-less, Y window
inclusive, wobble displacement), miss → life loss → combo reset → 3rd
miss ends, level completion + bonus arithmetic, level-5 win, **max-score
2277 vector through the production catch/bonus path**, seeded replay
(same seed + same input script → identical state).
