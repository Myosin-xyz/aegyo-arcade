# Game Rules Seed — Bias Flap

**Status**: Recovered v0.1 design baseline; calibrate units and finalize vectors before M2 implementation
**Source**: Nicole's playable mock and v0.1 keep/change review
**Surface**: `canvas`
**Reference box**: 360×640 logical px (confirm during implementation)

## Product baseline

- Framing: guide a winged idol flyer through concert barricade gaps
  (2026-07-19: player art changed from a lightstick to a winged bias per
  Simon's request — see CONTENT_REGISTER for the likeness gate).
- Recovered feel: gravity **≈0.45**, flap impulse **≈−7.5**, gap **≈180 logical px**.
- Input: tap anywhere on the game surface; keyboard is an enhancement.
- Score: one point after the player completely passes a barricade pair.
- End: player intersects a barricade or leaves the playable vertical bounds.

The recovered gravity/impulse values came from frame-based mock code. Preserve their observed 60Hz feel; do not blindly treat them as SI or per-millisecond units.

**Adopted M2 units (per fixed 60Hz simulation step):** gravity 0.45 px/step², flap impulse −7.5 px/step, pipe speed 2.6 px/step, pipe spacing 180 px, pipe width 46 px, gap 180 px (half 90), gap-center safe range [120, 520], player x = 70, radius 16, floor y = 620. Score envelope 800 (bounded by the 15-minute attempt TTL).

## Keep

- Lightstick/barricade framing.
- Gravity, impulse, and gap feel above.
- Immediate tap response and one-point-per-stage scoring.

## Change from the mock

- Use the shell loop and `InputBus`; no global handlers or game-owned rAF.
- Fix barricade-recycle randomization so every new gap remains inside documented safe margins.
- Restart in place and tear down without leaked timers/listeners.
- Use shell-owned DPR, pause, audio, and final score capture.

## Rule edges

- A barricade scores exactly once.
- Collision and score crossing in the same simulation step resolve collision first unless parity testing proves the mock did otherwise.
- Pause freezes physics and spawning.
- Seeded runs produce the same gap sequence.

## Required vectors before implementation

1. No-input fall from the initial state.
2. One/multiple flap impulse trajectories at fixed timestamps.
3. Gap generation bounds across a fixed seed sequence.
4. One-score-per-barricade and collision precedence.
5. Restart and pause/resume determinism.
