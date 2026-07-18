/**
 * Claw metadata — shared by the registry (metadata-only module) and the
 * lazy-loaded definition so the two can never drift. Contains no game code.
 */

import type { GameMeta } from "@/shell/contract";

export const clawMeta: GameMeta = {
  id: "claw",
  titleKey: "game.claw.title",
  taglineKey: "game.claw.tagline",
  surface: "canvas",
  // The claw's design space after the M1 asset rescale (×0.70 of the PSD
  // export — scripts/rescale-claw-assets.py). Its own renderer manages
  // sizing/DPR (module-loop escape hatch) — designBox is informational here
  // and mirrors public/games/claw/manifest.json `design`.
  designBox: { w: 941, h: 1488 },
  capabilities: { counted: true, prize: true },
};
