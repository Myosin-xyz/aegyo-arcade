/**
 * Generated display identity (META-3): curated word combos + 2-digit suffix.
 * No free-text input, no PII, no moderation surface. Lists reviewed for
 * brand fit; fan lexicon stays English by design (§12.1).
 */

import { randomInt } from "node:crypto";

const ADJECTIVES = [
  "Shiny",
  "Cosmic",
  "Neon",
  "Golden",
  "Velvet",
  "Sparkly",
  "Electric",
  "Dreamy",
  "Radiant",
  "Lucky",
  "Midnight",
  "Peachy",
  "Crystal",
  "Sunny",
  "Stellar",
  "Bubbly",
] as const;

const NOUNS = [
  "Maknae",
  "Bias",
  "Lightstick",
  "Photocard",
  "Fanchant",
  "Encore",
  "Comeback",
  "Aegyo",
  "Melody",
  "Chorus",
  "Anthem",
  "Sparkle",
  "Plushie",
  "Confetti",
  "Daebak",
  "Stan",
] as const;

export function generateHandle(): string {
  const adjective = ADJECTIVES[randomInt(ADJECTIVES.length)];
  const noun = NOUNS[randomInt(NOUNS.length)];
  const suffix = randomInt(10, 100); // 2 digits, collision-suffixed
  return `${adjective}${noun}${suffix}`;
}
