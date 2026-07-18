/**
 * Guess the Slang — versioned, reviewed dictionary (docs/games/hangman.md).
 *
 * Launch seed = the 7 recovered single-word terms only. ULZZANG is
 * excluded (content review), and the candidates (BIAS WRECKER,
 * LIGHTSTICK) stay out until fan-fluent review approves them and
 * multi-word normalization is documented. Terms stay English in every
 * locale (§12.1); hints are i18n keys.
 *
 * Bumping HANGMAN_CONTENT_VERSION changes the daily-term mapping — do it
 * deliberately (the counted daily seed embeds it via the server).
 */

export const HANGMAN_CONTENT_VERSION = "v1";
export const MAX_LIVES = 6;

export interface HangmanTermEntry {
  /** Uppercase A–Z only (single words at v1). */
  term: string;
  hintKey: string;
}

export const HANGMAN_TERMS: readonly HangmanTermEntry[] = [
  { term: "DAEBAK", hintKey: "game.hangman.hint.daebak" },
  { term: "BIAS", hintKey: "game.hangman.hint.bias" },
  { term: "MAKNAE", hintKey: "game.hangman.hint.maknae" },
  { term: "COMEBACK", hintKey: "game.hangman.hint.comeback" },
  { term: "AEGYO", hintKey: "game.hangman.hint.aegyo" },
  { term: "FANCHANT", hintKey: "game.hangman.hint.fanchant" },
  { term: "SASAENG", hintKey: "game.hangman.hint.sasaeng" },
];
