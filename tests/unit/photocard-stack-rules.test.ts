import { describe, expect, it } from "vitest";
import {
  MAX_VALIDATED_HEIGHT,
  SCORE_HOLO,
  createPhotocardStackState,
  dropPhotocard,
  heightOf,
  maximumScoreForHeight,
} from "@/games/photocard-stack/logic";
import { seededRandom } from "@/shell/rng";

function alignMovingCard(
  state: ReturnType<typeof createPhotocardStackState>,
): void {
  state.moving.x = state.stack[state.stack.length - 1].x;
}

describe("Photocard Stack rules", () => {
  it("builds the same opening from the same ranked seed", () => {
    expect(createPhotocardStackState(seededRandom("same"))).toEqual(
      createPhotocardStackState(seededRandom("same")),
    );
    expect(createPhotocardStackState(seededRandom("other"))).not.toEqual(
      createPhotocardStackState(seededRandom("same")),
    );
  });

  it("snaps a PERFECT, preserves width, and grows the combo bonus", () => {
    const state = createPhotocardStackState(seededRandom("perfect"));
    const width = state.moving.w;
    alignMovingCard(state);
    const first = dropPhotocard(state, seededRandom("next-1"));
    expect(first).toMatchObject({
      kind: "landed",
      perfect: true,
      combo: 1,
    });
    expect(state.stack.at(-1)?.w).toBe(width);
    expect(state.score).toBe(12); // 10 + 2×combo

    alignMovingCard(state);
    const second = dropPhotocard(state, seededRandom("next-2"));
    expect(second).toMatchObject({ perfect: true, combo: 2 });
    expect(state.score).toBe(26); // +10 + 2×2
  });

  it("trims an overhang and awards only the normal-drop score", () => {
    const state = createPhotocardStackState(seededRandom("trim"));
    const top = state.stack.at(-1)!;
    state.moving.x = top.x + 20;
    const event = dropPhotocard(state, seededRandom("trim-next"));
    expect(event).toMatchObject({ kind: "landed", perfect: false });
    expect(event?.falling?.w).toBeCloseTo(20);
    expect(state.stack.at(-1)?.w).toBeCloseTo(top.w - 20);
    expect(state.score).toBe(5);
  });

  it("makes the tenth landed card holographic and adds the +50 milestone", () => {
    const rng = seededRandom("holo-run");
    const state = createPhotocardStackState(rng);
    let tenth: ReturnType<typeof dropPhotocard> = null;
    for (let index = 0; index < 10; index += 1) {
      alignMovingCard(state);
      tenth = dropPhotocard(state, rng);
    }
    expect(heightOf(state)).toBe(10);
    expect(tenth).toMatchObject({ holo: true, rankIndex: 1 });
    expect(state.stack.at(-1)?.holo).toBe(true);
    expect(state.score).toBe(260);
    expect(state.score - 210).toBe(SCORE_HOLO);
  });

  it("ends immediately on a total miss and retains the prior score", () => {
    const state = createPhotocardStackState(seededRandom("miss"));
    state.score = 37;
    state.moving.x = -state.moving.w - 1;
    const event = dropPhotocard(state, seededRandom("unused"));
    expect(event?.kind).toBe("miss");
    expect(state.status).toBe("over");
    expect(state.score).toBe(37);
    expect(heightOf(state)).toBe(0);
  });

  it("pins the server score ceiling to the supplied 1000-card sanity bound", () => {
    expect(maximumScoreForHeight(MAX_VALIDATED_HEIGHT)).toBe(1_016_000);
  });
});
