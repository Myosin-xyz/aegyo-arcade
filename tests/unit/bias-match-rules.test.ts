import { describe, expect, it } from "vitest";
import {
  FIXED_LIVES,
  LEVELS,
  MAX_SCORE,
  continueBiasMatch,
  createBiasMatchState,
  pairCountForLevel,
  selectBiasMatchCard,
  stepBiasMatch,
} from "@/games/bias-match/logic";
import { seededRandom } from "@/shell/rng";

describe("Bias Match rules", () => {
  it("builds the same distinct pair deck from the same ranked seed", () => {
    const first = createBiasMatchState(seededRandom("bias-match-daily"));
    const replay = createBiasMatchState(seededRandom("bias-match-daily"));
    const other = createBiasMatchState(seededRandom("bias-match-other"));
    expect(first).toEqual(replay);
    expect(first.cards).not.toEqual(other.cards);

    const counts = new Map<number, number>();
    for (const card of first.cards) {
      counts.set(card.face, (counts.get(card.face) ?? 0) + 1);
    }
    expect([...counts.values()]).toEqual([2, 2, 2]);
    expect(first.cards.some((card) => card.bonus)).toBe(true);
  });

  it("blocks input during the peek, then scores a seeded matching pair", () => {
    const state = createBiasMatchState(seededRandom("bias-match-pair"));
    expect(selectBiasMatchCard(state, 0)).toBe("ignored");
    stepBiasMatch(state, LEVELS[0].peekMs);

    const firstIndex = 0;
    const secondIndex = state.cards.findIndex(
      (card, index) =>
        index !== firstIndex && card.face === state.cards[0].face,
    );
    expect(selectBiasMatchCard(state, firstIndex)).toBe("first");
    expect(selectBiasMatchCard(state, secondIndex)).toBe("pair");
    const event = stepBiasMatch(state, 320);
    expect(event.resolved).toMatch(/match|gold/);
    expect(state.cards[firstIndex].status).toBe("matched");
    expect(state.cards[secondIndex].status).toBe("matched");
    expect(state.score).toBe(state.cards[firstIndex].bonus ? 20 : 10);
  });

  it("charges one life after a mismatch and restores five on the next level", () => {
    const rng = seededRandom("bias-match-miss");
    const state = createBiasMatchState(rng);
    stepBiasMatch(state, LEVELS[0].peekMs);
    const firstIndex = 0;
    const secondIndex = state.cards.findIndex(
      (card) => card.face !== state.cards[firstIndex].face,
    );
    selectBiasMatchCard(state, firstIndex);
    selectBiasMatchCard(state, secondIndex);
    expect(stepBiasMatch(state, 750).resolved).toBe("mismatch");
    expect(state.lives).toBe(FIXED_LIVES - 1);
    expect(state.cards[firstIndex].status).toBe("hidden");

    state.phase = "transition";
    expect(continueBiasMatch(state, rng)).toBe(true);
    expect(state.level).toBe(2);
    expect(state.lives).toBe(FIXED_LIVES);
    expect(state.cards).toHaveLength(pairCountForLevel(2) * 2);
  });

  it("pins the five-level all-gold score ceiling to 3450", () => {
    expect(MAX_SCORE).toBe(3450);
  });
});
