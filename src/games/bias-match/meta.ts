import type { GameMeta } from "@/shell/contract";

export const biasMatchMeta: GameMeta = {
  id: "bias-match",
  titleKey: "game.bias-match.title",
  taglineKey: "game.bias-match.tagline",
  surface: "dom",
  designBox: { w: 360, h: 640 },
  capabilities: { counted: true, prize: false },
};
