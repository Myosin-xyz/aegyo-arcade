# ADR 0003 — Claw cutover plan out of daebak-markets

**Date**: 2026-07-17
**Status**: Accepted (execution pending EXT-OPS DNS + parity walk)

## Current state

The claw exists in three places:

1. `daebak-markets/apps/aegyo-claw/` — original Vite source (+ 34MB PSD
   master, gitignored, local-only).
2. `daebak-markets/apps/web/public/aegyo/` — built static copy served at
   `www.daebakmarkets.com/aegyo` (how aegyoarena links it today).
3. `aegyo-arcade/src/games/claw/` — migrated engine (M0/M1 refactor:
   load/run split, pause/resume, idempotent destroy, server outcome,
   rescaled WebP assets). **This is canonical going forward.**

## Cutover order (TECH_SPEC §7.1.7 — deploy → redirect → observe → remove)

1. **Deploy new URL** — `/play/claw` live on the arcade deployment. DONE
   (Vercel preview). Public URL waits on `arcade.aegyoarena.com` DNS
   (EXT-OPS).
2. **Update/redirect links** — once DNS exists: aegyoarena.com claw links
   point to `arcade.aegyoarena.com/play/claw`; add a redirect from
   `daebakmarkets.com/aegyo` → the arcade URL (next.config redirect in
   daebak's web app, human-committed there).
3. **Observe** — parity walk on real devices (Mateo) + a soak window with
   the redirect in place; watch arcade `game-init failure` logs.
4. **Remove** — separate human-committed PR in daebak-markets deleting
   `apps/aegyo-claw/` and `apps/web/public/aegyo/`. Keep the redirect.
   Deletion is NOT the cutover mechanism; it is the last step after the
   redirect has soaked.

## PSD custody (spec §7.1.4)

`claw_machine_clean.psd` (34MB) lives only on Mateo's machine at
`daebak-markets/apps/aegyo-claw/`. Before the daebak deletion PR: upload to
Myosin shared storage (Drive), record SHA-256 checksum + rights/provenance
note in the arcade asset register, and update `scripts/export-claw-layers.py`
docs to point at the shared copy. The asset pipeline is now:
PSD → `export-claw-layers.py` (PNG @ export scale) →
`rescale-claw-assets.py --factor 0.70 --quality 74` (WebP + scaled manifest).

## Blockers before step 4

- [ ] EXT-OPS: `arcade.aegyoarena.com` DNS
- [ ] Device parity walk (Mateo) on the rescaled WebP assets
- [ ] PSD uploaded to shared storage with checksum recorded
