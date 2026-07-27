/**
 * Bias Flap rule vectors (docs/games/bias-flap.md): the delivery's level
 * table, per-gate scoring to the exact 1700 perfect run, gap fairness,
 * crash → level-restart with score rollback, the cash-out path, the
 * active-play clock, and seeded determinism.
 */

import { describe, expect, it } from "vitest";
import { seededRandom } from "@/shell/rng";
import {
  CRASH_BEAT_MS,
  DESIGN_H,
  GAP_MARGIN_FRAC,
  HERO_H,
  HERO_X,
  LEVELS,
  MAX_GAP_JUMP_FRAC,
  MAX_SCORE,
  SCORE_PER_GATE,
  STEP_MS,
  STICK_W,
  cashOut,
  continueFromLevelBreak,
  createFlappyState,
  flap,
  formatTime,
  keepFlying,
  openQuitConfirm,
  setupLevel,
  step,
  tick,
  type FlappyState,
} from "@/games/flappy/logic";

const rngOf = (seed: string) => seededRandom(seed);

/**
 * Drive every remaining gate of the current level past the hero, keeping
 * the hero glued to a safe gap center. NEAREST-by-x, not next-unpassed:
 * `passed` flips while the stick still overlaps the hero horizontally,
 * so snapping to the next gate's center at that instant teleports the
 * hero into the just-passed stick's orb zone. These vectors are about
 * rules, not navigation.
 */
function clearLevel(state: FlappyState): void {
  if (state.status === "waiting") flap(state);
  let guard = 0;
  while (state.status === "flying" && guard++ < 100_000) {
    let nearest = state.obstacles[0];
    for (const o of state.obstacles) {
      if (Math.abs(o.x - HERO_X) < Math.abs(nearest.x - HERO_X)) nearest = o;
    }
    if (nearest) state.heroY = (nearest.gapTop + nearest.gapBot) / 2;
    state.heroVy = 0; // cancel gravity
    tick(state);
  }
  if (guard >= 100_000) throw new Error("clearLevel did not terminate");
}

describe("bias flap — delivery constants (V1)", () => {
  it("5-level table verbatim from config.js; perfect run is exactly 1700", () => {
    expect(LEVELS.map((l) => l.gates)).toEqual([6, 8, 10, 12, 14]);
    expect(LEVELS.map((l) => l.speed)).toEqual([2.4, 2.6, 2.8, 3.0, 3.2]);
    expect(LEVELS.map((l) => l.gap)).toEqual([0.335, 0.315, 0.3, 0.285, 0.27]);
    expect(SCORE_PER_GATE).toBe(10);
    expect(MAX_SCORE).toBe(1700); // 60 + 160 + 300 + 480 + 700
  });
});

describe("bias flap — scoring and progression (V2)", () => {
  it("a full clean run scores exactly MAX_SCORE through the real path", () => {
    const rng = rngOf("perfect");
    const state = createFlappyState(rng);
    for (let level = 0; level < LEVELS.length; level++) {
      expect(state.level).toBe(level);
      clearLevel(state);
      if (level < LEVELS.length - 1) {
        expect(state.status).toBe("levelBreak");
        continueFromLevelBreak(state, rng);
      }
    }
    expect(state.status).toBe("won");
    expect(state.score).toBe(MAX_SCORE);
    expect(state.totalGates).toBe(6 + 8 + 10 + 12 + 14);
  });

  it("each gate pays 10 × level number", () => {
    const rng = rngOf("pergате");
    const state = createFlappyState(rng);
    flap(state);
    const first = state.obstacles[0];
    state.heroY = (first.gapTop + first.gapBot) / 2;
    state.heroVy = 0;
    while (!first.passed) {
      state.heroY = (first.gapTop + first.gapBot) / 2;
      state.heroVy = 0;
      tick(state);
    }
    expect(state.score).toBe(10); // level 1
    expect(state.gates).toBe(1);
    expect(state.totalGates).toBe(1);
  });
});

describe("bias flap — crash restarts the level and rolls the score back (V3)", () => {
  it("crash → 850ms beat → same level, score at level-start, gates re-seeded; totalGates keeps counting", () => {
    const rng = rngOf("crashy");
    const state = createFlappyState(rng);

    // Pass one gate legitimately, then crash into the ceiling.
    flap(state);
    const first = state.obstacles.find((o) => !o.passed)!;
    while (!first.passed) {
      state.heroY = (first.gapTop + first.gapBot) / 2;
      state.heroVy = 0;
      tick(state);
    }
    const gapsBefore = state.obstacles.map((o) => o.gapTop);
    expect(state.score).toBe(10);
    expect(state.totalGates).toBe(1);

    state.heroY = -DESIGN_H; // way past the ceiling forgiveness
    tick(state);
    expect(state.status).toBe("crashed");

    // The beat holds the level, then the respawn rolls back.
    expect(step(state, CRASH_BEAT_MS - 1, rng)).toBe("crashed");
    expect(step(state, 1, rng)).toBe("waiting");
    expect(state.score).toBe(0); // rolled back to the level-start value
    expect(state.gates).toBe(0);
    expect(state.totalGates).toBe(1); // the lifetime stat NEVER rolls back
    expect(state.level).toBe(0);
    // Retry gaps come from the CONTINUING rng stream — fresh layout.
    expect(state.obstacles.map((o) => o.gapTop)).not.toEqual(gapsBefore);
  });

  it("crash rollback returns to the LEVEL-start score, not zero", () => {
    const rng = rngOf("rollback");
    const state = createFlappyState(rng);
    clearLevel(state); // level 1 banked: 60
    continueFromLevelBreak(state, rng);
    expect(state.levelStartScore).toBe(60);

    flap(state);
    state.heroY = -DESIGN_H;
    tick(state);
    step(state, CRASH_BEAT_MS, rng);
    expect(state.score).toBe(60); // level-2 progress gone, bank intact
  });
});

describe("bias flap — cash-out (V4)", () => {
  it("leave → confirm → cashedOut keeps the current score; keep flying resumes", () => {
    const rng = rngOf("cashout");
    const state = createFlappyState(rng);
    clearLevel(state);
    continueFromLevelBreak(state, rng);
    flap(state);

    expect(openQuitConfirm(state)).toBe(true);
    expect(state.status).toBe("quitConfirm");
    // The confirm freezes the sim AND the clock.
    const elapsedAt = state.elapsedMs;
    expect(step(state, 5000, rng)).toBe("quitConfirm");
    expect(state.elapsedMs).toBe(elapsedAt);

    keepFlying(state);
    expect(state.status).toBe("flying");

    openQuitConfirm(state);
    cashOut(state);
    expect(state.status).toBe("cashedOut");
    expect(state.score).toBe(60); // banked score survives the exit
  });

  it("the confirm can open from waiting and returns to waiting", () => {
    const state = createFlappyState(rngOf("wait"));
    expect(openQuitConfirm(state)).toBe(true);
    keepFlying(state);
    expect(state.status).toBe("waiting");
  });
});

describe("bias flap — gap fairness (V5)", () => {
  it("every consecutive gap-center shift is ≤ 24% of height, within margins, at every level", () => {
    const rng = rngOf("fairness");
    const state = createFlappyState(rng);
    for (let level = 0; level < LEVELS.length; level++) {
      state.level = level;
      setupLevel(state, rng, "fresh");
      const centers = state.obstacles.map((o) => (o.gapTop + o.gapBot) / 2);
      const gapH = DESIGN_H * LEVELS[level].gap;
      const margin = DESIGN_H * GAP_MARGIN_FRAC;
      for (let i = 0; i < centers.length; i++) {
        expect(centers[i]).toBeGreaterThanOrEqual(margin + gapH / 2 - 1e-9);
        expect(centers[i]).toBeLessThanOrEqual(
          DESIGN_H - margin - gapH / 2 + 1e-9,
        );
        if (i > 0) {
          expect(Math.abs(centers[i] - centers[i - 1])).toBeLessThanOrEqual(
            DESIGN_H * MAX_GAP_JUMP_FRAC + 1e-9,
          );
        }
      }
    }
  });
});

describe("bias flap — clock (V6)", () => {
  it("runs from the level's first flap through crashes; frozen before arming and on level breaks", () => {
    const rng = rngOf("clock");
    const state = createFlappyState(rng);

    // Unarmed waiting: no time accrues.
    step(state, 2000, rng);
    expect(state.elapsedMs).toBe(0);

    flap(state);
    step(state, 1000, rng);
    expect(state.elapsedMs).toBe(1000);

    // Crash: the beat still counts (delivery: the interval keeps going).
    state.heroY = -DESIGN_H;
    tick(state);
    step(state, CRASH_BEAT_MS, rng);
    expect(state.elapsedMs).toBe(1000 + CRASH_BEAT_MS);
    // Post-crash waiting is still armed — the clock keeps running.
    step(state, 500, rng);
    expect(state.elapsedMs).toBe(1500 + CRASH_BEAT_MS);

    // A level break freezes it; the NEXT level re-arms on first flap.
    clearLevel(state);
    const atBreak = state.elapsedMs;
    step(state, 3000, rng);
    expect(state.elapsedMs).toBe(atBreak);
    continueFromLevelBreak(state, rng);
    step(state, 3000, rng); // new level, not yet armed
    expect(state.elapsedMs).toBe(atBreak);
    flap(state);
    step(state, STEP_MS, rng);
    expect(state.elapsedMs).toBe(atBreak + STEP_MS);
  });

  it("formats MM:SS", () => {
    expect(formatTime(0)).toBe("00:00");
    expect(formatTime(7_000)).toBe("00:07");
    expect(formatTime(433_000)).toBe("07:13"); // the reference screenshot
  });
});

describe("bias flap — determinism (V7)", () => {
  it("same seed → identical gap layouts across levels and retries", () => {
    const layout = (seed: string): number[][] => {
      const rng = rngOf(seed);
      const state = createFlappyState(rng);
      const all: number[][] = [state.obstacles.map((o) => o.gapTop)];
      // Crash once, capture the retry layout too.
      flap(state);
      state.heroY = -DESIGN_H;
      tick(state);
      step(state, CRASH_BEAT_MS, rng);
      all.push(state.obstacles.map((o) => o.gapTop));
      return all;
    };
    expect(layout("replay-a")).toEqual(layout("replay-a"));
    expect(layout("replay-b")).not.toEqual(layout("replay-a"));
  });

  it("geometry sanity: hero and sticks fit the design box", () => {
    expect(HERO_X + HERO_H).toBeLessThan(DESIGN_H);
    expect(STICK_W).toBeGreaterThan(0);
  });
});
