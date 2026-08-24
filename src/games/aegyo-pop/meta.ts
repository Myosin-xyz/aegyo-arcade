import type { GameMeta } from "@/shell/contract";
import { DESIGN_H, DESIGN_W } from "./logic";

export const aegyoPopMeta: GameMeta = {
  id: "aegyo-pop",
  titleKey: "game.aegyo-pop.title",
  taglineKey: "game.aegyo-pop.tagline",
  surface: "canvas",
  designBox: { w: DESIGN_W, h: DESIGN_H },
  capabilities: { counted: true, prize: false },
};
