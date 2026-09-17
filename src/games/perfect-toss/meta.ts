import type { GameMeta } from "@/shell/contract";
import { DESIGN_H, DESIGN_W } from "./logic";

export const perfectTossMeta: GameMeta = {
  id: "perfect-toss",
  titleKey: "game.perfect-toss.title",
  taglineKey: "game.perfect-toss.tagline",
  surface: "canvas",
  designBox: { w: DESIGN_W, h: DESIGN_H },
  capabilities: { counted: true, prize: false },
};
