/**
 * Canonical brand palette for CANVAS / inline-SVG code, which cannot read
 * the CSS custom properties in globals.css. These hex values MIRROR the
 * :root tokens there — keep the two in sync. Chrome that means "the brand
 * pink / gold / accent / violet" should reference these instead of
 * hand-coding a hex (audit THEME-1: brand pink had drifted to #ff5db0 on
 * the claw loading screen vs #ff4f8b elsewhere).
 *
 * Bespoke per-game SCENE colors (e.g. Flappy's barricade purple, Jumper's
 * Pantone rose-quartz/serenity idol jacket) are intentionally NOT here —
 * they are character/scene design, not shared brand chrome.
 */
export const PALETTE = {
  background: "#140a26",
  surface: "#1e1038",
  surface2: "#2b1146",
  foreground: "#f4ecff",
  brand: "#ff4f8b",
  brandDeep: "#c22b63",
  brandSoft: "#ff8fb8",
  accent: "#2fe6c4",
  gold: "#ffd166",
  violet: "#8b7cff",
} as const;

/**
 * Home-page accent chip per game (audit THEME-1: these were hand-coded in
 * page.tsx). Five map straight to brand tokens; hangman/freebie carry
 * their own bespoke accent (centralized here so they can't silently
 * drift).
 */
export const GAME_ACCENTS: Record<string, string> = {
  claw: PALETTE.brand,
  snake: PALETTE.accent,
  flappy: PALETTE.gold,
  jumper: PALETTE.violet,
  hangman: "#7dffd9",
  freebie: "#ff7a3d",
  frogger: PALETTE.brandSoft,
};
