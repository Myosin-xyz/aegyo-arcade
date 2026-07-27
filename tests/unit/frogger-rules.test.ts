/**
 * Cross to the Concert rule vectors (docs/games/frogger.md, M3
 * acceptance): eased speed table, seeded lane build, new-best-row
 * scoring, collision boundary + invuln, hit consequences (current-level
 * checkpoint reset, obstacles untouched), guard-beat transitions, the
 * exact 30 maximum, 3rd-life loss, and seeded replay.
 */

import { describe, expect, it } from "vitest";
import { seededRandom } from "@/shell/rng";
import {
  CHECKPOINT_TICKS,
  GAME_W,
  HERO_HALF,
  HERO_X,
  INSTANCES_PER_LANE,
  INVULN_TICKS,
  JITTER_MAX,
  LANES,
  LIVES,
  MAX_SCORE,
  POINTS_PER_LEVEL,
  START_ROW,
  TOTAL_LEVELS,
  buildLanes,
  createFroggerState,
  formatTime,
  laneDrawWidth,
  move,
  speedMult,
  step,
  type FroggerState,
} from "@/games/frogger/logic";

/** Park every obstacle far off the hero's column. */
function clearTraffic(state: FroggerState): void {
  for (const lane of state.lanes) lane.xs = [-1000, -1000];
}

/** Drive a full clean level: 6 forward moves + the checkpoint beat. */
function crossLevelClean(state: FroggerState, rng: () => number): void {
  clearTraffic(state);
  for (let i = 0; i < POINTS_PER_LEVEL; i++) {
    move(state, -1);
    step(state, rng);
    clearTraffic(state); // level advance re-rolls lanes — keep them clear
  }
  for (let i = 0; i <= CHECKPOINT_TICKS + 1; i++) step(state, rng);
}

describe("frogger — linear speed ramp (V1, Daidai 2026-07-27 tuning)", () => {
  it("5 levels: 1.0 at L1 → 2.0 at L5, a full +25% per level", () => {
    expect(TOTAL_LEVELS).toBe(5); // 10 was too long (Daidai)
    expect(speedMult(1)).toBe(1);
    expect(speedMult(5)).toBe(2);
    // The full run table: the climb must be FELT on every advance — the
    // prior +11%/level over 10 levels played as flat.
    expect([1, 2, 3, 4, 5].map((l) => +speedMult(l).toFixed(2))).toEqual([
      1.0, 1.25, 1.5, 1.75, 2.0,
    ]);
    // Strictly increasing with a CONSTANT per-level gain of 1/4 (linear).
    for (let level = 2; level <= TOTAL_LEVELS; level++) {
      const gain = speedMult(level) - speedMult(level - 1);
      expect(gain).toBeCloseTo(1 / 4, 10);
    }
  });
});

describe("frogger — seeded lane build (V2)", () => {
  it("2 instances per lane at 180·i + [0,40) jitter; deterministic per seed", () => {
    const lanes = buildLanes(seededRandom("lanes-1"));
    expect(lanes).toHaveLength(5);
    for (const lane of lanes) {
      expect(lane.xs).toHaveLength(INSTANCES_PER_LANE);
      for (let i = 0; i < INSTANCES_PER_LANE; i++) {
        const base = (GAME_W / INSTANCES_PER_LANE) * i;
        expect(lane.xs[i]).toBeGreaterThanOrEqual(base);
        expect(lane.xs[i]).toBeLessThan(base + JITTER_MAX);
      }
    }
    expect(buildLanes(seededRandom("lanes-1"))).toEqual(lanes);
    expect(buildLanes(seededRandom("lanes-2"))).not.toEqual(lanes);
  });
});

describe("frogger — scoring is monotonic new-best-row credit (V3)", () => {
  it("forward credits, backward never debits, re-crossing re-earns nothing", () => {
    const state = createFroggerState(seededRandom("score"));
    clearTraffic(state);
    move(state, -1);
    move(state, -1);
    expect(state.score).toBe(2);
    move(state, 1); // retreat — no debit
    expect(state.score).toBe(2);
    move(state, -1); // re-cross the same row — no re-earn
    expect(state.score).toBe(2);
    move(state, -1); // NEW best row — credits
    expect(state.score).toBe(3);
  });

  it("backward move at the start row is a no-op", () => {
    const state = createFroggerState(seededRandom("bounds"));
    move(state, 1);
    expect(state.row).toBe(START_ROW);
    expect(state.score).toBe(0);
  });
});

describe("frogger — collision boundary + invuln (V4)", () => {
  it("hit iff |x − 180| < 9 + 0.3·drawW (strict); invuln 90 skips", () => {
    const state = createFroggerState(seededRandom("hit"));
    clearTraffic(state);
    move(state, -1); // row 5 = guard lane (LANES[4])
    const guard = LANES[4];
    const threshold = HERO_HALF + 0.3 * laneDrawWidth(guard);
    const rng = seededRandom("hit-inert");

    // Just OUTSIDE the threshold after this tick's motion: no hit (an
    // exact-equality placement is unreachable under FP addition — the
    // strict `<` is proven by ε on both sides). The guard moves +speed
    // each step, so place it relative to its post-step position.
    const v = guard.baseSpeed * speedMult(1);
    state.lanes[4].xs = [HERO_X + threshold - v + 0.001, -1000];
    step(state, rng);
    expect(state.lives).toBe(LIVES);

    // Just inside: hit — life lost, hero back to start, invuln armed.
    state.lanes[4].xs = [HERO_X + threshold - v - 0.01, -1000];
    step(state, rng);
    expect(state.lives).toBe(LIVES - 1);
    expect(state.row).toBe(START_ROW);
    expect(state.invuln).toBe(INVULN_TICKS);

    // Invulnerable: standing in traffic costs nothing.
    move(state, -1);
    state.lanes[4].xs = [HERO_X, HERO_X];
    step(state, rng);
    expect(state.lives).toBe(LIVES - 1);
  });

  it("a hit does NOT reset obstacles, bestRow, or the stopwatch", () => {
    const state = createFroggerState(seededRandom("hit-keeps"));
    clearTraffic(state);
    move(state, -1);
    move(state, -1); // row 4, bestRow 4, score 2
    const rng = seededRandom("hit-keeps-inert");
    step(state, rng);
    const tickBefore = state.tick;
    const merchXs = [...state.lanes[1].xs];
    state.lanes[3].xs = [HERO_X, -1000]; // kfood lane = hero's row 4
    step(state, rng);
    expect(state.lives).toBe(LIVES - 1);
    expect(state.row).toBe(START_ROW);
    expect(state.bestRow).toBe(4); // retained — no re-earning
    expect(state.score).toBe(2);
    expect(state.tick).toBe(tickBefore + 1); // stopwatch keeps counting
    // Other lanes advanced normally, never reset.
    expect(state.lanes[1].xs).not.toEqual(merchXs);
  });
});

describe("frogger — guard beats + level flow (V5)", () => {
  it("goal → ACCESS DENIED beat: obstacles frozen 105 ticks, then level++ with re-rolled lanes", () => {
    const state = createFroggerState(seededRandom("beat"));
    clearTraffic(state);
    const rng = seededRandom("beat-rng");
    for (let i = 0; i < POINTS_PER_LEVEL; i++) move(state, -1);
    expect(state.status).toBe("checkpoint");
    expect(state.checkpointKind).toBe("denied");
    expect(state.score).toBe(POINTS_PER_LEVEL);

    const frozen = state.lanes.map((lane) => [...lane.xs]);
    for (let i = 0; i < CHECKPOINT_TICKS; i++) step(state, rng);
    expect(state.status).toBe("checkpoint"); // still holding
    expect(state.lanes.map((l) => [...l.xs])).toEqual(frozen); // frozen

    step(state, rng); // timer crosses 105 → resolve
    expect(state.status).toBe("playing");
    expect(state.level).toBe(2);
    expect(state.row).toBe(START_ROW);
    expect(state.bestRow).toBe(START_ROW);
    expect(state.lanes.map((l) => [...l.xs])).not.toEqual(frozen); // re-rolled
  });

  it("a perfect 5-level run scores EXACTLY 30 and ends won (V6)", () => {
    const state = createFroggerState(seededRandom("perfect"));
    const rng = seededRandom("perfect-rng");
    for (let level = 1; level <= TOTAL_LEVELS; level++) {
      expect(state.level).toBe(level);
      crossLevelClean(state, rng);
    }
    expect(state.status).toBe("won");
    expect(state.score).toBe(MAX_SCORE);
    expect(state.score).toBe(30); // 5 levels × 6 rows
  });

  it("the 3rd hit ends the run as lost (V7)", () => {
    const state = createFroggerState(seededRandom("threehits"));
    const rng = seededRandom("threehits-rng");
    for (let hit = 1; hit <= LIVES; hit++) {
      clearTraffic(state);
      move(state, -1); // guard lane
      state.invuln = 0;
      state.lanes[4].xs = [HERO_X, -1000];
      step(state, rng);
    }
    expect(state.lives).toBe(0);
    expect(state.status).toBe("lost");
  });
});

describe("frogger — seeded replay (V8)", () => {
  it("same seed + same move script → identical state; different seed diverges", () => {
    const play = (seed: string): FroggerState => {
      const rng = seededRandom(seed);
      const state = createFroggerState(rng);
      for (let tick = 0; tick < 60 * 40; tick++) {
        if (tick % 45 === 0) move(state, -1);
        if (tick % 200 === 199) move(state, 1);
        step(state, rng);
        if (state.status === "won" || state.status === "lost") break;
      }
      return state;
    };
    const a = play("replay-1");
    expect(play("replay-1")).toEqual(a);
    expect(a.tick).toBeGreaterThan(0);
    expect(JSON.stringify(play("replay-2"))).not.toBe(JSON.stringify(a));
  });

  it("stopwatch formats m:ss (delivery format)", () => {
    expect(formatTime(0)).toBe("0:00");
    expect(formatTime(60 * 7)).toBe("0:07");
    expect(formatTime(60 * 83)).toBe("1:23");
  });
});
