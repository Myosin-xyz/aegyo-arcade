# GAME_INTAKE — External Game Delivery

**Version**: 1.0
**Audience**: Daidai and future external game contributors
**Purpose**: Make a game easy to integrate into Aegyo Arcade without asking the contributor to reproduce Myosin's runtime or QA process.
**Delivery cutoff (Frogger)**: end of day **Friday, July 31, 2026** (any timezone). This date is fixed regardless of when you receive this document. If a delivery hasn't been received and accepted by then, Myosin builds an internal version so the launch date holds — a late delivery can still replace it later if it clears intake.

## What to send

1. One source folder or repository with readable, unminified code.
2. A short `README` containing exact run/build commands.
3. The game's objective, scoring rule, start condition, end condition, and restart behavior.
4. Every source asset, plus its author/source and any third-party license or restriction.
5. A list of player-facing strings or a single file containing them.
6. The intended portrait reference size and any devices/browsers already tried.
7. Known bugs, unfinished work, and any behavior that must not change.

Please do not spend time producing bundle-size, decoded-memory, or device-performance reports. Myosin owns those measurements after delivery.

## Source requirements

- UTF-8 encoding.
- No opaque minified-only delivery.
- No external CDN, font, analytics, ad, or script dependency.
- No secret/API key in source or assets.
- Relative/local asset paths; no dependency on a contributor's computer.
- A clean build or direct local run from the documented command.

## Game behavior

- Portrait-first responsive layout with a declared logical/reference box; do not assume device pixels.
- Pointer/touch is the primary input. Keyboard may be an enhancement; hover cannot be required.
- Player-facing controls should meet a 44×44 CSS-pixel target where practical.
- The game can start again without reloading the page.
- Pause/background behavior is described.
- Timers, animation frames, global listeners, audio contexts, and mounted DOM are identified so Myosin can adapt and tear them down.
- Score and end conditions are deterministic enough to test from written examples.

You do not need to implement Aegyo Arcade's `GameDefinition`, `InputBus`, or `AudioBus`. Deliver honest standalone source; Myosin will adapt or refactor it at the integration boundary.

## Strings and content

- Centralize player-facing strings rather than scattering them through rendering/game logic.
- K-pop fan terms such as bias, maknae, comeback, aegyo, fanchant, and lightstick may remain English; surrounding instructions and hints will be translated.
- Do not include artist/member names, photos, logos, album art, lyrics, or third-party merch imagery without written rights evidence.
- Identify every excluded or third-party item explicitly.

## Rights confirmation

Complete the confirmation in `docs/CONTRIBUTOR_RIGHTS.md` for the delivered code, art, copy, audio, and other assets. Delivery is not accepted for release until the rights record is complete.

## Myosin acceptance work

After receipt, Myosin will:

1. Run/build the source and inventory dependencies/assets.
2. Decide adapter versus source refactor against the runtime contract.
3. Measure transfer size, decoded memory, canvas allocations, and time-to-play.
4. Run lifecycle/leak and device-floor tests.
5. Extract/localize strings and perform accessibility/content review.
6. Record rule vectors and integration changes in `docs/games/<gameId>.md`.

Acceptance means a reproducible source delivery with clear rules and rights—not that the contributor has already completed Myosin's production QA.

## Delivery record

```text
Contributor:
Game/title:
Delivery URL or archive:
Source revision/date:
Reference size:
Run command:
Known issues:
Third-party/excluded material:
Rights confirmation received:
Myosin intake owner:
```
