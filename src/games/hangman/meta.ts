/** Guess the Slang metadata — registry + definition share it (no drift). */

import type { GameMeta } from "@/shell/contract";

export const hangmanMeta: GameMeta = {
  id: "hangman",
  titleKey: "game.hangman.title",
  taglineKey: "game.hangman.tagline",
  surface: "dom",
  designBox: { w: 360, h: 640 },
  capabilities: { counted: true, prize: false },
};
