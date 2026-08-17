import type { GameMeta } from "@/shell/contract";
import { DESIGN_H, DESIGN_W } from "./logic";

export const photocardStackMeta: GameMeta = {
  id: "photocard-stack",
  titleKey: "game.photocard-stack.title",
  taglineKey: "game.photocard-stack.tagline",
  surface: "canvas",
  designBox: { w: DESIGN_W, h: DESIGN_H },
  capabilities: { counted: true, prize: false },
};
