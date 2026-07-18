/**
 * Game registry (TECH_SPEC §5, §6): metadata-only module. The host reads
 * `meta` (including `meta.surface`) and constructs the surface BEFORE
 * lazy-loading the implementation chunk; conformance asserts the loaded
 * definition's metadata matches the registry entry.
 */

import type { GameDefinition, GameMeta } from "@/shell/contract";
import { clawMeta } from "./claw/meta";
import { snakeMeta } from "./snake/meta";
import { flappyMeta } from "./flappy/meta";
import { jumperMeta } from "./jumper/meta";
import { hangmanMeta } from "./hangman/meta";
import { freebieMeta } from "./freebie/meta";
import { froggerMeta } from "./frogger/meta";

export interface RegistryEntry {
  meta: GameMeta;
  /**
   * CANVAS-ONLY host-loading hint (ADR 0005: deliberately outside
   * GameMeta — it configures how the host mounts, not the game
   * contract). Omitted/undefined = shell-managed sizing (the norm);
   * `false` = the module-loop legacy claw sizes its own canvas.
   * Meaningless for dom surfaces — omit it there.
   */
  hostManagedCanvas?: boolean;
  /**
   * How a counted run COMPLETES (capability lives in meta; strategy here):
   * "generic-submit" (default) — the host PUTs the score to
   * /api/runs/:id; "game-owned" — the game consumes its attempt through
   * its own committed server action (the claw's outcome endpoint) and
   * reports end when that action resolves.
   */
  countedCompletion?: "generic-submit" | "game-owned";
  /**
   * The game draws its own score/HUD inside the surface (delivered art
   * with baked chrome) — the host hides its header score to avoid the
   * double-HUD read (M4 review P2).
   */
  hasAuthoredHud?: boolean;
  load: () => Promise<GameDefinition>;
}

const entries: RegistryEntry[] = [
  {
    meta: clawMeta,
    hostManagedCanvas: false,
    countedCompletion: "game-owned",
    load: () => import("./claw/module").then((m) => m.clawDefinition),
  },
  {
    meta: snakeMeta,
    load: () => import("./snake/module").then((m) => m.snakeDefinition),
  },
  {
    meta: flappyMeta,
    load: () => import("./flappy/module").then((m) => m.flappyDefinition),
  },
  {
    meta: jumperMeta,
    load: () => import("./jumper/module").then((m) => m.jumperDefinition),
  },
  {
    meta: hangmanMeta,
    load: () => import("./hangman/module").then((m) => m.hangmanDefinition),
  },
  {
    meta: freebieMeta,
    hasAuthoredHud: true,
    load: () => import("./freebie/module").then((m) => m.freebieDefinition),
  },
  {
    meta: froggerMeta,
    hasAuthoredHud: true,
    load: () => import("./frogger/module").then((m) => m.froggerDefinition),
  },
];

export function listGames(): RegistryEntry[] {
  return entries;
}

export function getRegistryEntry(gameId: string): RegistryEntry | undefined {
  return entries.find((entry) => entry.meta.id === gameId);
}
