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
3. **Frogger delivery cutoff: end of day Friday 2026-07-31 (AoE) — an
   ABSOLUTE acceptance deadline.** It does not restart or slide based on when
   the intake package is sent. If no conforming delivery has been accepted by
   the cutoff, the internal Frogger fallback **triggers automatically — no new
   approval round**. A late delivery may still replace the internal version if
   it clears intake, including the rights confirmation.

### Amendment (2026-07-17, same day): Daidai is not a critical dependency

Daidai's Frogger is an optional accelerator and an independent compatibility
test — nothing more. M1, M2, M3 (via the authorized internal fallback), and
all launch-hardening stages complete without her delivery. M1 starts now,
uncoupled from Frogger.

**Contract-freeze substitution**: TECH_SPEC §6.1 names Frogger as the second
external compatibility check before contract v1 freeze. If no conforming
Frogger arrives, the contract stays **v0 through M2**, and the independent
production compatibility checks become **Hangman (`dom` surface) plus Flappy
(`canvas`, shell loop)** from the Nicole-derived set. Freezing v1 on that
basis is recorded here per this amendment. Internal Frogger rules and asset
direction are prepared now (`docs/games/frogger.md`) so the fallback starts
from a spec, not a scramble.

## Context

Safe defaults adopted 2026-07-17 (spec §3.1): portal-wide counted run per
player-local day, cosmetic boards, visual streaks, gameplay-only claw,
organic-soft-launch-after-retention-loop, paid traffic at M5. All are the
off/reversible positions, which is what makes proceeding without stakeholder
confirmation defensible.

## Human actions still required

- Send `GAME_INTAKE.md` + `CONTRIBUTOR_RIGHTS.md` note to Daidai (the
  2026-07-31 AoE cutoff is absolute per the amendment below — send today so
  she has maximum runway).
- Send `CONTRIBUTOR_RIGHTS.md` note to Nicole.
- Obtain DNS/Vercel/Railway org access before M3 soft-launch eligibility (Railway per ADR 0004).
- Brief Simon before anything public (OD-2).
