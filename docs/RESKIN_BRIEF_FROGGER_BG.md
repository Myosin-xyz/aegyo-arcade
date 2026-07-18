# Art change request — Cross to the Concert background (for Daidai)

**Why**: the delivered stage scene shows BTS trademarks. We can't ship
third-party marks (docs/CONTENT_REGISTER.md ⛔ entry) — the game stays
behind the login wall until this lands. This is the ONLY blocker on the
art side; everything else is accepted as delivered.

## What to replace (background scene only)

1. The **logo on the stage gate** + the gate text
   **"BTS · WORLD TOUR · LIVE IN SEOUL"**.
2. The **logos on the two tour buses** (left + right).
3. The **logos on the crowd-lane banners/flags**.
4. Any other real-group mark you know is in the piece.

Replace with **fictional branding** — the Aegyo Arena bunny mark that is
already watermarked into the road works great as the headliner, or any
invented group/tour name. Tone/palette exactly as-is; the piece itself
is not in question.

Also please confirm: the "M" marks on the merch-cart shirts are your
original design (we flagged them as "probably generic — confirm").

## Hard constraints (gameplay is calibrated to this art)

- **Same canvas**: PSD 1024×1536; exported background 480×622.
- **Do not move layout geometry**: road/lane bands, sidewalk, the baked
  HUD boxes (SCORE / LEVEL / BEST / timer) and the bollard positions —
  collision rows and HUD number overlays are positioned against the
  current pixels.
- Keep the HUD boxes EMPTY like today (the game draws the numbers).

## Deliverable

Updated `crossed_the_street.psd` + a flattened PNG export at 480×622.
We re-encode and run a full visual/device QA pass after swap (also
regenerating any thumbnails/screenshots made from the old art).
