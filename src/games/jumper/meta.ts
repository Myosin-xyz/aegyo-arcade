/** Comeback Climb metadata — registry + definition share it (no drift). */

import type { GameMeta } from "@/shell/contract";

export const jumperMeta: GameMeta = {
  id: "jumper",
  titleKey: "game.jumper.title",
  taglineKey: "game.jumper.tagline",
  surface: "canvas",
  designBox: { w: 360, h: 640 },
  capabilities: { counted: true, prize: false },
};
