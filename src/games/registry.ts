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
import { thisorthatMeta } from "./thisorthat/meta";

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
   * Where the score presents (M4 review P2 + M4.5 review P2):
   * - "shell" (default): host header shows it, ended announcement
   *   includes it;
   * - "authored": the game draws its own score/HUD inside the surface
   *   (delivered art with baked chrome) — host header hides it but the
   *   ended announcement still speaks it;
   * - "none": the game HAS no score concept — header hides it AND the
   *   screen-reader ended announcement stays silent about it (a
   *   nonexistent "Score: 0" is a lie to assistive tech).
   */
  scorePresentation?: "shell" | "authored" | "none";
  /**
   * PRESENTATION-ONLY end variant (M4.5 review P1): "game-authored"
   * keeps the game's own in-DOM result visible after report.end — the
   * host skips its dark ended overlay and renders just a minimal Play
   * Again control (still the host's startRun: fresh RunContext,
   * lifecycle, abort — no lifecycle exception).
   */
  endPresentation?: "game-authored";
  /**
   * Optional "how to play" bullet i18n keys shown on the host's ready
   * card BEFORE any run is issued/started (Daidai: the originals had a
   * pregame explanation). Presentation only — the frozen runtime
   * contract is untouched, and both counted + practice buttons remain.
   */
  introKeys?: readonly string[];
  load: () => Promise<GameDefinition>;
}

const entries: RegistryEntry[] = [
  {
    meta: clawMeta,
    hostManagedCanvas: false,
    countedCompletion: "game-owned",
    // The claw has no score concept (capabilities = counted + prize, no
    // score) — like This-or-That, it must not present a fictional
    // "Score: 0" in the header, the ended overlay, or the screen-reader
    // announcement (audit A5, 2026-07-21). Its counted rank/streak
    // receipt is a separate host branch and is unaffected.
    scorePresentation: "none",
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
    scorePresentation: "authored",
    introKeys: [
      "game.freebie.intro.1",
      "game.freebie.intro.2",
      "game.freebie.intro.3",
      "game.freebie.intro.4",
    ],
    load: () => import("./freebie/module").then((m) => m.freebieDefinition),
  },
  {
    meta: froggerMeta,
    scorePresentation: "authored",
    introKeys: [
      "game.frogger.intro.1",
      "game.frogger.intro.2",
      "game.frogger.intro.3",
      "game.frogger.intro.4",
    ],
    load: () => import("./frogger/module").then((m) => m.froggerDefinition),
  },
  {
    meta: thisorthatMeta,
    // No score concept at all (prototype).
    scorePresentation: "none",
    // The vibe result is the payoff — keep it visible after the run
    // ends instead of dimming it under the host overlay.
    endPresentation: "game-authored",
    load: () =>
      import("./thisorthat/module").then((m) => m.thisorthatDefinition),
  },
];

export function listGames(): RegistryEntry[] {
  return entries;
}

export function getRegistryEntry(gameId: string): RegistryEntry | undefined {
  return entries.find((entry) => entry.meta.id === gameId);
}
