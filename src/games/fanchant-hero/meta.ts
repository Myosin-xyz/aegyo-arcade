import type { GameMeta } from "@/shell/contract";
import { DESIGN_H, DESIGN_W } from "./logic";

export const fanchantHeroMeta: GameMeta = {
  id: "fanchant-hero",
  titleKey: "game.fanchant-hero.title",
  taglineKey: "game.fanchant-hero.tagline",
  surface: "canvas",
  designBox: { w: DESIGN_W, h: DESIGN_H },
  capabilities: { counted: true, prize: false },
};
