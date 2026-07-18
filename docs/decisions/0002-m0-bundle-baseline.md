# ADR 0002 — M0 bundle baseline and adjusted transfer budget

**Date**: 2026-07-17
**Status**: Accepted (M0 evidence gate, TECH_SPEC §15)

## Measurement

Method: `next build` + `next start`, then fetch `/` from a clean profile and
gzip every `<script src>` it references (level 9). No analytics installed yet;
no game chunks load on `/` (registry is metadata-only; claw code confirmed
absent from the home script set).

| Item              | Raw      | Gzip         |
| ----------------- | -------- | ------------ |
| Home HTML         | 8.4 KB   | 2.4 KB       |
| Home JS (9 files) | 618.3 KB | **183.9 KB** |

Environment: Next.js 16.2.10 (Turbopack), React 19.2.4, portal home as a
Server Component with `next/link` cards; GameHost not in the home tree.

## Finding

**The provisional ≤150 KB gz home-JS budget is not achievable on Next 16.**
183.9 KB gz is effectively the framework floor here — React DOM + Next App
Router runtime dominate; our portal code is a rounding error. This matches the
audit's prediction (§15 risk: "performance budget is framework fiction") and
the daebak observation of ~121 KB gz in root main chunks alone on Next 16.1.6.

## Decision

Per §15's rule that M0 evidence replaces or confirms provisional budgets:

1. **Home transferred JS budget: ≤200 KB gz (hard, CI-enforced)** — measured
   183.9 KB + ~16 KB headroom for small portal chrome growth. Any analytics
   SDK must fit inside the same 200 KB or load strictly deferred/idle with its
   own ≤25 KB gz sub-budget (prefer a lite client; evaluate at M4).
2. Per-game JS chunk ≤100 KB gz and per-game art budgets are unchanged.
3. Revisit before M5 (paid traffic): options include trimming client
   components, React Compiler, and re-measuring on newer Next minors. If the
   floor drops, the budget tightens back down — the number follows evidence.
4. LCP/time-to-play remain device-measured gates (M1 floor-device pass), not
   inferred from transfer size.

## CI enforcement

`test:e2e` runs against the production build in CI; a bundle-report step
records the home script set + gzip total and fails the build above 200 KB.
(Wired in `.github/workflows/ci.yml` as the `bundle-budget` step.)

## Amendment (2026-07-17, M0 independent review — P1 correction)

The 183.9 KB figure was NOT valid browser-transfer evidence: the measurement
script counted a 38.6 KB gz `noModule` legacy polyfill chunk that modern
browsers never request. It also missed that game-card `Link` prefetch fired
`/play/claw` RSC requests on landing.

Corrections applied:

1. Measurement script now counts only scripts a modern browser executes
   (`nomodule` excluded). **Corrected home-JS floor: 145.3 KB gz.**
2. Game-card prefetch disabled (`prefetch={false}`) per §15's default.
3. **Budget revised: ≤200 KB → ≤175 KB gz (hard, CI-enforced)** — corrected
   floor + ~30 KB for portal growth and a deferred lite analytics client.
   The original 150 KB provisional was near-achievable after all; 175 keeps
   honest headroom instead of inheriting the inflated 200.
4. The decoded-memory and per-game budgets are unaffected.
