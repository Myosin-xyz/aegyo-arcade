# Game Rules Seed — Comeback Climb

**Status**: Recovered v0.1 design baseline; finalize bounce constants/vectors before M2 implementation
**Source**: Nicole's playable mock and v0.1 keep/change review
**Surface**: `canvas`
**Reference box**: 360×640 logical px (confirm during implementation)

## Product baseline

- Framing: climb the chart from **#100 to #1** by landing on platforms.
- Each newly cleared platform advances one chart place; score is positions climbed (`100 - bestRank`).
- Reaching #1 ends the run as `completed` with score 99.
- Falling below the camera's loss boundary ends the run as `lost`.
- Launch input: horizontal drag/touch steering through `InputBus`. Tilt is deferred as an optional accessibility-reviewed experiment.

**Adopted M2 units (per fixed 60Hz simulation step):** gravity 0.32 px/step², bounce impulse −9.5 px/step, steering `x += clamp((steerX − x) · 0.15, ±8)`, platform 64×10, player 30×28, seeded spawn dy ∈ [55, 85] with |dx| ≤ 140 (reachable under the movement limits: apex ≈ 141 px, horizontal reach ≈ 200 px per hop), camera lead 220 px (up only), loss when the player is 640 px below the camera top. Score envelope 99.

## Keep

- The chart-position progression hook and visible current rank.
- The mock's platform-bounce feel, subject to measured parity constants.
- Upward camera progression and the #1 completion moment.

## Change from the mock

- Remove mousemove-only steering; use surface-scoped pointer input.
- Cleanly separate simulation, camera, and platform spawning.
- Make platform generation seeded and guarantee a reachable path under documented movement limits.
- Use shell-owned loop, canvas, pause, audio, restart, and teardown.

## Rule edges

- A platform advances rank only on its first qualifying landing.
- Side/bottom contacts do not count as landings.
- Camera movement never changes world-space collision outcomes.
- Rank cannot improve beyond #1 or decrease after a platform is credited.

## Required vectors before implementation

1. Bounce and horizontal-drag trajectories.
2. First-N seeded platforms and reachability assertion.
3. One-credit-per-platform behavior.
4. Camera/world-coordinate collision cases.
5. #1 completion and fall-boundary end-at-most-once.
