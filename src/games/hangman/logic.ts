/**
 * Guess the Slang — pure rules (docs/games/hangman.md).
 *
 * Six lives; repeated letters are free; a correct letter reveals every
 * matching position; the final correct letter resolves SOLVE before any
 * loss condition (correct guesses never cost a life, so the two can't
 * race). Score on solve = remaining lives (1–6).
 */

import { HANGMAN_TERMS, MAX_LIVES } from "./content";

export interface HangmanState {
  termIndex: number;
  term: string;
  guessed: Set<string>;
  livesLeft: number;
  status: "running" | "completed" | "lost";
}

export type GuessResult =
  | { kind: "ignored" } // ended run, or not a single A–Z letter
  | { kind: "repeat"; letter: string } // no effect, no life cost
  | { kind: "correct"; letter: string; solved: boolean }
  | { kind: "wrong"; letter: string; lost: boolean };

export function createHangmanState(rng: () => number): HangmanState {
  const termIndex = Math.floor(rng() * HANGMAN_TERMS.length);
  return {
    termIndex,
    term: HANGMAN_TERMS[termIndex].term,
    guessed: new Set(),
    livesLeft: MAX_LIVES,
    status: "running",
  };
}

/** Case-normalized single-letter guess. */
export function guess(state: HangmanState, raw: string): GuessResult {
  if (state.status !== "running") return { kind: "ignored" };
  const letter = raw.toUpperCase();
  if (!/^[A-Z]$/.test(letter)) return { kind: "ignored" };
  if (state.guessed.has(letter)) return { kind: "repeat", letter };
  state.guessed.add(letter);

  if (state.term.includes(letter)) {
    const solved = [...state.term].every((c) => state.guessed.has(c));
    if (solved) state.status = "completed";
    return { kind: "correct", letter, solved };
  }

  state.livesLeft -= 1;
  const lost = state.livesLeft <= 0;
  if (lost) state.status = "lost";
  return { kind: "wrong", letter, lost };
}

/** Word display: revealed letters or null per position. */
export function revealedWord(state: HangmanState): (string | null)[] {
  return [...state.term].map((c) => (state.guessed.has(c) ? c : null));
}

/** Cosmetic score (docs): remaining lives on solve, else 0. */
export function scoreOf(state: HangmanState): number {
  return state.status === "completed" ? state.livesLeft : 0;
}
