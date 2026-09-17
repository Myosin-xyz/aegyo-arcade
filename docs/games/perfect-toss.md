# Game Rules - Perfect Toss

**Status**: IMPLEMENTED - shell game port (2026-09-17)

**Surface**: `canvas`, shell-owned fixed 60 Hz loop

**Reference box**: 360x640 logical px

## Product rules

- Tap anywhere or press Space to throw the lightstick.
- A marker crossing the gold sweet spot produces a GOOD catch. The white
  inner 32% produces a PERFECT catch. A miss ends the run.
- GOOD catches award 10 local points and shrink the sweet spot by 10%, down
  to a 4.5% half-width. PERFECT catches award 25 and preserve its width.
- A seeded green bonus tick appears on 28% of target rolls and awards 50
  extra local points. It stays relative to the sweet spot while the target
  moves, so it cannot drift outside the safe region.
- Every catch increases marker speed by 4.5%. The target is centered for the
  first four throws, relocates after catches 4 through 8, and drifts from
  catch 9 onward.
- The shell-facing score is consecutive catches. The authored HUD separately
  retains the delivery's 10/25/+50 local score.
- The 0.55-second flight blocks another throw. A miss then shows both sad
  poses for 0.5 seconds before the run reports its terminal state.

## Portal adaptations

- The standalone `window.Backend`, username, and play-limit stub is removed.
  The shell owns practice and its existing cosmetic counted-run path;
  authenticated championship admission and verification remain a separate
  integration.
- Gameplay uses `RunContext.random` and exact 60 Hz ticks. Relocation, drift
  phase, and bonus rolls are deterministic from the run seed. Cosmetic
  particles alone may use `Math.random()`.
- The shell owns lifecycle, pause/resume, input, canvas sizing, restart,
  localization, and audio. The game has no private animation frame or timer.
- The delivered Bungee web-font request is removed. Canvas text uses the
  existing system display stack.
- The nine source PNGs are exported as lossless, metadata-stripped WebPs.
  Character-hand anchor fractions remain tied to the delivered
  `boy_throw` and `girl_catch` pixel geometry.

## Required vectors

1. Same seed produces the same opening drift phase and bonus target.
2. GOOD, PERFECT, bonus, and miss boundaries award the documented results.
3. GOOD shrinks the zone; PERFECT preserves it; every catch grows speed.
4. Catch 4 relocates and catch 9 begins contained drift.
5. The bonus stays inside the moving sweet spot at every drift tick.
6. An active throw blocks duplicate input for exactly 33 ticks.
7. A miss exposes 30 ticks of sad reaction before terminal state.
8. Module input reports catches, ends once, pauses, restarts, and tears down.

## Intake record

Local source folder: `/Users/mateodazab/Downloads/perfect-toss` (outside the
served tree). Complete source-tree digest, calculated from the sorted per-file
SHA-256 manifest with `.DS_Store` excluded:
`c82e2d22452d09bd3405946a4fbd2975a38f11fa96b87a86a644834da63e7866`.

Core delivery hashes:

- `README.md` - `04f44f509d92541280321da7bd01c9a6ffbb740dfcf8d89623786d90a44f7ee6`
- `PRODUCT_BRIEF.md` - `255177d55b2f4bc45cf1bdfc0c42092ed2792ce9e45e2b49586780e7972b5d38`
- `BACKEND_INTERFACE.md` - `6ebe565f24c1a340e000b9a38dc409e25a5c0bbf68dec2d87fd9a7aa776d23aa`
- `js/config.js` - `33544f43cac83daaf4667b4e8f7306f5b468d4f3ce6673a6a39b9566f85adc37`
- `js/game.js` - `fd60a61612989cbfdf27ac6d61c87c527777199d2f7c0460626673684939b213`
- `css/style.css` - `429e2cc1806cf957639912ace0e2a86210c455ad018a2ebc365da35ad46e9b11`
- external point-system addendum - `ed29b76ce1009bdf2d1aa1eafe5172d2ef3303e10001daf7c9311d101d0609d6`

Mateo identified this folder as Dai Dai's game handoff and instructed that it
be integrated into Aegyo Arena. Dai Dai's hashed `PRODUCT_BRIEF.md` represents
the characters and lightstick as original fictional designs without a real
person, group, brand, logo, or likeness. That named project handoff and written
original-art representation are the clearance record for the current Aegyo
Arena catalog; the visual inspection found no contradictory mark or likeness.

Runtime asset SHA-256:

| Asset             | SHA-256                                                            |
| ----------------- | ------------------------------------------------------------------ |
| `boy_catch.webp`  | `33c742be53ccbb8ff0032c1a115e68c4543570767cff9ef9dd748d59cdbb8ec7` |
| `boy_happy.webp`  | `d3e238fb5ac38969bfc0a66ccb688beb1566eeca8266f4f87c2e9c8fcc2a98fa` |
| `boy_sad.webp`    | `4837a51746832de04bc0a23d816d93f418ff92e4fc02b3b6b49532c649edc10c` |
| `boy_throw.webp`  | `946560f9108445612beafe12930770584229518f26b38ecfb711a1f7fe736a9d` |
| `girl_catch.webp` | `36f83316c9bbf5529ace6d523f2c4a0132af6f49156492ca3a2402ec8f537f47` |
| `girl_happy.webp` | `5f09352eec0d61ede3f2371497b763dae8e7c50071d2ff0c359d177e0a125894` |
| `girl_sad.webp`   | `7f8282c0337546b32f342c700b102d759752a0c263b3d2ab6fd29b0f4103b320` |
| `girl_throw.webp` | `dcf585ea8dc1f439f0c211f45a7ff04eac2c21954ed41623716a6a03704df146` |
| `lightstick.webp` | `ab14101a79da99376d2e99ada6edcdeb55e61dee5d125a85230e2eeaa32fca69` |

The localized 360x360 posters and three-second muted MP4 previews are Myosin
derivatives generated from these cleared source sprites.
