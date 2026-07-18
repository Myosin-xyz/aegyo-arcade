/** Bias Flap metadata — registry + definition share it (no drift). */

import type { GameMeta } from "@/shell/contract";

export const flappyMeta: GameMeta = {
  id: "flappy",
  titleKey: "game.flappy.title",
  taglineKey: "game.flappy.tagline",
  surface: "canvas",
  designBox: { w: 360, h: 640 },
  capabilities: { counted: true, prize: false },
};
