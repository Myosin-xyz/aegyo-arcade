# Game Rules Seed — Cross to the Concert (Frogger)

**Status**: DELIVERY RECEIVED 2026-07-18 (13 days before the 2026-07-31 AoE
cutoff) — technical intake PASS. The DELIVERED LOCAL ARCHIVE is
authoritative (live deployments are reference only). SHA-256 manifest,
to be stored with the PSD + brief in Myosin shared storage:

```text
05f2d87de3acae554c1c31febea735502faa0ec36dcca0285e555cc9c8000f01  cross-to-the-concert_20.html
08c13fa539b9f12ebb62ea51eb4ef6f466ee303b76156afff08dec1bb785e307  crossed_the_street.psd
cec3cf93cdaaf74ad8d73c1fa9e9536e236081df8e5627d28b047294eb1799b4  cross-to-the-concert-brief_1.pdf
```

Formally ACCEPTED 2026-07-18: Daidai is a Myosin contributor (ADR 0006),
so no external rights confirmation applies; the hash-recorded local archive
above is the authoritative source, and shared-storage mirroring is
housekeeping, not a gate. Per this document's original note, the delivered
mechanics below are the acceptance rubric; the internal fallback design is
superseded unless acceptance fails.
**Surface**: `canvas` (shell loop after migration)
**Delivery**: `cross-to-the-concert/` (gitignored raw intake — brief PDF,
monolithic 781KB HTML build, 9.5MB PSD `crossed_the_street.psd`,
1024×1536, 8 clean layers/groups)

## Intake assessment (2026-07-18)

- Boots clean headless at 390×844: zero console/page errors, canvas
  painting, start screen with timer + best-time UI live.
- **Zero backend/auth references** — no Supabase/fetch/accounts code to
  delete (unlike Freebie Frenzy).
- UTF-8 clean, no mojibake. Single canvas + script, rAF loop,
  click + keydown input.
- 13 inlined data-URI images (PSD art) — migration exports external WebP.

## Product baseline (from Daidai's delivered brief + build)

- Framing: cross the street to reach the concert entrance.
- **Two moves only**: Forward / Backward — single axis, no sideways.
- **5 lanes, one obstacle TYPE each, fixed real-world directions**:
  golf cart (L→R), merch cart (R→L), scalper (L→R), K-food truck (R→L),
  roaming security guard (L→R). **The delivered build runs TWO instances
  of the type per lane** (review-verified) — the M3 rebuild preserves this
  density; halving it would be a silent difficulty change. Safety bollards
  are decorative only (drawn in front, no collision — matches PSD layer
  order).
- **3 lives**; a hit returns the hero to the start of the CURRENT level.
- **10 levels** with an EASED difficulty curve (1–3 nearly identical,
  ramp in the back half, always beatable — playtested for kids).
- Guard story beats: levels 1–9 end "ACCESS DENIED!"; level 10 ends
  "CONGRATULATIONS, YOU'RE WELCOME!" → win.
- **Stopwatch** (m:ss) runs per attempt; stops on win/lose; best time on
  start/win screens with new-best callout.
- Score = progress (lanes crossed / levels reached).

## Portal policy replacements (booked at intake)

The brief's platform sections are REPLACED by adopted arcade policy —
Daidai's brief itself scopes them out as "separate backend work item":

| Brief assumption                        | Portal reality                                                 |
| --------------------------------------- | -------------------------------------------------------------- |
| Subscription + username accounts        | Pseudonymous device session (§8.1)                             |
| 2 attempts/day, 24h cooldown            | OD-1: one counted run per player-local day, unlimited practice |
| Weekly contest with prizes              | Cosmetic weekly boards only (OD-3); prizes require §13.3       |
| Client-side best time                   | Portal counted-run API; `server_elapsed_ms` already recorded   |
| Leaderboard payload username/score/time | Shared board policy (competition ranking, flagged exclusion)   |

**Ranking DECIDED (review, 2026-07-18)**: M3 preserves the delivered
progress score, **envelope 0–60**, under the existing competition-ranking
policy. Fastest time stays cosmetic/local initially. `server_elapsed_ms`
is NOT a tie-break — it includes issuance, menus, pauses, and network
time. A shared timed leaderboard requires a separate ADR with a
shell-measured active-duration design.

## Migration requirements (mirrors M2.5 Freebie Frenzy pattern)

- Rebuild as a `ShellLoopGame` on frozen contract v1: pure deterministic
  logic, `run.random` for obstacle spawn patterns, fixed-step updates,
  `InputBus` (tap zones for FORWARD/BACK + arrow keys), pause/restart/
  destroy, `report.score/end`.
- Export external WebP assets from the PSD; drop the monolithic HTML.
- Centralize strings (guard copy is i18n-able; fan terms stay English).
- Deterministic vectors: eased per-level speed table, seeded obstacle
  spawn sequences, collision/checkpoint reset, one-credit-per-lane
  scoring, guard-beat transitions, level-10 completion, 3rd-life loss,
  end-at-most-once, seeded replay.

## Ported constants (delivery-verified, M3 build 2026-07-18)

- Playfield **360×467** + delivered control strip (480×113 → 360×85);
  designBox 360×552. `ROW_FRACS = [0, .3474, .4521, .5546, .6586, .7641,
.8943, 1]` → 7 rows: goal, 5 lanes, start. Hero fixed `x=180`,
  half-width 9, targetH 30; **6 forward steps** start→goal.
- Lane table (base px/tick at 60Hz, direction, draw targetH, native px):
  golf `0.62 → L→R, 40, 147×104`; merch `0.38 ← R→L, 34, 178×124`;
  scalper `0.55 → L→R, 32, 143×109`; kfood `0.38 ← R→L, 34, 206×120`;
  guard `0.58 → L→R, 34, 83×128`. **2 instances/lane, always** at
  `180·i + seeded·40` jitter (the delivery's ONLY RNG), re-rolled each
  level. Independent wrap at `±drawW` past the edges.
- Linear ramp `speedMult(L) = 1 + (L−1)/9` — 1.0× at L1 → 2.0× at L10,
  +1/9 per level (L1–5 = 1.00, 1.11, 1.22, 1.33, 1.44). **Team tuning
  2026-07-24**: replaced the delivery's eased `1 + ((L−1)/9)^1.6` curve,
  which was flat over the early levels so players never felt the
  difficulty climb (Daidai feedback). This is a deliberate design change
  from delivery parity, not a port bug; portal ranking stays
  progress-based (fastest time cosmetic — the intro must not claim
  "fastest time wins").
- Collision: 1-D on the hero's row, hit iff `|x − 180| < 9 + 0.3·drawW`;
  90-tick invuln with blink; hit → hero to start row of CURRENT level,
  obstacles NOT reset, bestRow retained (no re-earning), stopwatch keeps
  counting.
- Checkpoint beat: 105 ticks, obstacles frozen, ACCESS DENIED (L1–9,
  then level++ + lane re-roll) / CONGRATULATIONS (L10 → won).
- Scoring: `newRow < bestRow` credits the difference; monotonic;
  **6/level, hard max 60** — the L10 6th point lands before the congrats
  beat, so a perfect run submits exactly 60.
- Stopwatch: sim ticks → m:ss (checkpoint beats count, delivery parity;
  pause does NOT — an improvement over the delivery's wall-clock).

### Port adaptations (documented deviations)

1. Delivery ran per-frame constants with `dt=1` (frame-rate dependent);
   port fixes 60Hz ticks — reproduces intended 60fps behavior.
2. Best-time/best-score persistence (delivery `window.storage`) DROPPED
   for now — no shell KV store; the BEST HUD box renders "-". Revisit
   with a shell-provided local-stats API.
3. Win/lose overlay cards replaced by the host end panel; guard-beat
   overlays (the delivered art) are in-canvas and kept.
4. "Ticket van" was comment/copy-only in the delivery (never
   implemented) — not ported. Win-animation stub was a no-op — not
   ported.
5. Sprite facing: golf + scalper flip when moving L→R (art faces left);
   exact flip parity folded into the post-reskin visual QA pass.

## IP flag — BTS marks in the delivered background (⛔ public-release blocker)

The delivered stage scene bakes in the BTS logo, "BTS WORLD TOUR LIVE IN
SEOUL" gate text, and branded tour buses/lane banners. Classification
(review, 2026-07-18): **public-release blocker, NOT an M3 implementation
blocker** — M3 can receive a technical pass with this open; organic soft
launch cannot. Decision: **reskin, not BTS permissions.** The full
workflow (preserve original archive/hashes, register derived assets,
build with delivered art behind SSO, replace marks, re-run visual/device
QA, sweep thumbnails/screenshots/OG/cached exports) is booked in
[docs/CONTENT_REGISTER.md](../CONTENT_REGISTER.md).

## Intake gates — resolved (ADR 0006)

- [x] Rights: internal Myosin work product; no external confirmation needed
- [ ] Housekeeping (non-blocking): mirror archive + SHA-256 manifest to
      Myosin shared storage (raw intake stays gitignored; the local
      archive is authoritative)
