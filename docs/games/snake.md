# Game Rules Seed — POCA Snake (SUPERSEDED 2026-07-26)

> **This seed is historical.** The shipped Snake is now **Snake Freebies**,
> Daidai's delivered design — see **docs/games/snake-freebies.md** for the
> live mechanics, provenance and port notes. The code-drawn POCA Snake this
> document described (endless classic, `maxScore` 400) was retired when the
> designed version landed; TECH_SPEC §5 had always listed it as a "Nicole
> mock" to "rebuild against shell", and this was that rebuild.
>
> Kept for provenance only. Everything below describes the retired game.

# Game Rules Seed — POCA Snake (né Aegyo Snake, renamed 2026-07-19)

**Status**: Recovered v0.1 design baseline; finalize test vectors before M2 implementation
**Source**: Nicole's playable mock and v0.1 keep/change review
**Surface**: `canvas`
**Reference box**: 360×640 logical px (confirm during implementation)

## Product baseline

- Framing: collect photocards with a classic Snake loop.
- Board: 20×20 logical cells.
- Starting movement step: **140ms**.
- Input: swipe and on-screen direction controls; keyboard is an enhancement.
- Score: one point per collected photocard.
- End: wall or self collision; `report.end({ reason: "lost" })` fires once.
- Counted and practice rules are identical; only entitlement/seed persistence differs.

## Keep

- Photocard-collection framing.
- 20×20 grid.
- Swipe plus visible direction controls.
- The recovered 140ms starting feel.

## Change from the mock

- Use the shell loop with a movement accumulator; no `setInterval` game logic.
- Restart in place with complete state reset.
- Route all input through `InputBus`; ignore immediate 180-degree reversal.
- Use shell-owned canvas/DPR sizing, pause, audio, and teardown.
- Do not add a speed ramp in the first parity build. A later ramp is accepted only after device playtesting and deterministic vectors are updated.

## Rule edges

- At most one direction change is applied per movement step; queued input cannot reverse into the previous cell.
- Photocards never spawn on the snake.
- Moving into the cell the tail is vacating this step COUNTS AS A COLLISION
  (strict rule, matches the mock; decided at M2 review — see V3c vector).
- A full board ends as `completed` with the maximum possible score.
- Paused time advances neither movement nor run duration eligibility calculations owned by the shell.

## Required vectors before implementation

1. Seeded initial body/direction and first photocard position.
2. Direction-queue cases, including forbidden reversal.
3. Wall/self collision end-at-most-once.
4. Photocard spawn never overlaps the body.
5. Repeated `start()` returns to the same seed-derived initial state.
