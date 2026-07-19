/**
 * Fan Day: This or That — pure choice + result core (M4.5 prototype).
 * No RNG anywhere: rounds run in fixed content order, so identical
 * choices ALWAYS produce the identical result (acceptance bar).
 */

import {
  TOT_ROUNDS,
  VIBE_PRIORITY,
  type TotOption,
  type Vibe,
} from "./content";

export const TOTAL_ROUNDS = TOT_ROUNDS.length; // 9

export type TotSide = 0 | 1;

export interface TotState {
  /** 0-based index of the round being presented. */
  round: number;
  choices: TotSide[];
  status: "playing" | "result";
}

export function createTotState(): TotState {
  return { round: 0, choices: [], status: "playing" };
}

export function optionFor(round: number, side: TotSide): TotOption {
  const pair = TOT_ROUNDS[round];
  return side === 0 ? pair.a : pair.b;
}

/** Apply one choice. Returns false when not accepting input (result
 * screen) — the caller must not advance anything. */
export function choose(state: TotState, side: TotSide): boolean {
  if (state.status !== "playing") return false;
  state.choices.push(side);
  if (state.choices.length >= TOTAL_ROUNDS) {
    state.status = "result";
  } else {
    state.round = state.choices.length;
  }
  return true;
}

export function tallyVibes(choices: readonly TotSide[]): Record<Vibe, number> {
  const tally: Record<Vibe, number> = {
    cozy: 0,
    creative: 0,
    adventurous: 0,
    energetic: 0,
    social: 0,
  };
  choices.forEach((side, round) => {
    for (const tag of optionFor(round, side).tags) tally[tag] += 1;
  });
  return tally;
}

/** Winning vibe: highest tally; ties resolve by VIBE_PRIORITY order. */
export function resultVibe(choices: readonly TotSide[]): Vibe {
  const tally = tallyVibes(choices);
  let best: Vibe = VIBE_PRIORITY[0];
  for (const vibe of VIBE_PRIORITY) {
    if (tally[vibe] > tally[best]) best = vibe;
  }
  return best;
}

/** In-place reset — "Play again" clears EVERY previous choice. */
export function resetTot(state: TotState): void {
  state.round = 0;
  state.choices.length = 0;
  state.status = "playing";
}
