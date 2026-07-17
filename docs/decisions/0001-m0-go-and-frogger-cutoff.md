# ADR 0001 — M0 go, adopted defaults, Frogger cutoff

**Date**: 2026-07-17
**Decider**: Mateo Daza
**Status**: Accepted

## Decision

1. M0/M1 implementation starts now under TECH_SPEC v0.2.1 §3.1 adopted defaults,
   without a Simon decision memo. Stakeholder input is sought as opinion later;
   any change arrives as a versioned override ADR, not a blocker.
2. M0 deploys to a Vercel preview URL. `arcade.aegyoarena.com` DNS (`EXT-OPS`)
   and Simon's sign-off on public exposure (OD-2 soft launch) remain
   **pre-public-launch gates**, not build gates.
3. **Frogger delivery cutoff: end of day Friday 2026-07-31 (AoE).** The cutoff
   is written into `GAME_INTAKE.md` so the sent package carries it. If a
   conforming delivery is not accepted by the cutoff, the internal Frogger
   fallback builds in M3 per OD-8. A late delivery may still replace the
   internal version if it clears intake.

## Context

Safe defaults adopted 2026-07-17 (spec §3.1): portal-wide counted run per
player-local day, cosmetic boards, visual streaks, gameplay-only claw,
organic-soft-launch-after-retention-loop, paid traffic at M5. All are the
off/reversible positions, which is what makes proceeding without stakeholder
confirmation defensible.

## Human actions still required

- Send `GAME_INTAKE.md` + `CONTRIBUTOR_RIGHTS.md` note to Daidai (cutoff clock
  starts at send; send promptly so the 2026-07-31 date stays fair).
- Send `CONTRIBUTOR_RIGHTS.md` note to Nicole.
- Obtain DNS/Vercel/Neon org access before M3 soft-launch eligibility.
- Brief Simon before anything public (OD-2).
