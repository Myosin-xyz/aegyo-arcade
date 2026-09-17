# ADR 0007 — Optional deterministic competition evidence in contract v1

**Date**: 2026-09-12
**Status**: Accepted

## Decision

The frozen game runtime contract v1 gains two optional fields: a run may request
competition trace capture, and a game may attach that trace to its end result.
Omission preserves the existing runtime behavior and every existing game remains
valid. The change is therefore additive and does not require `apiVersion: 2`.

Snake and Bias Flap record only accepted semantic actions against the shell's
fixed 60 Hz simulation tick. The verifier reconstructs seeded state through the
same pure game cores, enforces ordering and resource bounds, and computes the
score and terminal state itself. A client-reported score is never evidence.

## Consequences

The host chooses which runs capture evidence and owns transport. Games do not
know challenge policy or persistence. Pause consumes no simulation ticks, while
pause/resume actions remain recorded. Existing practice, counted and prize runs
without the option retain their prior results and allocation behavior.
