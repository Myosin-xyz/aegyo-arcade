/**
 * Bias Flap rule vectors (docs/games/flappy.md — "Required vectors"):
 * no-input fall, flap trajectories, seeded gap bounds, one-score-per-
 * barricade with collision precedence, restart determinism.
 */

import { describe, expect, it } from "vitest";
import { seededRandom } from "@/shell/rng";
import {
  createFlappyState,
  flap,
  step,
  DESIGN,
  FLAP_IMPULSE,
  GAP_CENTER_MAX,
  GAP_CENTER_MIN,
  GAP_HALF,
  GRAVITY,
  PIPE_WIDTH,
  PLAYER_RADIUS,
  PLAYER_X,
  type FlappyState,
} from "@/games/flappy/logic";

describe("flappy rules (docs/games/flappy.md vectors)", () => {
  it("V1: no-input fall follows the exact adopted-unit trajectory", () => {
    const rng = seededRandom("flappy-v1");
    const state = createFlappyState(rng);
    expect(state.y).toBe(DESIGN.h / 2); // 320
    step(state, rng);
    expect(state.vy).toBeCloseTo(GRAVITY, 10);
    expect(state.y).toBeCloseTo(320 + GRAVITY, 10);
    for (let i = 0; i < 9; i++) step(state, rng);
    // y after n steps = y0 + g·n(n+1)/2 → 320 + 0.45·55 = 344.75
    expect(state.y).toBeCloseTo(344.75, 10);
  });

  it("V2: flap impulse trajectories at fixed steps", () => {
    const rng = seededRandom("flappy-v2");
    const state = createFlappyState(rng);
    flap(state);
    expect(state.vy).toBe(FLAP_IMPULSE);
    step(state, rng);
    expect(state.vy).toBeCloseTo(FLAP_IMPULSE + GRAVITY, 10); // −7.05
    expect(state.y).toBeCloseTo(320 + FLAP_IMPULSE + GRAVITY, 10); // 312.95
    // A second flap mid-fall resets vy exactly.
    for (let i = 0; i < 5; i++) step(state, rng);
    flap(state);
    expect(state.vy).toBe(FLAP_IMPULSE);
  });

  it("V3: seeded gap generation stays inside the safe margins", () => {
    const rng = seededRandom("flappy-v3");
    const state = createFlappyState(rng);
    const centers: number[] = state.pipes.map((p) => p.gapCenter);
    // Force many recycles by teleporting pipes off-screen.
    for (let i = 0; i < 50; i++) {
      state.pipes[0].x = -PIPE_WIDTH - 1;
      state.vy = 0; // keep the player alive and neutral
      state.y = state.pipes[1].gapCenter; // stay inside the next gap
      step(state, rng);
      centers.push(state.pipes[state.pipes.length - 1].gapCenter);
    }
    for (const center of centers) {
      expect(center).toBeGreaterThanOrEqual(GAP_CENTER_MIN);
      expect(center).toBeLessThanOrEqual(GAP_CENTER_MAX);
    }
    // Seed determinism: the same sequence regenerates identically.
    const replayState = createFlappyState(seededRandom("flappy-v3"));
    expect(replayState.pipes.map((p) => p.gapCenter)).toEqual(
      centers.slice(0, 3),
    );
  });

  it("V4: a barricade scores exactly once; collision resolves first", () => {
    const rng = seededRandom("flappy-v4");
    // Hand-built state: pipe about to pass the player.
    const passing: FlappyState = {
      y: 300,
      vy: 0,
      pipes: [
        {
          x: PLAYER_X - PLAYER_RADIUS - PIPE_WIDTH - 1,
          gapCenter: 300,
          scored: false,
        },
        { x: 400, gapCenter: 300, scored: false },
        { x: 580, gapCenter: 300, scored: false },
      ],
      score: 0,
      status: "running",
    };
    step(passing, rng);
    expect(passing.score).toBe(1);
    step(passing, rng);
    expect(passing.score).toBe(1); // never double-scores

    // Collision precedence: in the SAME step, pipe A becomes score-eligible
    // (fully passed, unscored) while pipe B collides. A scoring-first
    // implementation would record score 1 before dying; collision-first
    // leaves it at 0 (docs rule edge).
    const colliding: FlappyState = {
      y: 300 - GAP_HALF - PLAYER_RADIUS + 1, // intersects pipe B's top arm
      vy: 0,
      pipes: [
        // Pipe A: already fully behind the player and NOT yet scored —
        // score-eligible the moment scoring runs.
        { x: 5, gapCenter: 500, scored: false },
        // Pipe B: overlapping the player horizontally this step.
        { x: PLAYER_X - PIPE_WIDTH + 2, gapCenter: 300, scored: false },
        { x: 580, gapCenter: 300, scored: false },
      ],
      score: 0,
      status: "running",
    };
    step(colliding, rng);
    expect(colliding.status).toBe("lost");
    expect(colliding.score).toBe(0); // pipe A never scored — collision won
    // End-at-most-once: further steps are frozen no-ops.
    const snapshot = JSON.parse(JSON.stringify(colliding)) as FlappyState;
    step(colliding, rng);
    flap(colliding);
    expect(colliding).toEqual(snapshot);
  });

  it("V5: restart with the same seed replays identically", () => {
    const run = (seed: string) => {
      const rng = seededRandom(seed);
      const state = createFlappyState(rng);
      for (let i = 0; i < 120; i++) {
        if (i % 20 === 0) flap(state);
        step(state, rng);
      }
      return state;
    };
    expect(run("flappy-v5")).toEqual(run("flappy-v5"));
  });

  it("V1b: leaving the vertical bounds ends the run", () => {
    const rng = seededRandom("flappy-v1b");
    const state = createFlappyState(rng);
    for (let i = 0; i < 200 && state.status === "running"; i++) {
      step(state, rng); // no input → falls to the floor
    }
    expect(state.status).toBe("lost");
  });
});
