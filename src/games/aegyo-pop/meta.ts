import type { GameMeta } from "@/shell/contract";
import { AEGYO_POP_DESIGN } from "./dimensions";

export const aegyoPopMeta: GameMeta = {
  id: "aegyo-pop",
  titleKey: "game.aegyo-pop.title",
  taglineKey: "game.aegyo-pop.tagline",
  surface: "canvas",
  designBox: AEGYO_POP_DESIGN,
  capabilities: { counted: true, prize: false },
};
