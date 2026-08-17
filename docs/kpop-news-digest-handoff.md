# K-pop News Digest Handoff

**Status:** Awaiting Simon's repository-placement decision.

This is a planning record only. The attached `SKILL.md` was reviewed as a
workflow specification; its autonomous browser and file-generation
instructions were not executed.

## Export received from DaiDai

- `kpop-news-digest-SKILL.md`
- `aegyo-arena-site-digest-2026-08-15.html`
- `aegyo-digest-state.json`
- Five local feed screenshots for NCT 127, Stray Kids, BTS, Red Velvet, and
  IVE/Wonyoung
- Schedule context: 5:00 PM Europe/Paris, expressed by DaiDai as
  `0 17 */3 * *`

The package is enough to reproduce the sample manually. Static validation
confirmed valid JavaScript, five resolvable image references, five posts
matching five processed URLs, hooks below ten words, exactly three hashtags
per caption, and no em dashes.

## Issues to resolve before scheduling

1. The specification describes the state as a JSON list, while the supplied
   file is an object containing `processedUrls` and `lastRunDate`.
2. The HTML has no library or build dependencies, but it is a bundle rather
   than one self-contained file because the five PNGs are loaded by relative
   path.
3. The group badge is an HTML overlay outside the canvas, so downloaded PNGs
   omit it.
4. The landscape screenshots are enlarged and center-cropped aggressively for
   the 1080x1320 cards; the 755x206 Wonyoung source is the weakest case.
5. `0 17 */3 * *` follows calendar dates divisible by three, not a stable
   72-hour interval. A portable scheduler also needs explicit Paris-time/DST
   handling.
6. Filtered and unusable article URLs should be recorded with their decision,
   or the workflow will reconsider them on every run.

## Recommended next step

Keep this snapshot as the baseline. Once Simon decides between the current
Aegyo monorepo and a separate private automation repository, import the bundle
without altering it, reproduce the sample once, then fix the state schema,
canvas export, image pipeline, and scheduler before enabling unattended runs.
