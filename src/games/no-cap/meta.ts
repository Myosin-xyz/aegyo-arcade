import type { GameMeta } from "@/shell/contract";
import { DESIGN_H, DESIGN_W } from "./logic";

export const noCapMeta: GameMeta = {
  id: "no-cap",
  titleKey: "game.no-cap.title",
  taglineKey: "game.no-cap.tagline",
  surface: "canvas",
  designBox: { w: DESIGN_W, h: DESIGN_H },
  capabilities: { counted: true, prize: false },
};
