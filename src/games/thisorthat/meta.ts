/** Fan Day: This or That metadata — PRACTICE-ONLY prototype (M4.5). */

import type { GameMeta } from "@/shell/contract";

export const thisorthatMeta: GameMeta = {
  id: "thisorthat",
  titleKey: "game.thisorthat.title",
  taglineKey: "game.thisorthat.tagline",
  surface: "dom",
  designBox: { w: 360, h: 640 },
  // Deliberately excluded from the first build: counted runs, boards,
  // streak consumption (docs/games/this-or-that.md — Simon reacts to a
  // playable prototype before anything is promoted).
  capabilities: { counted: false, prize: false },
};
