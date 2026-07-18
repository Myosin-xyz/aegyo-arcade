/**
 * Snake rule vectors (docs/games/snake.md — "Required vectors before
 * implementation"): seeded determinism, forbidden reversal, one direction
 * change per step, end-at-most-once, spawn-never-on-body, full-board
 * completion, repeated-start determinism.
 */

import { describe, expect, it } from "vitest";
import { seededRandom } from "@/shell/rng";
import {
  createSnakeState,
  queueDirection,
  spawnFood,
  step,
  type SnakeState,
} from "@/games/snake/logic";
import { CONTROL_ZONES, hitControl } from "@/games/snake/controls";

describe("snake rules (docs/games/snake.md vectors)", () => {
  it("V1: seeded initial body/direction and first photocard are deterministic", () => {
    const a = createSnakeState(seededRandom("vector-1"));
    const b = createSnakeState(seededRandom("vector-1"));
    expect(a).toEqual(b);
    expect(a.body).toEqual([
      { x: 9, y: 9 },
      { x: 8, y: 9 },
      { x: 7, y: 9 },
    ]);
    expect(a.dir).toBe("right");
    // Photocard never on the body.
    for (const cell of a.body) {
      expect(a.food).not.toEqual(cell);
    }
    const c = createSnakeState(seededRandom("vector-other"));
    expect(c.food).not.toEqual(a.food); // seed actually matters
  });

  it("V2: queued input cannot reverse; at most one change per step", () => {
    const rng = seededRandom("vector-2");
    const state = createSnakeState(rng);
    // Reversal (right → left) is rejected at apply time even when queued
    // last (single-slot queue, latest wins).
    queueDirection(state, "up");
    queueDirection(state, "left");
    const headBefore = { ...state.body[0] };
    step(state, rng);
    expect(state.dir).toBe("right"); // reversal ignored, no crash-back
    expect(state.body[0]).toEqual({ x: headBefore.x + 1, y: headBefore.y });

    // A legal queued turn applies exactly once.
    queueDirection(state, "down");
    step(state, rng);
    expect(state.dir).toBe("down");
    step(state, rng);
    expect(state.dir).toBe("down"); // no second change without new input
  });

  it("V3: wall collision ends the run exactly once; steps become no-ops", () => {
    const rng = seededRandom("vector-3");
    const state = createSnakeState(rng);
    // Drive right into the wall (head starts at x=9, grid 20).
    for (let i = 0; i < 30 && state.status === "running"; i++) step(state, rng);
    expect(state.status).toBe("lost");
    const snapshot = JSON.parse(JSON.stringify(state)) as SnakeState;
    step(state, rng);
    queueDirection(state, "up");
    step(state, rng);
    expect(state).toEqual(snapshot); // frozen after the end
  });

  it("V4: photocards never spawn on the body (many seeded spawns)", () => {
    const rng = seededRandom("vector-4");
    const state = createSnakeState(rng, 6);
    // Grow the body artificially and respawn repeatedly.
    state.body = [
      { x: 0, y: 0 },
      { x: 1, y: 0 },
      { x: 2, y: 0 },
      { x: 3, y: 0 },
      { x: 4, y: 0 },
      { x: 5, y: 0 },
      { x: 5, y: 1 },
      { x: 4, y: 1 },
      { x: 3, y: 1 },
    ];
    const occupied = new Set(state.body.map((c) => `${c.x},${c.y}`));
    for (let i = 0; i < 200; i++) {
      const food = spawnFood(state, rng);
      expect(food).not.toBeNull();
      expect(occupied.has(`${food!.x},${food!.y}`)).toBe(false);
    }
  });

  it("V5: filling the board ends as completed with the maximum score", () => {
    const rng = seededRandom("vector-5");
    // 2×2 board, snake occupies 3 cells, food on the last free cell.
    const state: SnakeState = {
      grid: 2,
      body: [
        { x: 0, y: 0 },
        { x: 0, y: 1 },
        { x: 1, y: 1 },
      ],
      dir: "right",
      queuedDir: null,
      food: { x: 1, y: 0 },
      collected: 0,
      status: "running",
    };
    step(state, rng); // eats the last free cell
    expect(state.status).toBe("completed");
    expect(state.collected).toBe(1);
    expect(state.food).toBeNull();
    expect(state.body).toHaveLength(4); // grid full
  });

  it("V3b: GENUINE self-collision (not wall) ends the run", () => {
    const rng = seededRandom("vector-3b");
    // Head at (5,5) moving left into its own second segment at (4,5).
    const state: SnakeState = {
      grid: 20,
      body: [
        { x: 5, y: 5 },
        { x: 4, y: 5 },
        { x: 4, y: 4 },
        { x: 5, y: 4 },
        { x: 6, y: 4 },
      ],
      dir: "left",
      queuedDir: null,
      food: { x: 0, y: 0 },
      collected: 0,
      status: "running",
    };
    step(state, rng);
    expect(state.status).toBe("lost");
  });

  it("V3c: moving into the VACATING tail cell is a collision (documented strict rule)", () => {
    const rng = seededRandom("vector-3c");
    // 2×2 loop: head (5,5), tail (6,5); moving right targets the tail cell
    // that would vacate this step. Decision (docs/games/snake.md): strict —
    // this is a collision, matching the mock's behavior.
    const state: SnakeState = {
      grid: 20,
      body: [
        { x: 5, y: 5 },
        { x: 5, y: 6 },
        { x: 6, y: 6 },
        { x: 6, y: 5 },
      ],
      dir: "right",
      queuedDir: null,
      food: { x: 0, y: 0 },
      collected: 0,
      status: "running",
    };
    step(state, rng);
    expect(state.status).toBe("lost");
  });

  it("V7: on-screen D-pad zones map design-space taps to directions", () => {
    for (const zone of CONTROL_ZONES) {
      expect(hitControl(zone.x + zone.w / 2, zone.y + zone.h / 2)).toBe(
        zone.dir,
      );
      // Forgiving pad still hits just outside the drawn button.
      expect(hitControl(zone.x - 5, zone.y + zone.h / 2)).toBe(zone.dir);
    }
    // Board area and dead space are NOT controls.
    expect(hitControl(180, 300)).toBeNull();
    expect(hitControl(10, 630)).toBeNull();
    // Zones sit below the board (board is y 140–500) and inside the box.
    for (const zone of CONTROL_ZONES) {
      expect(zone.y).toBeGreaterThanOrEqual(500);
      expect(zone.y + zone.h).toBeLessThanOrEqual(640);
    }
  });

  it("V6: identical seed + input script replays identically", () => {
    const script = ["down", "left", "up", "right", "down"] as const;
    const run = (seed: string) => {
      const rng = seededRandom(seed);
      const state = createSnakeState(rng);
      for (const dir of script) {
        queueDirection(state, dir);
        step(state, rng);
        step(state, rng);
      }
      return state;
    };
    expect(run("replay-seed")).toEqual(run("replay-seed"));
  });
});
