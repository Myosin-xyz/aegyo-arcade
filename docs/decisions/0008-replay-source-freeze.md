# ADR 0008 — Competition replay source is version-frozen

**Date**: 2026-09-12
**Status**: Accepted

## Decision

Competition trace version 1 is interpreted by the verifier and its transitive
deterministic game dependencies. Those source files are recorded in
`src/competition/replay-source-manifest.json` with hashes of their raw bytes. A
guard test discovers the local import closure from the verifier, so adding a new
local dependency also requires an explicit freeze decision.

The manifest is append-only by replay version. A change to a recorded file that
can affect seeded state, accepted actions, timing, terminal state, or score must
introduce a new trace and verifier version. The server must retain dispatch to
the prior verifier for every issued attempt and through completion of all
associated review, correction, award, and claim work. Updating a version 1 hash
to make the guard pass would silently reinterpret stored evidence and is not an
acceptable migration.

Formatting and comments are intentionally covered. Keeping the raw-file rule
simple makes review failures conservative; a harmless edit can wait for a
planned replay version or be kept out of the frozen source.

## Consequences

Practice presentation and module adapters may evolve without changing replay
semantics when they do not alter the recorded dependency closure. Changes to
Snake logic, Bias Flap logic, seeded random generation, or the replay verifier
require a new version even if current example traces still produce the same
scores. Behavioral fixtures remain useful evidence, while the source guard
prevents untested seeds or states from drifting between issuance and review.
