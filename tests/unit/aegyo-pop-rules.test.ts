import { describe, expect, it } from "vitest";
import {
  COLS,
  LEVELS,
  MAX_RAW_SCORE,
  MAX_SCORE,
  ceilingDrop,
  checkCaptiveRescue,
  createAegyoPopState,
  dropOrphans,
  resolveMatches,
  type Bubble,
} from "@/games/aegyo-pop/logic";
import { seededRandom } from "@/shell/rng";

function emptyRow(): (Bubble | null)[] {
  return Array.from({ length: COLS }, () => null);
}

describe("Aegyo Pop rules", () => {
  it("builds the same five-level opening from the same ranked seed", () => {
    expect(createAegyoPopState(seededRandom("aegyo-pop-daily"))).toEqual(
      createAegyoPopState(seededRandom("aegyo-pop-daily")),
    );
    expect(createAegyoPopState(seededRandom("other"))).not.toEqual(
      createAegyoPopState(seededRandom("aegyo-pop-daily")),
    );
  });

  it("pops a connected 3+, applies a color bomb board-wide, and clears", () => {
    const state = createAegyoPopState(seededRandom("bomb"));
    state.grid = [emptyRow(), emptyRow()];
    state.grid[0][0] = { color: "star", special: "bomb" };
    state.grid[0][1] = { color: "star", special: null };
    state.grid[0][2] = { color: "star", special: null };
    state.grid[1][7] = { color: "star", special: null };
    state.score = 0;

    const events = resolveMatches(state, { row: 0, col: 0 });
    expect(events).toContainEqual({
      kind: "pop",
      groupSize: 3,
      gained: 50,
      combo: 1,
      bombExtra: 1,
    });
    expect(state.grid.flat().every((cell) => cell === null)).toBe(true);
    expect(state.status).toBe("transition");
    expect(state.score).toBe(100); // 50 pop + level-one clear bonus.
  });

  it("routes orphaned ice through the shared two-hit removal rule", () => {
    const state = createAegyoPopState(seededRandom("ice"));
    state.grid = [emptyRow(), emptyRow()];
    state.grid[0][0] = { color: "star", special: null };
    state.grid[1][7] = { color: "diamond", special: "ice", hp: 2 };
    state.score = 0;

    expect(dropOrphans(state)).toBe(0);
    expect(state.grid[1][7]).toMatchObject({ special: "ice", hp: 1 });
    expect(dropOrphans(state)).toBe(1);
    expect(state.grid[1][7]).toBeNull();
    expect(state.score).toBe(10);
  });

  it("never orphan-deletes the captive and awards rescue only when exposed", () => {
    const state = createAegyoPopState(seededRandom("captive"));
    state.grid = [emptyRow(), emptyRow(), emptyRow()];
    state.grid[0][0] = { color: "heart", special: null };
    state.grid[2][4] = { special: "captive" };
    state.score = 0;

    dropOrphans(state);
    expect(state.grid[2][4]).toMatchObject({ special: "captive" });
    expect(checkCaptiveRescue(state)).toBe(1);
    expect(state.grid[2][4]).toBeNull();
    expect(state.score).toBe(150);
  });

  it("hard-caps reinforcement rows and emits exactly one LAST WAVE", () => {
    const state = createAegyoPopState(seededRandom("waves"));
    const openingRows = state.grid.length;
    const events: Parameters<typeof ceilingDrop>[2] = [];
    const rng = seededRandom("wave-rows");
    for (let index = 0; index < LEVELS[0].maxDrops + 2; index += 1) {
      ceilingDrop(state, rng, events);
    }
    expect(state.grid).toHaveLength(openingRows + LEVELS[0].maxDrops);
    expect(state.dropsUsed).toBe(LEVELS[0].maxDrops);
    expect(events.filter((event) => event.kind === "last-wave")).toHaveLength(
      1,
    );
  });

  it("saturates farmable points and reserves the upper band for a full clear", () => {
    const state = createAegyoPopState(seededRandom("score-envelope"));
    state.level = LEVELS.length;
    state.score = MAX_RAW_SCORE;
    state.grid = [emptyRow()];

    resolveMatches(state, { row: 0, col: 0 });
    expect(state.status).toBe("won");
    expect(state.score).toBe(MAX_SCORE);
    expect(MAX_SCORE).toBe(99_999);
  });
});
