# Asset & Content Provenance Register (TECH_SPEC §12.2)

Every shipped asset/content item: author, source, rights basis, permitted
use, and review status. Rights basis "internal" = Myosin work product
(ADR 0006). Raw deliveries stay gitignored and hash-recorded in the
per-game intake docs; this register tracks the DERIVED assets that ship.

**Open public-release blockers are marked ⛔.** M-milestone implementation
may proceed with them open; organic soft launch may NOT (per review,
2026-07-18).

| Derived asset(s)                                    | Author | Source archive (hashes)                                  | Rights basis                                 | Status                                                                                                                                                                                                                                |
| --------------------------------------------------- | ------ | -------------------------------------------------------- | -------------------------------------------- | ------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| `public/games/claw/*` sprites + manifest            | Daidai | claw PSD (M0 intake)                                     | internal                                     | Cleared — original art, Aegyo branding only                                                                                                                                                                                           |
| `public/games/freebie/*.webp` (9)                   | Daidai | `files_freebie_frenzy/` (docs/games/freebie.md manifest) | internal                                     | Cleared — original art; "Aegyo Arena" is our own mark                                                                                                                                                                                 |
| `public/games/frogger/bg.webp`                      | Daidai | `cross-to-the-concert/` (docs/games/frogger.md manifest) | internal art, **third-party marks depicted** | ⛔ **BTS logo + "BTS WORLD TOUR LIVE IN SEOUL" + branded buses/banners baked into the stage scene. RESKIN REQUIRED before public access** — see workflow in docs/games/frogger.md. Internal/preview use only while Vercel SSO stands. |
| `public/games/frogger/merch.webp`                   | Daidai | same                                                     | internal                                     | Review at reskin QA: stylized "M" shirt marks — likely generic, confirm not a real-group mark                                                                                                                                         |
| `public/games/frogger/*` remaining 10 WebP          | Daidai | same                                                     | internal                                     | Cleared — hero, guards, golf/scalper/kfood, bollards, speech-bubble overlays carry no third-party marks                                                                                                                               |
| Hangman dictionary (`src/games/hangman/content.ts`) | Myosin | Nicole mock + internal edits                             | internal                                     | Cleared — generic fandom vocabulary, §12.2 item 4 reviewed                                                                                                                                                                            |
| Portal copy (`src/i18n/locales/*`)                  | Myosin | this repo                                                | internal                                     | Cleared                                                                                                                                                                                                                               |

## Reskin workflow for the frogger background (booked 2026-07-18)

1. Daidai's original archive + SHA-256 manifest stay UNCHANGED (the
   intake record is evidence, not a shipping asset).
2. Every affected derived asset is tracked here (currently: `bg.webp`
   definitive; `merch.webp` review).
3. M3 builds against the delivered art — internal/preview only, behind
   Vercel SSO.
4. Before public access: replace the BTS logo, tour name, bus/banner
   marks, and any related branded copy (fictional branding; "Aegyo
   Arena" mark is already established in the piece).
5. Re-run visual/device QA after replacement — the background drives
   lane alignment and HUD readability.
6. Sweep DERIVATIVE surfaces, not just gameplay: homepage thumbnails,
   screenshots, OG images, cached exports.
