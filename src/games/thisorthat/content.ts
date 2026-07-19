/**
 * Fan Day: This or That — versioned prototype content (M4.5,
 * docs/games/this-or-that.md). Nine rounds, two options each, every
 * option tagged with 1–2 fan-day vibes. NO official artwork or logos —
 * labels are i18n keys, icons are abstract Aegyo-palette glyphs keyed
 * by the option's primary vibe. Member names appear as PLAIN TEXT only
 * (Mateo's prototype call) so Simon can react to the concept; the two
 * adult-leaning options from the source concept are softened
 * ("drinking" → late-night snacks, "tattoos" → matching charms).
 */

export const TOT_CONTENT_VERSION = "v1";

export type Vibe = "cozy" | "creative" | "adventurous" | "energetic" | "social";

/**
 * Tie-break order for the final result (deterministic; tested).
 * Deliberately leads with the LOWER-frequency vibes to counter tally
 * skew — with the v1 tags this yields a 13.9%–25.0% win spread across
 * all 512 choice combinations (M4.5 review P2; exhaustive snapshot in
 * tests). A cozy-first order measured 42.6% cozy.
 */
export const VIBE_PRIORITY: readonly Vibe[] = [
  "creative",
  "energetic",
  "adventurous",
  "social",
  "cozy",
];

export interface TotOption {
  /** i18n suffix: `game.thisorthat.opt.<key>` */
  key: string;
  tags: readonly [Vibe] | readonly [Vibe, Vibe];
}

export interface TotRound {
  a: TotOption;
  b: TotOption;
}

// Single tags only, balanced 4/4/4/3/3 across vibes — doubles amplified
// the win-rate skew (M4.5 review P2).
export const TOT_ROUNDS: readonly TotRound[] = [
  {
    a: { key: "snacks", tags: ["cozy"] }, // softened from "drinking"
    b: { key: "picnic", tags: ["adventurous"] },
  },
  {
    a: { key: "karaoke", tags: ["social"] },
    b: { key: "listen", tags: ["cozy"] },
  },
  {
    a: { key: "charms", tags: ["creative"] }, // softened from "tattoos"
    b: { key: "choreo", tags: ["energetic"] },
  },
  {
    a: { key: "bike", tags: ["adventurous"] },
    b: { key: "cafes", tags: ["social"] },
  },
  {
    a: { key: "fanart", tags: ["creative"] },
    b: { key: "dance", tags: ["energetic"] },
  },
  {
    a: { key: "coffeechan", tags: ["cozy"] },
    b: { key: "arcadehan", tags: ["energetic"] },
  },
  {
    a: { key: "ramyeon", tags: ["cozy"] },
    b: { key: "photowalk", tags: ["adventurous"] },
  },
  {
    a: { key: "boardgames", tags: ["social"] },
    b: { key: "nightmarket", tags: ["adventurous"] },
  },
  {
    a: { key: "playlist", tags: ["creative"] },
    b: { key: "fanevent", tags: ["social"] },
  },
];

/** Aegyo-palette accent per vibe (abstract icons, no IP). */
export const VIBE_COLORS: Record<Vibe, string> = {
  cozy: "#ff8fb8",
  creative: "#8b7cff",
  adventurous: "#2fe6c4",
  energetic: "#ffd166",
  social: "#ff4f8b",
};

/** Tiny abstract SVG path per vibe (24×24 viewBox). */
export const VIBE_GLYPHS: Record<Vibe, string> = {
  cozy: "M17 4a8.5 8.5 0 1 0 3 13.5A9.5 9.5 0 0 1 17 4Z", // moon
  creative:
    "M12 2l2.4 7.6H22l-6.2 4.5 2.4 7.4-6.2-4.6-6.2 4.6 2.4-7.4L2 9.6h7.6Z", // star
  adventurous: "M3 19L10 6l4 7 3-4 4 10Z", // peaks
  energetic: "M13 2L5 14h6l-2 8 8-12h-6Z", // bolt
  social: "M8 8a4 4 0 1 1 0 8 4 4 0 0 1 0-8Zm8 0a4 4 0 1 1 0 8 4 4 0 0 1 0-8Z", // pair
};
