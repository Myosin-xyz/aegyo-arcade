# ADR 0005 — Game Runtime Contract frozen as v1

**Date**: 2026-07-18
**Status**: Accepted

## Decision

The runtime contract (`src/shell/contract.ts`) is **frozen as v1**. Changes
now require an ADR; breaking changes require a new `apiVersion`.

## Evidence (the §6.1 freeze conditions, all green)

1. **Real claw through an adapter** — module-loop escape hatch: M0 spike
   (mount/start/pause/resume/destroy in a real browser), M1 repeatable
   `start()`/idempotent destroy, pause-gated legacy input, mute sync via
   `AudioBus.onMutedChange`, signal-tied server outcomes.
2. **Hostile fixture** — slow init, abort, duplicate start, init failure,
   global-listener/timer leaks (tracker-verified), end-at-most-once,
   destroy-before-init, throw-on-start, paused-input delivery.
3. **Leak conformance** — zero timers/rAF/listeners/DOM after destroy,
   proven for shell-loop canvas, module-loop canvas, and dom surfaces.
4. **Production compatibility checks** (ADR 0001 substitution): **Flappy**
   (`canvas`, shell loop) and **Hangman** (`dom`) — Daidai's Frogger was
   not required and remains M3.

## Decisions folded into v1

- **`RunContext` discriminated union**: non-practice runs carry
  `attemptId: string`; malformed contexts fail closed at runtime too.
- **Pause determinism is portal-wide**: the host disables the InputBus on
  pause; games clear transient gestures.
- **Claw-only legacy input exception** (spec §6): the claw keeps its own
  listeners behind `loop: "module"` with mandatory `setEnabled` pause
  gating, teardown, leak conformance, and bus-mute sync. NO new game gets
  this exception; it retires if the claw engine is rebuilt.
- **`hostManagedCanvas` stays OUT of `GameMeta`**: it is a canvas-only,
  optional host-loading hint on the registry entry (undefined =
  shell-managed; `false` = claw legacy sizing). Not part of the game
  contract.
- **Daily-seed games** embed their content version:
  `daily:<gameId>:<version>:<dayKey>` (`CountedGameConfig.dailySeedVersion`).

## Consequences

- Frogger/Freebie Frenzy intakes target a FROZEN contract — adapter-or-
  refactor decisions no longer risk contract churn.
- Future contract needs (e.g. a game requesting persistent per-device
  save state) arrive as ADR-reviewed v2 proposals, not drive-by edits.
