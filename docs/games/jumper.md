# Game Rules — Comeback Climb

**Status**: IMPLEMENTED — DaiDai delivery port (2026-08-03)

**Surface**: `canvas`, shell-owned fixed 60Hz loop

**Reference box**: 360×640 logical px
**Source of truth**: local gitignored `comeback-climb/` delivery; Netlify is
the visual reference. The prior M2 code-drawn jumper is superseded.

## Product rules

- Auto-bounce from chart rank **#100 to #1**; 99 ranks, 10 points each.
- Three lives. A fall or paparazzi-drone hit respawns on a safe platform
  after 700ms with 150 simulation steps of invincibility; the clock keeps
  running through the beat.
- Tutorial ranks #100–#91 contain static neon platforms only.
- Later zones introduce moving CDs, two-hit breakable photocards, and
  drones using the delivery's exact probability/gap table.
- Speakers give a ×1.65 bounce. A golden mic attracts notes for 360
  steps. Hearts refill a life or score +50 at full lives. Notes score
  +5/+10/+20.
- Every mechanical random draw uses `RunContext.random`. Equal seed and
  input replay exactly.

## Mobile controls (portal adaptation)

The delivery's two visible 74px hold buttons are intentionally replaced
for the 95%-mobile-social audience by an invisible four-zone surface:

| Touch x         | Effect                                |
| --------------- | ------------------------------------- |
| outer-left 25%  | large impulse left (90% of max speed) |
| inner-left 25%  | small impulse left (42%)              |
| inner-right 25% | small impulse right (42%)             |
| outer-right 25% | large impulse right (90%)             |

One pointer-down produces one impulse: near the centre is a small course
correction; nearer an edge is a committed jump. The zones have no visual
overlay and therefore never cover the playfield. Arrow/A-D/Q hold
steering stays as a desktop/accessibility enhancement. Pause and restart
clear held keys.

## Score envelope

The rank component is `(100 - rank) × 10`, 0–990. The delivered backend
brief bounds collectible/full-life points at 1,500, so the portal accepts
integer scores from 0 through **2,490**. The old 99-point implementation
is replaced before public contest use. This is an upward cap change: old
rows remain valid and cannot exceed the new run; no rejection/backfill is
required. Time remains cosmetic under the shared V1 board policy.

## Delivery adaptations

- `Math.random()` → seeded run RNG for layouts, pickups, notes, hazards,
  and safe deterministic replay.
- Delivery `requestAnimationFrame` + `setInterval` → shell fixed-step
  loop; the shell owns pause/resume/destroy.
- Delivery backend, username, subscription, two-plays/day, and prize
  assumptions are deleted. Portal device sessions and OD-1 counted runs
  own access and submission.
- The delivered PNGs are repeatably exported as 13 lazy WebPs by
  `scripts/export-comeback-climb-assets.sh` (about 104KB total).
- Game music is lazy host presentation audio; synth SFX remain on the
  frozen `AudioBus`.

## Required vectors (implemented)

1. Exact zone/progression/bounce constants.
2. Seeded world equality, reachable gaps, no consecutive photocards.
3. All four invisible thumb zones and impulse strengths.
4. Delivered keyboard acceleration/friction/max-speed behavior.
5. Photocard crack-then-break sequence.
6. Rank scoring and #1 completion.
7. Life loss, 700ms safe respawn, invincibility, and running clock.
8. 2,490 score cap.
9. Identical seeded replay.
10. Real module input routing, pause cleanup, terminal red-flash hold,
    restart, and end-at-most-once.

## Intake hashes

Core delivery:

- `README.md` — `e6e1031ca8fbe793fb2ef5622469172147b75aee736f2fd4d1802aca462eb229`
- `PRODUCT_BRIEF.md` — `4add6671702caf753423662d6dbc292a38d62fb1869cef1c142dbabad66376ca`
- `BACKEND_INTERFACE.md` — `14341f860932e0a941cc80dec490c149c76999e375e23488d5533326507dbf62`
- `js/config.js` — `ab986e9303b0293efb7bcf1b72fd95864ee4f16a5419511adab222e5cd956cab`
- `js/game.js` — `65e57bae0bfa7285f51991994ac68d2f82de220d4ca605fa057ae0fe96fccb57`
- `css/style.css` — `544460347780dd5ae26c32fa6875c48539c2bd5f37bb26e7ebe6094ca9f4e848`

The complete 21-file manifest is committed as
`docs/games/comeback-climb-intake.sha256`; the raw folder stays
gitignored and is never served by Next.js.
