/**
 * Server-side registry of counted-capable games (§8.3, §9.2): which game
 * ids may issue counted attempts and the cosmetic plausibility envelope
 * for score shape validation. Bounds derive from documented game rules
 * (docs/games/<id>.md), not guesses.
 */

import { HANGMAN_CONTENT_VERSION } from "@/games/hangman/content";

export interface CountedGameConfig {
  /** Inclusive max plausible score (docs/games/<id>.md rules). */
  maxScore: number;
  /** Whether the game submits scores at all (claw outcomes carry none). */
  scored: boolean;
  /**
   * Counted attempts get a deterministic per-day seed
   * (`daily:<gameId>:<version>:<dayKey>`) so every player faces the same
   * content that day (docs/games/hangman.md: server-selected daily term).
   * The CONTENT VERSION is part of the seed: deploying a new dictionary
   * changes the mapping deliberately instead of silently reinterpreting
   * the same daily seed (M2 review P1).
   */
  dailySeedVersion?: string;
}

// Null prototype + Object.hasOwn: `in`/plain lookup would accept
// prototype keys like "constructor" as game ids (M2 review P2).
export const COUNTED_GAMES: Record<string, CountedGameConfig> = Object.assign(
  Object.create(null) as Record<string, CountedGameConfig>,
  {
    // 20×20 board minus the 3-cell starting body → 397 collectable cells;
    // Snake Freebies (Daidai V1, 2026-07-26): a perfect run is
    // 10·10 + 25·20 + 45·30 = 1950 (docs/games/snake-freebies.md).
    snake: { maxScore: 1950, scored: true },
    // ~0.87 barricades/second at 2.6 px/step · 180 px spacing; the 15-min
    // attempt TTL bounds a run at ~780 — 800 is the envelope
    // (docs/games/flappy.md adopted units).
    flappy: { maxScore: 800, scored: true },
    // Chart climb #100 → #1: score = positions climbed, hard max 99
    // (docs/games/jumper.md).
    jumper: { maxScore: 99, scored: true },
    // Solve score = remaining lives 1–6; daily server-selected term
    // (docs/games/hangman.md). SINGLE SOURCE: the content module's own
    // version constant — config can't drift from the dictionary.
    hangman: {
      maxScore: 6,
      scored: true,
      dailySeedVersion: HANGMAN_CONTENT_VERSION,
    },
    // Perfect 5-level run: per-level bests 208/309/406/554/800, combo
    // ×1.2 ceiling and clean-clear bonuses included — exactly 2277
    // (docs/games/freebie.md max-score vector).
    freebie: { maxScore: 2277, scored: true },
    // Progress score: 6 forward rows × 10 levels, monotonic new-best-row
    // credit only — hard max 60 (docs/games/frogger.md ranking decision).
    frogger: { maxScore: 60, scored: true },
    // Claw outcomes are server-drawn; no client score exists.
    claw: { maxScore: 0, scored: false },
  },
);

export function isCountedGame(gameId: string): boolean {
  return Object.hasOwn(COUNTED_GAMES, gameId);
}

export function countedGameConfig(
  gameId: string,
): CountedGameConfig | undefined {
  return Object.hasOwn(COUNTED_GAMES, gameId)
    ? COUNTED_GAMES[gameId]
    : undefined;
}

/** Deterministic daily seed: `daily:<gameId>:<version>:<dayKey>`. */
export function buildDailySeed(
  gameId: string,
  version: string,
  dayKey: string,
): string {
  return `daily:${gameId}:${version}:${dayKey}`;
}
