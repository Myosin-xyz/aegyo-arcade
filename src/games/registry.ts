/**
 * Game registry (TECH_SPEC §5, §6): metadata-only module. The host reads
 * `meta` (including `meta.surface`) and constructs the surface BEFORE
 * lazy-loading the implementation chunk; conformance asserts the loaded
 * definition's metadata matches the registry entry.
 */

import type { Locale } from "@/i18n/t";
import type { GameDefinition, GameMeta } from "@/shell/contract";
import { clawMeta } from "./claw/meta";
import { snakeMeta } from "./snake/meta";
import { flappyMeta } from "./flappy/meta";
import { jumperMeta } from "./jumper/meta";
import { hangmanMeta } from "./hangman/meta";
import { freebieMeta } from "./freebie/meta";
import { froggerMeta } from "./frogger/meta";
import { thisorthatMeta } from "./thisorthat/meta";
import { photocardStackMeta } from "./photocard-stack/meta";
import { fanchantHeroMeta } from "./fanchant-hero/meta";
import { biasMatchMeta } from "./bias-match/meta";

export interface RegistryEntry {
  meta: GameMeta;
  /** Optional, pre-rendered landing-card preview. Keeping this as static
   * metadata avoids importing a game's runtime chunk on the paid landing
   * route; videos stay `preload="none"` until the card is activated. */
  preview?: {
    poster: Record<Locale, string>;
    video: Record<Locale, string>;
  };
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
  /** Optional host-owned completion animation. It runs after report.end,
   * so counted submission begins immediately while the presentation plays. */
  completionPresentation?: "bias-stage";
  /** Optional lazy background track. Shell-owned presentation only: it
   * follows the global mute/pause lifecycle without changing AudioBus v1. */
  musicTrack?: string;
  /**
   * Optional "how to play" bullet i18n keys shown on the host's ready
   * card BEFORE any run is issued/started (Daidai: the originals had a
   * pregame explanation). Presentation only — the frozen runtime
   * contract is untouched, and both counted + practice buttons remain.
   */
  introKeys?: readonly string[];
  /**
   * Optional richer ready-card presentation for deliveries whose intro
   * art direction is part of the game. This stays registry-side because
   * it changes host chrome, not the frozen runtime contract.
   */
  introPresentation?: {
    titleKey: string;
    subtitleKey: string;
    bulletIcons: readonly string[];
    variant: "neon";
  };
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
    musicTrack: "/games/music/claw.mp3",
    load: () => import("./claw/module").then((m) => m.clawDefinition),
  },
  {
    meta: snakeMeta,
    // Snake Freebies draws its own LEVEL/SCORE/TIME HUD inside the arena
    // (delivered design), so the host header must not print the score a
    // second time. The ended announcement still speaks it.
    scorePresentation: "authored",
    introKeys: [
      "game.snake.intro.1",
      "game.snake.intro.2",
      "game.snake.intro.4",
      "game.snake.intro.3",
    ],
    introPresentation: {
      titleKey: "game.snake.intro.title",
      subtitleKey: "game.snake.intro.subtitle",
      bulletIcons: ["🕹️", "🎁", "🏟️", "💖"],
      variant: "neon",
    },
    musicTrack: "/games/music/snake.mp3",
    load: () => import("./snake/module").then((m) => m.snakeDefinition),
  },
  {
    meta: flappyMeta,
    // Bias Flap (Daidai delivery, ported 2026-07-27) draws its own
    // LEVEL/GATES/TIME HUD; score appears only on its own end screens —
    // which is also why the ended presentation is game-authored: the
    // "FRONT ROW, BABY!" / "SEE YOU AT THE NEXT SHOW!" stats screens ARE
    // the result, the host adds only Play Again + the Challenge CTA.
    scorePresentation: "authored",
    endPresentation: "game-authored",
    completionPresentation: "bias-stage",
    musicTrack: "/games/music/flappy.mp3",
    introKeys: [
      "game.flappy.intro.1",
      "game.flappy.intro.2",
      "game.flappy.intro.3",
      "game.flappy.intro.4",
      "game.flappy.intro.5",
    ],
    load: () => import("./flappy/module").then((m) => m.flappyDefinition),
  },
  {
    meta: jumperMeta,
    scorePresentation: "authored",
    musicTrack: "/games/music/jumper.mp3",
    introKeys: [
      "game.jumper.intro.1",
      "game.jumper.intro.2",
      "game.jumper.intro.3",
      "game.jumper.intro.4",
      "game.jumper.intro.5",
    ],
    load: () => import("./jumper/module").then((m) => m.jumperDefinition),
  },
  {
    meta: photocardStackMeta,
    preview: {
      poster: {
        en: "/games/photocard-stack/preview-v1-en.webp",
        "es-419": "/games/photocard-stack/preview-v1-es-419.webp",
      },
      video: {
        en: "/games/photocard-stack/preview-v1-en.mp4",
        "es-419": "/games/photocard-stack/preview-v1-es-419.mp4",
      },
    },
    scorePresentation: "authored",
    endPresentation: "game-authored",
    musicTrack: "/games/music/freebie.mp3",
    introKeys: [
      "game.photocard-stack.intro.1",
      "game.photocard-stack.intro.2",
      "game.photocard-stack.intro.3",
      "game.photocard-stack.intro.4",
    ],
    introPresentation: {
      titleKey: "game.photocard-stack.intro.title",
      subtitleKey: "game.photocard-stack.intro.subtitle",
      bulletIcons: ["👆", "🎯", "✨", "🏆"],
      variant: "neon",
    },
    load: () =>
      import("./photocard-stack/module").then(
        (m) => m.photocardStackDefinition,
      ),
  },
  {
    meta: fanchantHeroMeta,
    preview: {
      poster: {
        en: "/games/fanchant-hero/preview-v1-en.webp",
        "es-419": "/games/fanchant-hero/preview-v1-es-419.webp",
      },
      video: {
        en: "/games/fanchant-hero/preview-v1-en.mp4",
        "es-419": "/games/fanchant-hero/preview-v1-es-419.mp4",
      },
    },
    scorePresentation: "authored",
    endPresentation: "game-authored",
    introKeys: [
      "game.fanchant-hero.intro.1",
      "game.fanchant-hero.intro.2",
      "game.fanchant-hero.intro.3",
      "game.fanchant-hero.intro.4",
    ],
    introPresentation: {
      titleKey: "game.fanchant-hero.intro.title",
      subtitleKey: "game.fanchant-hero.intro.subtitle",
      bulletIcons: ["🎁", "👆", "🎯", "🔥"],
      variant: "neon",
    },
    load: () =>
      import("./fanchant-hero/module").then((m) => m.fanchantHeroDefinition),
  },
  {
    meta: biasMatchMeta,
    preview: {
      poster: {
        en: "/games/bias-match/preview-v1-en.webp",
        "es-419": "/games/bias-match/preview-v1-es-419.webp",
      },
      video: {
        en: "/games/bias-match/preview-v1-en.mp4",
        "es-419": "/games/bias-match/preview-v1-es-419.mp4",
      },
    },
    scorePresentation: "authored",
    endPresentation: "game-authored",
    // Reuse the slower puzzle track from Guess the Slang: it fits a
    // memory game and avoids shipping a ninth near-duplicate catalog MP3.
    musicTrack: "/games/music/hangman.mp3",
    introKeys: [
      "game.bias-match.intro.1",
      "game.bias-match.intro.2",
      "game.bias-match.intro.3",
      "game.bias-match.intro.4",
      "game.bias-match.intro.5",
    ],
    introPresentation: {
      titleKey: "game.bias-match.intro.title",
      subtitleKey: "game.bias-match.intro.subtitle",
      bulletIcons: ["🃏", "👀", "💔", "✨", "🏆"],
      variant: "neon",
    },
    load: () =>
      import("./bias-match/module").then((m) => m.biasMatchDefinition),
  },
  {
    meta: hangmanMeta,
    musicTrack: "/games/music/hangman.mp3",
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
    musicTrack: "/games/music/freebie.mp3",
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
    musicTrack: "/games/music/frogger.mp3",
    load: () => import("./frogger/module").then((m) => m.froggerDefinition),
  },
  {
    meta: thisorthatMeta,
    // No score concept at all (prototype).
    scorePresentation: "none",
    // The vibe result is the payoff — keep it visible after the run
    // ends instead of dimming it under the host overlay.
    endPresentation: "game-authored",
    musicTrack: "/games/music/this-or-that.mp3",
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
