# Snake Freebies — intake (Daidai delivery, 2026-07-26)

Status: **PORTED 2026-07-26.** Mateo's call: Snake Freebies REPLACES the
POCA Snake placeholder in the `snake` slot (server `maxScore` 400 → 1950).
The retired seed doc is docs/games/snake.md.

Source: `~/Documents/myosin/snake-freebies` (static site: index.html + 3 JS +
1 CSS + 22 PNGs). No build step, no JS dependencies. One external request
(Bungee via Google Fonts) which the port drops — the shell self-hosts fonts.

## Provenance (SHA-256)

Raw delivery stays OUT of git (gitignored `intake/`); this is the record.

| File                   | sha256                                                             |
| ---------------------- | ------------------------------------------------------------------ |
| `index.html`           | `8e62136c35f4d9c5b317041a983e2d316e59a31948fbdb934549c4714ca83cc2` |
| `css/style.css`        | `9d08f17d645d6555edb471d85714f4411f1f6ed248f9656d1b9884bc2fe1008d` |
| `js/game.js`           | `1717868d968156ad1108ae44a6540b8fbc2a15ddf70fdca64e02a25474e2afe5` |
| `js/config.js`         | `ed42e1f2e5fa1424d770a4e9f6c321d740578017943f93018e2fa95cadac47db` |
| `js/backend.js`        | `70d7773b8242cbe2b1390e5d9b2f94bf63c64a954da537846ffaab7e53a51f5c` |
| `README.md`            | `a9f9300a341b287be71f1a06f20199c4b04ff0bd52ec5a790b6f8d15b01c6559` |
| `PRODUCT_BRIEF.md`     | `6d174d9e7a22a7172b5205ee81c0d552dedc512d77d50e9f413e78e8dcc65094` |
| `BACKEND_INTERFACE.md` | `d268bee93509a9bd03158f781a015878f48d83a87eb0b3a6edea846c6f83edd2` |
| `assets/head.png`      | `cf84e47158ce17052a8fd7ed4f188146f4193f021cd46d881b92cbd32058bdb3` |
| `assets/gift.png`      | `994275bef9182555186c32efd17c047c4c3a7efec1810b3d198863d8136cbbf1` |
| `assets/frame.png`     | `0ca16d742e9dd232d2df8fc1b3a13e656c97cf65413bde6833781fd058478910` |
| `assets/freebies/f00`  | `197329ba608a4aefff88215593b9b498bf60ba176e147ccfcf1307d77980d58b` |
| `assets/freebies/f01`  | `7e3733e39e81f6530ceae078104824ab5f9bf8790370697a0c467c564942f1ae` |
| `assets/freebies/f02`  | `a363f18818b337626e26913d75cee2da11620532fc98d2527e4a63f12b235e99` |
| `assets/freebies/f03`  | `abdc1951e0906d5f42ad91eff9965efb56f2b4c642433e83e0ce28284fe0a3fd` |
| `assets/freebies/f04`  | `d9cc179d470959971018c03daef96e7400006f6e9cf93c184bd43fee41efce30` |
| `assets/freebies/f05`  | `e5aa96524eeba76c38c182c9e63a585e8761426a80520cb12be32127b577e1c8` |
| `assets/freebies/f06`  | `06e0c572c3f13a6616609757be3e920c5c43193a8b683f24c36a941d5839de61` |
| `assets/freebies/f07`  | `7483ca10c99932ffec75243f043c8432d7fc0d1316c5d75d8001250500e5d19a` |
| `assets/freebies/f08`  | `d3f3b7635d0cd518265e7c429e50dd02244fbfaea2e90f8718b03140fdab17d1` |
| `assets/freebies/f09`  | `ad75ede0e72391d46f3bd9fbdfa733c22380a4225a0b53b3fe9b4eb8c388a2f7` |
| `assets/freebies/f10`  | `eff4e5aa176a067c323a592ba3f793d7b3d4895beef55b69e2978ea7e24df33a` |
| `assets/freebies/f11`  | `84c7c3fff5e0e1898b0d692ce6d1236649171e96890c17adcb528aae034d7c74` |
| `assets/freebies/f12`  | `f78e7fa2ae5544f7dc89eef1b7cef769aa720291b8ab609250000d3a20992d58` |
| `assets/freebies/f13`  | `0bf9acb2237805f3009dcf69fb5f1271d365499c390583286a7f0dd3c6e92776` |
| `assets/freebies/f14`  | `12af9b7ba072137fbb1216e6abfc69fecde0732b4363ef595649d5392dedd58d` |
| `assets/freebies/f15`  | `a81ae9c975ce93868223a0cc5459dd5482046be8e52a49ec9e8923d159bf72fe` |
| `assets/freebies/f16`  | `3d1b7fb139d047272716b6951962a2ce56dbe89f29a7ffdf85aa00e743959288` |
| `assets/freebies/f17`  | `4bd5e720db80c22fb7f2c2c9c6b5d77077cdb8bd97a67c808a82e4eff4ec1b0b` |
| `assets/freebies/f18`  | `d044b1f06c4768b232008cc4d35110bf9b91911016b3316a070b067f562e90e7` |

## Rights / IP

**Clean.** Grep over all code + copy finds no band names, groups or agency
marks. All 21 sprites are generic fan-culture objects (gift box, album,
teddy, bunny plush, friendship bracelet, love letter, balloon, photocards,
tote, polaroid, lightstick, VIP ticket, four-leaf clover, beads, boba,
heart lollipop, mic, keychain). Author: Daidai, rights basis internal
(ADR 0006). No ⛔ gate — unlike the frogger background.

## Mechanics (delivery, to preserve)

- **3 levels, one fixed 13×13 arena.** Targets 10 / 25 / 45 freebies;
  tick 180 / 150 / 125 ms. Difficulty = chain length + speed, not layout.
- **3 lives per level** (reset each level start). Death = wall or self.
- **Death PRESERVES the chain**: respawn at centre at FULL length, the
  chain re-emerges behind the head tick by tick (`growPending`). Only a
  new level resets to `startLength = 3`. Freebie counter preserved too.
- **Score** = `10 × levelNumber` per freebie (10 / 20 / 30). **Perfect run
  = 1950** (10·10 + 25·20 + 45·30).
- **Timer** counts up across the whole run, MM:SS — leaderboard tiebreaker
  in the delivery's model. It FREEZES during the 900 ms death beat and at
  level breaks: the delivery clears both its tick and timer intervals
  there, so a nonterminal collision costs a life, not clock.
- **A respawn restarts the movement interval.** The delivery clears and
  re-creates its tick interval on death, so the first step after the beat
  waits a full period. Our accumulator is zeroed in `respawn()` to match —
  carrying the partial tick that was in flight at the collision would make
  the snake lurch early on the comeback.
- Freebie sprites append tail-side in fixed order f00→f18, cycling.

## Asset budget

Trivial: 22 PNGs, **37 KB total**, largest sprite 304×304 (the neon frame),
the rest ≤ 25×22 pixel sprites. No atlasing or quality tuning needed — the
opposite of the claw's 344/350 KB squeeze.

## Mobile posture (Simon 2026-07-26: 95% of traffic is IG/TikTok in-app)

Delivery already: viewport meta with `user-scalable=no`,
`touch-action: manipulation`, swipe anywhere, plus an always-visible
d-pad on `pointerdown` (zero-latency, not click). Good baseline.

Port must additionally satisfy our own mobile rules, which the delivery
does not know about:

- Arena sizing goes through the shell's `CanvasSurfaceManager` (design-box
  letterboxing + DPR cap), NOT the delivery's `resize` handler — that is
  what makes it correct in an in-app browser whose viewport lies.
- `vh` units are banned in our shell (M2 Phase 7: `100dvh` only) — the
  delivery uses `110vh` in a confetti keyframe; the port drops that CSS
  entirely (confetti is canvas-side here).
- Verify at the 320 px floor and at 375/390/412/430, per the Phase 7
  mobile sweep, before sign-off.

### D-pad sizing — the letterbox is HEIGHT-limited (review P2)

The first cut sized the buttons at 46 design px and reasoned about the
320 px viewport WIDTH. That was the wrong axis: on a tall phone the
canvas is limited by HEIGHT, so the scale factor is `canvasH / 640`. At
the measured 320×568 worst case the canvas is 298×531 → scale 0.83,
turning 46 design px into **38 CSS px** with only 15 px of clearance
under the Down button — inside a typical 34 px iOS home-indicator inset.

Buttons are now a connected **58 design px** controller cross centred at
y=528, which at that same viewport gives ≈48 CSS px with ≈45 px of
clearance. This also restores the delivery's cyan-outlined controller
appearance instead of four visually unrelated shell buttons.

Two tests guard this, at different levels. `tests/unit/snake-module.test.ts`
pins the design-space CONSTANTS against the captured 531 px canvas height —
cheap, but blind to a host-layout change that shrinks the real canvas
underneath correct constants. `tests/e2e/snake-touch-targets.spec.ts` loads
the game at 320×568 in a real browser and derives both numbers from the
canvas's live `getBoundingClientRect()`, which is what actually guards the
thumb.

### Swipe timing (review P1)

The delivery turns during `touchmove`, as soon as travel crosses its
threshold. The first cut resolved only on finger-up, which at level 3's
125 ms cadence can cost several ticks on a held swipe — the wrong
tradeoff for the primary mobile control. The port now resolves on `move`
at the threshold and clears the origin so one drag yields one turn;
`up` remains a fallback for a flick too quick to report a move. A
CANCELLED gesture still queues nothing.

## Port plan (shell migration, M2.5/M3 precedent)

1. `logic.ts` — pure deterministic core (grid, snake, growPending, levels,
   lives, scoring). Seeded RNG from `RunContext.random` for food placement;
   the delivery uses bare `Math.random`.
2. `render.ts` — canvas draw over state (arena, frame, chain sprites, food).
3. `module.ts` — `ShellLoopGame` (fixed-step accumulator driving the
   delivery's tick cadence; the delivery uses `setInterval`, which the
   frozen contract does not allow).
4. Intro/level/gameover/victory SCREENS are the host's, not the game's:
   the intro maps to the ready-card `introKeys` mechanism added
   2026-07-25; the terminal panel is the host's ended overlay.
5. `backend.js` is DELETED — counted runs, play limits and score
   submission are the portal's (`/api/runs`), server-enforced. The
   delivery's 2-plays/day + subscription model does NOT apply: portal
   policy is OD-1 (one counted run per device per local day) and OD-3
   (cosmetic boards, no prizes).
6. i18n: all flavour text (`phrases.level/gift/over`) becomes locale keys
   in EN + es-419; fan lexicon stays English per §12.1.
7. Server `COUNTED_GAMES` entry with `maxScore: 1950`.

## Scope decision (settled 2026-07-26)

REPLACED the POCA Snake placeholder rather than adding a 9th game:
TECH_SPEC §5 listed our snake as a "Nicole mock" to "rebuild against
shell", and this is that rebuild. Two Snakes in one catalog would also
double the QA surface. Server `maxScore` 400 → 1950; safe now because
prod tables are EMPTY (scrubbed 2026-07-19) and the portal has never
launched publicly, so no real leaderboard rows were invalidated — that
window closes at launch.

## Presentation parity pass (2026-07-26)

The first shell port preserved mechanics but dropped too much of DaiDai's
appeal. The follow-up restores the delivery's personality without changing
the frozen runtime contract:

- Registry-driven ready card with the neon title/subtitle, illustrated
  rules card, synthwave sky, sun and animated floor. Counted/practice mode
  selection remains host-owned and no run starts early.
- Procedural synthwave canvas backdrop, neon two-row HUD, authored frame,
  connected controller D-pad, deterministic catch callouts, and the
  delivery's short red-flash/shake collision beat.
- All new copy ships in EN + es-419 and uses the self-hosted arcade font;
  the game itself adds no Google Fonts or other third-party runtime requests.
- Gift callouts rotate by the in-level gift ordinal instead of consuming
  `RunContext.random`, so visual flavour cannot perturb counted replay.

Still deliberately host-authored: terminal score/receipt and Play Again.
The delivery's game-over phrase and victory confetti would require a
game-authored finale before `report.end`; they are not simulated behind
the host overlay.
