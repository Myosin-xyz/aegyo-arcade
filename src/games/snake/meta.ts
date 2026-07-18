/** Snake metadata — registry + definition share it (no drift). */

import type { GameMeta } from "@/shell/contract";

export const snakeMeta: GameMeta = {
  id: "snake",
  titleKey: "game.snake.title",
  taglineKey: "game.snake.tagline",
  surface: "canvas",
  designBox: { w: 360, h: 640 },
  capabilities: { counted: true, prize: false },
};
