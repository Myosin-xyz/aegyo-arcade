import { describe, expect, it } from "vitest";
import { shuffleGameOrder } from "@/app/game-order";
import { listGames } from "@/games/registry";

describe("homepage game order", () => {
  it("uses Fisher-Yates to move every game through an injectable shuffle", () => {
    const original = ["claw", "snake", "flappy", "jumper"];

    expect(shuffleGameOrder(original, () => 0)).toEqual([
      "snake",
      "flappy",
      "jumper",
      "claw",
    ]);
  });

  it("does not mutate the canonical registry order", () => {
    const original = listGames().map((game) => game.meta.id);
    const snapshot = [...original];

    const shuffled = shuffleGameOrder(original, () => 0);

    expect(original).toEqual(snapshot);
    expect(shuffled).not.toBe(original);
  });

  it("keeps every registered game exactly once", () => {
    const original = listGames().map((game) => game.meta.id);
    const values = [0.18, 0.91, 0.42, 0.73];
    let call = 0;

    const shuffled = shuffleGameOrder(
      original,
      () => values[call++ % values.length],
    );

    expect(shuffled).toHaveLength(original.length);
    expect(new Set(shuffled)).toEqual(new Set(original));
  });
});
