# Bias Flap — intake (Daidai delivery, 2026-07-27)

Status: **PORTED 2026-07-27.** Shipped sticks are Daidai's ORIGINAL art
per Mateo's directive (the interim star edit was reverted same day) —
the ⛔ BTS-mark public gate STANDS in the content register until
Daidai's corrected sticks land. Replaced the code-drawn flyer in the
`flappy` slot the way Snake Freebies replaced POCA Snake; server
`maxScore` 800 → 1700 (a RAISE, so no preflight needed — old rows stay
beatable). Reference build:
https://precious-arithmetic-db1e00.netlify.app/ (bias-flap at the root).

Source: `~/Downloads/bias-flap` (static site: index.html + 3 JS + 1 CSS +
5 assets, 304 KB). No build step, no JS dependencies. One external request
(Bungee via Google Fonts) which the port will drop — the shell self-hosts
fonts. Copied to gitignored `intake/bias-flap/`.

## Provenance (SHA-256)

| File                    | sha256                                                             |
| ----------------------- | ------------------------------------------------------------------ |
| `BACKEND_INTERFACE.md`  | `e3e70f999d45e3398cf2fbc83d75563a7136e46a7ef40d147873a17d979be124` |
| `PRODUCT_BRIEF.md`      | `62225682309e32e42a05a347fc9ba04a9b01f67b229b566f9b0bb1d3504bb03d` |
| `README.md`             | `0bc16cdb516703b304053455d8c3ccffc015f556e839d6b371414bbb51f1a4e6` |
| `assets/bg.jpg`         | `bd3944a079f4ba5ec7716a5359cb93458624174b24340e25c9e162354705e1f1` |
| `assets/coeur.png`      | `4d3103a0d61358de9ea3fe0edf5df95177a690cdc98097a993440baa8be0f449` |
| `assets/hero.png`       | `2dc13ad5eb2a5b923d8d0a754892358d2e855a3976824b4ce9a06786d87ea1a3` |
| `assets/stick_down.png` | `89cc04594ea5a750ae89f1b8835f9f65183f9807911993c2d03a409e50783172` |
| `assets/stick_up.png`   | `158a50036d6c9546591618b52fa36787786952b62d19fad30bfa60b8b6bad059` |
| `css/style.css`         | `e01ddc47eea3a1389b73ef934da7a0a70bec3fd69e949557d32fbb220a7e04d0` |
| `index.html`            | `688b72ad36f8d3968553948d206dbe419586fc1ca587c72e331673d656264ddf` |
| `js/backend.js`         | `a66493d2a0adf08a5c220fa0d987e3f7588319630df379ac3b48910b09d8fca4` |
| `js/config.js`          | `f5b6223163ec089f52b2e1c789fe778e98fd89ac4faf2168751608137668649d` |
| `js/game.js`            | `8df972d17eb4f7cc7ee6b18f6c2378d53a1212b4fed9504a077b03e490ecbe77` |

## Rights / IP — ⛔ ONE FINDING

Visual review of every asset (same standard as the frogger intake):

- `hero.png` — **clean**, original pixel stan girl. **Resolves the
  standing ⛔ on the current Bias Flap**: the code-drawn flyer was styled
  as a real BTS member (publicity-rights gate, EXT-LEGAL). Daidai's
  original character replaces it at the port.
- `bg.jpg`, `coeur.png` — clean (generic purple city night, hearts).
- `stick_up.png` / `stick_down.png` — ⛔ **the orb carries the BTS logo
  mark (the angular double-door emblem), and the black-handle/round-orb
  silhouette reads as the official ARMY Bomb lightstick.** This
  CONTRADICTS the PRODUCT_BRIEF, which claims a "generic lightstick
  design (star emblem) — deliberately not any real group's lightstick" —
  the delivered art does not match its own brief. Same class as the
  frogger `bg.webp` BTS marks: **RESKIN REQUIRED before public access**
  (swap the orb emblem for the promised generic star and ideally recolor
  the handle). Internal/preview use behind Vercel SSO only until then.
  RESOLVED AT PORT (2026-07-27): the SHIPPED `stick-*.webp` carry a
  Myosin pixel edit — the BTS mark in the orb is replaced with the
  generic five-point star the brief itself promised (same precedent as
  the Nicole claw-board edit; the intake originals are untouched
  evidence). Daidai's own corrected sticks are welcome to supersede the
  edit. With this, NO public-release gate ships with the port.

Grep over delivered code + copy: no band names or agency marks in text.
Flavour phrases are generic concert culture ("PAST THE MERCH STANDS!",
"SECURITY DIDN'T SEE YOU!").

## Mechanics (delivery, to preserve)

Flappy reinterpretation: a stan girl flies through giant lightsticks
toward the front row. Per `config.js` (all tuning lives there):

- **5 levels**: gates 6/8/10/12/14; scroll speed 2.4→3.2; gap height
  33.5%→27% of screen height. Spacing 0.60 of canvas width.
- **Fairness constraint**: consecutive gap centers shift ≤ 24% of screen
  height — no impossible sequences.
- **Crash = restart the CURRENT level**, unlimited retries, no lives;
  attempt score rolls back to the level-start value.
- **Cash-out**: ⏹ HUD button → confirm ("LEAVE THE PIT?") → run ends,
  score saved. Every run can post a score — the leveled structure needs
  an exit path the endless original didn't.
- **Scoring**: `10 × levelNumber` per gate → 10/20/30/40/50. **Perfect
  run = 1700** (60+160+300+480+700), only by finishing all 5 levels.
- **Timer** counts active play seconds (keeps running through crashes,
  pauses on overlays) — delivery tiebreaker `score DESC, time ASC`.
- **GATES stat** counts every gate passed INCLUDING retried levels (the
  reference screenshot shows 196 gates on a 50-gate perfect run).
- Hearts trail the hero on flap; victory = "FRONT ROW, BABY!" + confetti.
- CRT scanlines + vignette, consistent with Snake Freebies.

## Portal policy replacements (booked at intake)

- `backend.js` (2 plays/day + subscription + prize eligibility) will be
  DELETED — portal policy is OD-1 (one counted run per device per local
  day) + OD-3 (cosmetic boards). Same replacement as Snake Freebies.
- Gap-center placement moves to the run's seeded RNG (counted replay).
- The delivery's `setInterval`-style loop becomes the shell's fixed-step
  accumulator; intro screen → `introKeys` ready card; terminal panels
  stay IN-CANVAS via `endPresentation: "game-authored"` (the host adds
  Play Again, the Challenge CTA, and — since the audit P1 — the counted
  receipt/Retry-save block).
- Server `maxScore` for `flappy` moves to **1700** at the port (same
  pre-launch-window justification as snake 400→1950 and frogger 60→30).
- Cash-out maps to a game-initiated `report.end({ reason: "quit" })` —
  the host's generic-submit saves the score on any end reason; the
  confirm overlay is game-side (pointer zones + Esc/Enter keyboard
  routes). Victory reports `completed`.
- Timer/tiebreaker: the portal board ranks `score DESC, acceptedAt ASC`;
  the delivery wants `time ASC` among finishers. Decision needed at port
  time: adopt time as a secondary sort (schema change) or drop the
  tiebreaker for V1 (document as deviation).

## Port record (2026-07-27)

- `src/games/flappy/logic.ts` — pure core: level table verbatim, gap
  fairness (≤24% jump, seeded rng, ONE draw per obstacle, retries
  continue the stream), crash → 850ms beat → level restart with score
  rollback (`totalGates` never rolls back), cash-out via
  quitConfirm/keepFlying/cashOut, active-play clock (runs through
  crashes, frozen on overlays and unarmed waiting), win = exactly 1700.
- `render.ts` — cover-fit bg, stick pairs with the delivery's
  shaft-extension slice technique, velocity-tilted hero, heart trail,
  canvas HUD (LEVEL/GATES/TIME + ⏹ leave zone, 72×54 design px ≈ 60×45
  CSS at the 320 floor), in-canvas level-break / quit-confirm / terminal
  screens. Terminal screens stay visible via `endPresentation:
"game-authored"` — the host adds Play Again (disabled while a counted
  save is in flight), the Challenge CTA, and the counted receipt/Retry
  card.
- `module.ts` — ShellLoopGame; tap anywhere flaps (Space/ArrowUp/KeyW on
  desktop), ⏹ opens the confirm, taps outside the confirm zones do
  NOTHING (no accidental exits). Crash never ends the run; only victory
  (`completed`) or confirmed cash-out (`quit`) reports end — the host's
  generic-submit saves the score on both.
- Deviations (documented): the delivery's leaderboard tiebreaker
  `score DESC, time ASC` is NOT adopted — the portal board keeps
  `score DESC, acceptedAt ASC`; TIME is shown cosmetically on the end
  screens only (reviewer + DaiDai agreed for V1). CSS CRT/vignette page
  chrome and the DOM confetti are not ported (Snake Freebies precedent);
  canvas confetti can come later. Crash toast phrases cycle in order
  rather than randomly (i18n-keyed, cosmetically equivalent).

## Asset budget

Trivial: 5 assets, ~290 KB raw; bg.jpg dominates and will convert to
WebP well under the per-game transfer budget. No atlasing needed.
