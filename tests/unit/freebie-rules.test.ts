/**
 * Freebie Frenzy rule vectors (docs/games/freebie.md, M2.5 acceptance):
 * queue composition, combo curve + half-up rounding, collision
 * boundaries (incl. wobble displacement), lives/miss/end, level
 * completion + clean-clear bonus, the 2277 maximum through the
 * production scoring path, and seeded replay.
 */

import { describe, expect, it } from "vitest";
import { seededRandom } from "@/shell/rng";
import {
  CATCH_SLACK,
  CATCH_TOLERANCE,
  CATCH_Y,
  CLEAN_BONUS_PER_LEVEL,
  DESIGN_H,
  GUARANTEED_TIER,
  HERO_W,
  ITEMS_PER_LEVEL,
  LEVEL_CONFIG,
  LIVES_PER_LEVEL,
  STEP_MS,
  TIER_POINTS,
  MISS_FLASH_SEC,
  TOTAL_LEVELS,
  buildLevelQueue,
  comboMultiplier,
  completeLevel,
  continueFromRecap,
  createFreebieState,
  fanRank,
  fitFontPx,
  freebieDrawX,
  scoreCatch,
  step,
  type Freebie,
  type FreebieInput,
  type FreebieState,
} from "@/games/freebie/logic";

const IDLE: FreebieInput = { left: false, right: false, dragX: null };

function makeFreebie(partial: Partial<Freebie> = {}): Freebie {
  return {
    tier: 0,
    x: 240,
    y: CATCH_Y,
    vy: 0,
    size: 46,
    rot: 0,
    rotSpeed: 0,
    wobble: 0,
    ...partial,
  };
}

/** Silence spawning so collision vectors control the field exactly. */
function quietState(seed = "freebie-quiet"): FreebieState {
  const state = createFreebieState(seededRandom(seed));
  state.queue = [];
  state.spawned = 0; // completion requires spawned >= 10, so no recap fires
  state.freebies = [];
  return state;
}

describe("freebie — queue composition (V1)", () => {
  it("every level: 10 items, exactly one guaranteed lightstick beyond the pool odds, pool bounds respected", () => {
    for (let level = 1; level <= TOTAL_LEVELS; level++) {
      const { poolSize } = LEVEL_CONFIG[level - 1];
      for (let run = 0; run < 25; run++) {
        const queue = buildLevelQueue(
          seededRandom(`queue-${level}-${run}`),
          level,
        );
        expect(queue).toHaveLength(ITEMS_PER_LEVEL);
        expect(
          queue.filter((t) => t === GUARANTEED_TIER).length,
        ).toBeGreaterThanOrEqual(1);
        for (const tier of queue) {
          // Weighted picks stay inside the level pool; only the
          // guaranteed insert may exceed it.
          if (tier !== GUARANTEED_TIER) expect(tier).toBeLessThan(poolSize);
        }
      }
    }
  });

  it("level 1 pool is tiers 0–1 plus the single guaranteed rare (delivery parity)", () => {
    const queue = buildLevelQueue(seededRandom("queue-l1"), 1);
    const rares = queue.filter((t) => t === GUARANTEED_TIER);
    expect(rares).toHaveLength(1);
    for (const tier of queue) {
      expect([0, 1, GUARANTEED_TIER]).toContain(tier);
    }
  });

  it("same seed → identical queue (determinism)", () => {
    expect(buildLevelQueue(seededRandom("q-det"), 3)).toEqual(
      buildLevelQueue(seededRandom("q-det"), 3),
    );
    expect(buildLevelQueue(seededRandom("q-det-b"), 3)).not.toEqual(
      buildLevelQueue(seededRandom("q-det"), 3),
    );
  });
});

describe("freebie — combo curve + rounding (V2)", () => {
  it("catches 1–10 multiply ×1.0 ×3, ×1.1 ×4, ×1.2 ×3; higher tiers unreachable in a level", () => {
    const expected = [1.0, 1.0, 1.0, 1.1, 1.1, 1.1, 1.1, 1.2, 1.2, 1.2];
    for (let catchIndex = 1; catchIndex <= 10; catchIndex++) {
      expect(comboMultiplier(catchIndex)).toBeCloseTo(
        expected[catchIndex - 1],
        10,
      );
    }
    expect(comboMultiplier(20)).toBeCloseTo(1.5, 10); // cap exists…
    expect(comboMultiplier(40)).toBeCloseTo(1.5, 10); // …and stays capped
  });

  it("half-up rounding is load-bearing: tier2 at ×1.1 → 17, tier5 at ×1.2 → 60", () => {
    const state = quietState();
    state.combo = 3; // next catch is #4 → ×1.1
    expect(scoreCatch(state, 2)).toBe(17); // round(16.5) half-up
    state.combo = 7; // next catch is #8 → ×1.2
    expect(scoreCatch(state, 5)).toBe(60); // round(60)
  });
});

describe("freebie — catch collision (V3)", () => {
  function stepOnce(state: FreebieState): void {
    step(state, IDLE, seededRandom("v3-inert"));
  }

  it("X boundary is strict: exactly at half-widths−slack misses, just inside catches", () => {
    const state = quietState();
    const size = 46;
    const limit = HERO_W / 2 + size / 2 - CATCH_SLACK;
    // Freebie advances by vy*dt each step — place it in the window with
    // vy=0 so only X decides. wobble=0 → drawX === x.
    state.freebies = [
      makeFreebie({ x: state.catcher.x + limit, y: CATCH_Y, size }),
    ];
    stepOnce(state);
    expect(state.freebies).toHaveLength(1); // |d| === limit → NOT caught
    expect(state.score).toBe(0);

    state.freebies = [
      makeFreebie({ x: state.catcher.x + limit - 0.5, y: CATCH_Y, size }),
    ];
    stepOnce(state);
    expect(state.freebies).toHaveLength(0);
    expect(state.score).toBe(TIER_POINTS[0]);
  });

  it("Y window is inclusive at ±tolerance around the catch line", () => {
    const state = quietState();
    // step() moves y by vy*dt BEFORE the check; vy=0 keeps placement exact.
    state.freebies = [
      makeFreebie({ y: CATCH_Y - CATCH_TOLERANCE, x: state.catcher.x }),
    ];
    stepOnce(state);
    expect(state.freebies).toHaveLength(0); // top edge catches

    const below = quietState("v3-below");
    below.freebies = [
      makeFreebie({ y: CATCH_Y + CATCH_TOLERANCE + 0.001, x: below.catcher.x }),
    ];
    stepOnce(below);
    expect(below.freebies).toHaveLength(1); // just past the window → falls on
  });

  it("wobble displaces the COLLISION x, not just the sprite (delivery parity)", () => {
    const state = quietState();
    const size = 46;
    const limit = HERO_W / 2 + size / 2 - CATCH_SLACK;
    // Base x just outside the window on the +x side; wobble sin(−π/2)=−1
    // shifts drawX 8px back toward the catcher — the wobble makes this
    // a catch.
    const f = makeFreebie({
      x: state.catcher.x + limit + 4,
      y: CATCH_Y,
      size,
      wobble: -Math.PI / 2 - (STEP_MS / 1000) * 3, // ≈ −π/2 after one step
    });
    expect(Math.abs(f.x - state.catcher.x)).toBeGreaterThanOrEqual(limit);
    state.freebies = [f];
    stepOnce(state);
    expect(state.freebies).toHaveLength(0);
    expect(freebieDrawX(f)).toBeLessThan(f.x); // sin(π/2)*8 pulled it inward
  });
});

describe("freebie — lives, misses, end (V4)", () => {
  it("a miss costs a life and resets combo; the 3rd miss ends the run as lost", () => {
    const state = quietState();
    state.combo = 6;
    const rng = seededRandom("v4");
    const drop = () => {
      state.freebies = [makeFreebie({ y: DESIGN_H + 24, x: 60 })];
      step(state, IDLE, rng);
    };
    drop();
    expect(state.lives).toBe(LIVES_PER_LEVEL - 1);
    expect(state.combo).toBe(0);
    expect(state.status).toBe("playing");
    drop();
    drop();
    expect(state.lives).toBe(0);
    expect(state.status).toBe("lost");
  });

  it("a miss arms the red flash to full, and it decays deterministically with DT (Daidai)", () => {
    const state = quietState();
    const rng = seededRandom("v4-flash");
    expect(state.missFlash).toBe(0);
    state.freebies = [makeFreebie({ y: DESIGN_H + 24, x: 60 })];
    step(state, IDLE, rng); // resolves the miss
    expect(state.missFlash).toBe(MISS_FLASH_SEC); // full brightness this step
    const after = state.missFlash;
    step(state, IDLE, rng); // no miss → decays
    expect(state.missFlash).toBeLessThan(after);
    expect(state.missFlash).toBeGreaterThan(0);
    for (let i = 0; i < 60; i++) step(state, IDLE, rng);
    expect(state.missFlash).toBe(0); // fully faded, never negative
  });
});

describe("freebie — fitFontPx helper math (V4b; production widths proven in the real-metrics e2e)", () => {
  it("base while it fits; shrinks proportionally past the box; floors at min; wider never renders bigger", () => {
    expect(fitFontPx(24, 30, 17)).toBe(17); // fits → base
    expect(fitFontPx(30, 30, 17)).toBe(17); // exactly fits → base
    expect(fitFontPx(40, 30, 17)).toBe(12); // over → floor(17*30/40)
    // Flooring the size guarantees the rendered width is always ≤ box.
    expect((40 * fitFontPx(40, 30, 17)) / 17).toBeLessThanOrEqual(30);
    expect(fitFontPx(30, 30, 17)).toBeGreaterThanOrEqual(fitFontPx(40, 30, 17));
    expect(fitFontPx(999, 30, 17)).toBe(10); // default min floor
    expect(fitFontPx(999, 30, 17, 9)).toBe(9); // Daidai: 9px permitted
    expect(fitFontPx(0, 30, 17)).toBe(17); // no-measure (jsdom) → base
  });
});

describe("freebie — level completion + bonus (V5)", () => {
  it("all 10 resolved → recap with level×50 bonus; continue starts the next level with fresh lives/combo", () => {
    const state = quietState();
    state.spawned = ITEMS_PER_LEVEL; // queue and field already empty
    state.combo = 5;
    state.lives = 2;
    const before = state.score;
    step(state, IDLE, seededRandom("v5"));
    expect(state.status).toBe("recap");
    expect(state.lastBonus).toBe(1 * CLEAN_BONUS_PER_LEVEL);
    expect(state.score).toBe(before + CLEAN_BONUS_PER_LEVEL);

    continueFromRecap(state, seededRandom("v5-next"));
    expect(state.level).toBe(2);
    expect(state.lives).toBe(LIVES_PER_LEVEL); // lives reset EVERY level
    expect(state.combo).toBe(0);
    expect(state.queue).toHaveLength(ITEMS_PER_LEVEL);
    expect(state.status).toBe("playing");
  });

  it("level 5 completion is the win, not a recap", () => {
    const state = quietState();
    state.level = 5;
    state.spawned = ITEMS_PER_LEVEL;
    step(state, IDLE, seededRandom("v5-win"));
    expect(state.status).toBe("won");
    expect(state.lastBonus).toBe(5 * CLEAN_BONUS_PER_LEVEL);
  });

  it("continueFromRecap is a no-op outside recap (hostile-caller guard)", () => {
    const state = quietState();
    continueFromRecap(state, seededRandom("v5-noop"));
    expect(state.level).toBe(1);
    expect(state.status).toBe("playing");
  });
});

describe("freebie — maximum score is exactly 2277 (V6)", () => {
  it("best-case composition through the production catch + bonus path", () => {
    const state = quietState("v6");
    state.score = 0;
    const perLevelBest = [208, 309, 406, 554, 800];
    // Best mix per level: 9 × top pool tier + the guaranteed lightstick
    // caught at a ×1.2 slot (catch #8). Level 5's pool includes tier 5,
    // so all ten are lightsticks.
    const topTier = [1, 2, 3, 4, 5];
    let expectedTotal = 0;
    for (let level = 1; level <= TOTAL_LEVELS; level++) {
      state.level = level;
      state.lives = LIVES_PER_LEVEL;
      state.combo = 0;
      state.levelScore = 0;
      const before = state.score;
      const order = Array.from({ length: 10 }, (_, i) =>
        i === 7 ? GUARANTEED_TIER : topTier[level - 1],
      );
      for (const tier of order) scoreCatch(state, tier);
      completeLevel(state);
      expect(state.score - before).toBe(perLevelBest[level - 1]);
      expectedTotal += perLevelBest[level - 1];
      if (level < TOTAL_LEVELS) expect(state.status).toBe("recap");
    }
    expect(state.score).toBe(2277);
    expect(expectedTotal).toBe(2277);
    expect(state.status).toBe("won");
    expect(fanRank(state.score)).toBe(6); // Legend Status
  });
});

describe("freebie — seeded replay (V7)", () => {
  it("same seed + same input script → identical state; different seed diverges", () => {
    const script = (tick: number): FreebieInput => ({
      left: tick % 120 < 40,
      right: tick % 120 >= 80,
      dragX: tick > 400 && tick < 520 ? 100 + tick / 4 : null,
    });
    const play = (seed: string): FreebieState => {
      const rng = seededRandom(seed);
      const state = createFreebieState(rng);
      for (let tick = 0; tick < 60 * 30; tick++) {
        step(state, script(tick), rng);
        if (state.status === "recap") continueFromRecap(state, rng);
        if (state.status === "won" || state.status === "lost") break;
      }
      return state;
    };
    const a = play("replay-1");
    const b = play("replay-1");
    expect(b).toEqual(a);
    expect(a.spawned).toBeGreaterThan(0); // the run actually simulated
    const c = play("replay-2");
    expect(JSON.stringify(c)).not.toBe(JSON.stringify(a));
  });
});

describe("freebie — delivery-parity physics + resolution order (M2.5 review P2)", () => {
  it("simultaneous Left+Right cancels accel and PRESERVES velocity (no friction)", () => {
    const state = quietState("p2-keys");
    state.catcher.vx = 200;
    const both: FreebieInput = { left: true, right: true, dragX: null };
    const rng = seededRandom("p2-keys-inert");
    for (let i = 0; i < 30; i++) step(state, both, rng);
    expect(state.catcher.vx).toBe(200); // delivery: friction only when idle
    const idleState = quietState("p2-keys-idle");
    idleState.catcher.vx = 200;
    for (let i = 0; i < 30; i++) step(idleState, IDLE, rng);
    expect(idleState.catcher.vx).toBeLessThan(3); // friction decays idle vx
  });

  it("two same-step catches resolve NEWEST-first across a combo boundary", () => {
    const state = quietState("p2-order");
    state.combo = 2; // next catch is #3 (×1.0), the one after #4 (×1.1)
    state.freebies = [
      makeFreebie({ tier: 0, x: state.catcher.x - 10, y: CATCH_Y }), // older
      makeFreebie({ tier: 5, x: state.catcher.x + 10, y: CATCH_Y, size: 66 }), // newer
    ];
    step(state, IDLE, seededRandom("p2-order-rng"));
    // Newest (tier 5) scores at ×1.0 → 50; older (tier 0) at ×1.1 → 6.
    // Oldest-first would give 5 + 55 = 60 — order is score-relevant.
    expect(state.score).toBe(56);
    expect(state.popups.map((p) => p.text)).toEqual(["+50", "+6"]);
  });
});
