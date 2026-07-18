# ADR 0006 — Daidai is a Myosin contributor; external-rights gates dissolved

- Status: accepted
- Date: 2026-07-18
- Decider: Mateo (relaying the working arrangement)

## Context

The M2.5 (Freebie Frenzy) and M3 (Cross to the Concert) intake records
treated Daidai as an external artist, gating each migration on (a) a
written rights confirmation and (b) archival of the authoritative source
in Myosin shared storage before implementation could start.

Mateo has clarified: **Daidai works with Myosin under the same arrangement
as the rest of the team.** The deliveries are Myosin work product, exactly
like the code in this repo. There is no external rights-holder to confirm
against.

## Decision

1. The **rights-confirmation gates are removed** for Freebie Frenzy (M2.5)
   and Cross to the Concert (M3). No outbound rights note is required.
2. **Archival is demoted from acceptance gate to housekeeping.** The
   authoritative acceptance source remains the LOCAL archives already
   intaken and hash-recorded (SHA-256 manifests in the intake records /
   `docs/games/frogger.md`); copying them to Myosin shared storage is
   recommended redundancy, not a blocker.
3. CONTRIBUTOR_RIGHTS.md / GAME_INTAKE.md keep their process for genuinely
   external contributors; Daidai deliveries follow the internal path.
4. The same internal path covers Nicole's mock contributions, which have
   been treated as Myosin work product since M0 — TECH_SPEC §§3.1, 7.4,
   12.2, 21.2 now distinguish internal work product from genuinely
   external contributions (asset-provenance register applies to both).

## Consequences

- M2.5 implementation starts immediately (2026-07-18).
- M3 (Frogger) has no remaining intake gates; the 2026-07-31 AoE cutoff
  (ADR 0001) now only bounds the build itself.
- If the working arrangement with Daidai changes, revisit this ADR before
  the next intake.
