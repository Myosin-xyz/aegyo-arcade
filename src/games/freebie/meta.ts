/** Freebie Frenzy metadata — registry + definition share it (no drift). */

import type { GameMeta } from "@/shell/contract";
import { DESIGN_H, DESIGN_W } from "./logic";

export const freebieMeta: GameMeta = {
  id: "freebie",
  titleKey: "game.freebie.title",
  taglineKey: "game.freebie.tagline",
  surface: "canvas",
  designBox: { w: DESIGN_W, h: DESIGN_H },
  capabilities: { counted: true, prize: false },
};
