/**
 * Guess the Slang rule vectors (docs/games/hangman.md — "Required
 * vectors"): repeated/correct/incorrect letters, multi-occurrence and
 * case normalization, sixth-error loss, final-letter solve precedence,
 * and seeded term determinism.
 */

import { describe, expect, it } from "vitest";
import { seededRandom } from "@/shell/rng";
import { HANGMAN_TERMS, MAX_LIVES } from "@/games/hangman/content";
import {
  createHangmanState,
  guess,
  revealedWord,
  scoreOf,
  type HangmanState,
} from "@/games/hangman/logic";

function stateFor(term: string): HangmanState {
  const termIndex = HANGMAN_TERMS.findIndex((t) => t.term === term);
  if (termIndex < 0) throw new Error(`term not in dictionary: ${term}`);
  return {
    termIndex,
    term,
    guessed: new Set(),
    livesLeft: MAX_LIVES,
    status: "running",
  };
}

describe("hangman rules (docs/games/hangman.md vectors)", () => {
  it("V1: repeated letters are free; correct reveals; wrong costs one life", () => {
    const state = stateFor("BIAS");
    expect(guess(state, "B")).toEqual({
      kind: "correct",
      letter: "B",
      solved: false,
    });
    expect(state.livesLeft).toBe(MAX_LIVES);

    // Repeat of a CORRECT letter: no effect, no cost.
    expect(guess(state, "B")).toEqual({ kind: "repeat", letter: "B" });
    expect(state.livesLeft).toBe(MAX_LIVES);

    expect(guess(state, "Z")).toEqual({
      kind: "wrong",
      letter: "Z",
      lost: false,
    });
    expect(state.livesLeft).toBe(MAX_LIVES - 1);

    // Repeat of a WRONG letter: also free.
    expect(guess(state, "Z")).toEqual({ kind: "repeat", letter: "Z" });
    expect(state.livesLeft).toBe(MAX_LIVES - 1);

    // Non-letters are ignored entirely.
    expect(guess(state, "1")).toEqual({ kind: "ignored" });
    expect(guess(state, "AB")).toEqual({ kind: "ignored" });
  });

  it("V2: multi-occurrence letters reveal every position; case normalizes", () => {
    const state = stateFor("AEGYO"); // no doubles — use COMEBACK for doubles
    expect(guess(state, "a")).toEqual({
      kind: "correct",
      letter: "A",
      solved: false,
    });
    expect(revealedWord(state)).toEqual(["A", null, null, null, null]);

    const doubles = stateFor("COMEBACK"); // two C's
    guess(doubles, "c");
    expect(revealedWord(doubles)).toEqual([
      "C",
      null,
      null,
      null,
      null,
      null,
      "C",
      null,
    ]);
    // Lowercase repeat of the same letter is still a free repeat.
    expect(guess(doubles, "C")).toEqual({ kind: "repeat", letter: "C" });
  });

  it("V3: sixth wrong guess loses; the final correct letter solves first", () => {
    const lost = stateFor("BIAS");
    for (const letter of ["Z", "X", "Q", "W", "N", "P"]) {
      guess(lost, letter);
    }
    expect(lost.status).toBe("lost");
    expect(lost.livesLeft).toBe(0);
    expect(scoreOf(lost)).toBe(0);
    // Frozen after the end.
    expect(guess(lost, "B")).toEqual({ kind: "ignored" });

    // Solve on the last life: 5 wrong, then complete the word — the final
    // correct letter resolves SOLVE, score = 1 remaining life.
    const clutch = stateFor("BIAS");
    for (const letter of ["Z", "X", "Q", "W", "N"]) guess(clutch, letter);
    expect(clutch.livesLeft).toBe(1);
    guess(clutch, "B");
    guess(clutch, "I");
    guess(clutch, "A");
    const final = guess(clutch, "S");
    expect(final).toEqual({ kind: "correct", letter: "S", solved: true });
    expect(clutch.status).toBe("completed");
    expect(scoreOf(clutch)).toBe(1);

    // Full-lives solve scores the maximum 6.
    const clean = stateFor("BIAS");
    for (const letter of ["B", "I", "A", "S"]) guess(clean, letter);
    expect(scoreOf(clean)).toBe(MAX_LIVES);
  });

  it("V4: identical seed picks the identical term (daily-seed contract)", () => {
    const a = createHangmanState(seededRandom("daily:hangman:2026-07-18"));
    const b = createHangmanState(seededRandom("daily:hangman:2026-07-18"));
    expect(a.termIndex).toBe(b.termIndex);
    expect(a.term).toBe(b.term);
    const otherDay = createHangmanState(
      seededRandom("daily:hangman:2026-07-19"),
    );
    // Different day MAY collide on a 7-term dictionary; determinism per
    // seed is the contract, so just assert validity.
    expect(HANGMAN_TERMS[otherDay.termIndex].term).toBe(otherDay.term);
  });

  it("dictionary integrity: uppercase single words, unique, hints keyed", () => {
    const seen = new Set<string>();
    for (const entry of HANGMAN_TERMS) {
      expect(entry.term).toMatch(/^[A-Z]+$/); // single word, no spaces at v1
      expect(seen.has(entry.term)).toBe(false);
      seen.add(entry.term);
      expect(entry.hintKey.startsWith("game.hangman.hint.")).toBe(true);
    }
    expect(HANGMAN_TERMS.length).toBe(7); // reviewed launch seed only
  });
});
