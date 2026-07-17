# Game Rules Seed — Bias Flap

**Status**: Recovered v0.1 design baseline; calibrate units and finalize vectors before M2 implementation
**Source**: Nicole's playable mock and v0.1 keep/change review
**Surface**: `canvas`
**Reference box**: 360×640 logical px (confirm during implementation)

## Product baseline

- Framing: guide a lightstick through concert barricade gaps.
- Recovered feel: gravity **≈0.45**, flap impulse **≈−7.5**, gap **≈180 logical px**.
- Input: tap anywhere on the game surface; keyboard is an enhancement.
- Score: one point after the player completely passes a barricade pair.
- End: player intersects a barricade or leaves the playable vertical bounds.

The recovered gravity/impulse values came from frame-based mock code. Preserve their observed 60Hz feel; do not blindly treat them as SI or per-millisecond units. The M2 implementation records the normalized fixed-step values that reproduce parity.

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
