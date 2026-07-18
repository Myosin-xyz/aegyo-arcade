/** Cross to the Concert metadata — registry + definition share it. */

import type { GameMeta } from "@/shell/contract";
import { DESIGN_H, DESIGN_W } from "./logic";

export const froggerMeta: GameMeta = {
  id: "frogger",
  titleKey: "game.frogger.title",
  taglineKey: "game.frogger.tagline",
  surface: "canvas",
  designBox: { w: DESIGN_W, h: DESIGN_H },
  capabilities: { counted: true, prize: false },
};
