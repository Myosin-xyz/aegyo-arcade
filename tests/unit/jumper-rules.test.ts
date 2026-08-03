/** Comeback Climb delivery-parity and mobile-control vectors. */

import { describe, expect, it } from "vitest";
import { seededRandom } from "@/shell/rng";
import {
  applyThumbImpulse,
  bounceVelocity,
  createJumperState,
  rankAtAltitude,
  step,
  thumbImpulseAt,
  zoneIndexForRank,
  DESIGN,
  GRAVITY,
  HORIZONTAL_ACCEL,
  HORIZONTAL_FRICTION,
  HORIZONTAL_MAX,
  JUMP_HEIGHT,
  MAX_SCORE,
  RANK_HEIGHT,
  RESPAWN_DELAY_MS,
  SCORE_PER_RANK,
  STARTING_LIVES,
  STEP_MS,
  TUTORIAL_UNTIL_RANK,
  ZONES,
  type Platform,
} from "@/games/jumper/logic";

const idle = { left: false, right: false } as const;

describe("Comeback Climb rules", () => {
  it("V1: preserves the delivered progression, zones, and bounce physics", () => {
    expect(TUTORIAL_UNTIL_RANK).toBe(90);
    expect(ZONES).toEqual([
      expect.objectContaining({ gapMin: 0.13, gapMax: 0.175, moving: 0.06 }),
      expect.objectContaining({ gapMin: 0.15, gapMax: 0.2, droneEvery: 3.2 }),
      expect.objectContaining({ gapMin: 0.16, gapMax: 0.225, cdSpeed: 1.4 }),
    ]);
    expect(zoneIndexForRank(90)).toBe(0);
    expect(zoneIndexForRank(50)).toBe(1);
    expect(zoneIndexForRank(10)).toBe(2);
    expect(rankAtAltitude(0)).toBe(100);
    expect(rankAtAltitude(99 * RANK_HEIGHT)).toBe(1);
    expect(bounceVelocity() ** 2).toBeCloseTo(2 * GRAVITY * JUMP_HEIGHT, 8);
  });

  it("V2: seeded worlds replay exactly and generated gaps stay reachable", () => {
    const first = createJumperState(seededRandom("comeback-world"));
    const replay = createJumperState(seededRandom("comeback-world"));
    expect(first).toEqual(replay);
    for (let i = 1; i < first.platforms.length; i += 1) {
      const previous = first.platforms[i - 1];
      const current = first.platforms[i];
      expect(current.y - previous.y).toBeLessThanOrEqual(DESIGN.h * 0.225);
      expect(Math.abs(current.x - previous.x)).toBeLessThanOrEqual(
        DESIGN.w * 0.42,
      );
      expect(previous.type === "card" && current.type === "card").toBe(false);
    }
  });

  it("V3: invisible thumb quarters produce small/large directional impulses", () => {
    expect(thumbImpulseAt(0)).toBeCloseTo(-HORIZONTAL_MAX * 0.9);
    expect(thumbImpulseAt(89)).toBeCloseTo(-HORIZONTAL_MAX * 0.9);
    expect(thumbImpulseAt(91)).toBeCloseTo(-HORIZONTAL_MAX * 0.42);
    expect(thumbImpulseAt(179)).toBeCloseTo(-HORIZONTAL_MAX * 0.42);
    expect(thumbImpulseAt(181)).toBeCloseTo(HORIZONTAL_MAX * 0.42);
    expect(thumbImpulseAt(269)).toBeCloseTo(HORIZONTAL_MAX * 0.42);
    expect(thumbImpulseAt(271)).toBeCloseTo(HORIZONTAL_MAX * 0.9);
    expect(thumbImpulseAt(360)).toBeCloseTo(HORIZONTAL_MAX * 0.9);

    const state = createJumperState(seededRandom("thumb-impulse"));
    applyThumbImpulse(state, 30);
    expect(state.hero.vx).toBeCloseTo(-HORIZONTAL_MAX * 0.9);
    applyThumbImpulse(state, 330);
    expect(state.hero.vx).toBeCloseTo(0);
  });

  it("V4: held keyboard steering retains the delivered acceleration/friction", () => {
    const rng = seededRandom("keyboard-physics");
    const state = createJumperState(rng);
    const x = state.hero.x;
    step(state, { left: false, right: true }, rng);
    expect(state.hero.vx).toBeCloseTo(
      HORIZONTAL_ACCEL * HORIZONTAL_FRICTION,
      8,
    );
    expect(state.hero.x).toBeGreaterThan(x);
    for (let i = 0; i < 120; i += 1) {
      step(state, { left: false, right: true }, rng);
    }
    expect(Math.abs(state.hero.vx)).toBeLessThanOrEqual(HORIZONTAL_MAX);
  });

  it("V5: a photocard cracks on first landing and breaks on the second", () => {
    const rng = seededRandom("photocard");
    const state = createJumperState(rng);
    const card: Platform = {
      x: 180,
      y: 100,
      type: "card",
      width: 57.6,
      state: 0,
      vx: 0,
      speaker: false,
      skin: "plat_pink",
    };
    state.platforms = [card];
    state.generatedY = 2000;
    state.cameraY = 0;
    state.hero.x = 180;
    state.hero.y = 102;
    state.hero.vy = 2;
    expect(step(state, idle, rng).bounce).toBe("normal");
    expect(card.state).toBe(1);
    state.hero.y = 102;
    state.hero.vy = 2;
    expect(step(state, idle, rng).bounce).toBeUndefined();
    expect(card.state).toBe(2);
  });

  it("V6: rank progress scores 10 each and #1 completes", () => {
    const rng = seededRandom("rank-one");
    const state = createJumperState(rng);
    state.platforms = [];
    state.drones = [];
    state.pickups = [];
    state.notes = [];
    state.generatedY = 100 * RANK_HEIGHT;
    state.rank = 2;
    state.score = 98 * SCORE_PER_RANK;
    state.maxClimb = 98 * RANK_HEIGHT;
    state.hero.y = 99 * RANK_HEIGHT - 2;
    state.hero.vy = -4;
    state.cameraY = state.hero.y - DESIGN.h / 2;
    const events = step(state, idle, rng);
    expect(events.ended).toBe("completed");
    expect(state.rank).toBe(1);
    expect(state.score).toBe(990);
    expect(state.status).toBe("won");
  });

  it("V7: a nonfatal fall costs one life, waits 700ms, then safely bounces", () => {
    const rng = seededRandom("respawn");
    const state = createJumperState(rng);
    state.platforms = [];
    state.drones = [];
    state.pickups = [];
    state.notes = [];
    state.generatedY = 2000;
    state.cameraY = 0;
    state.hero.y = -DESIGN.h * 0.06;
    state.hero.vy = 0;
    const first = step(state, idle, rng);
    expect(first.hit).toBe(true);
    expect(state.lives).toBe(STARTING_LIVES - 1);
    expect(state.status).toBe("respawning");
    expect(state.respawnMs).toBe(RESPAWN_DELAY_MS);
    const elapsedAtHit = state.elapsedMs;
    for (let i = 0; i < 41; i += 1) step(state, idle, rng);
    expect(state.status).toBe("respawning");
    const resumed = step(state, idle, rng);
    expect(resumed.respawned).toBe(true);
    expect(state.status).toBe("playing");
    expect(state.hero.vy).toBeCloseTo(bounceVelocity());
    expect(state.elapsedMs - elapsedAtHit).toBeCloseTo(42 * STEP_MS);
  });

  it("V8: collectible scoring is bounded by the adopted 2490 envelope", () => {
    const rng = seededRandom("score-cap");
    const state = createJumperState(rng);
    state.platforms = [];
    state.drones = [];
    state.pickups = [];
    state.generatedY = 2000;
    state.cameraY = 0;
    state.score = MAX_SCORE - 2;
    state.notes = [
      {
        x: state.hero.x,
        y: state.hero.y + state.hero.h / 2,
        kind: "note_gold",
        got: false,
      },
    ];
    step(state, idle, rng);
    expect(state.score).toBe(MAX_SCORE);
  });

  it("V9: identical seed plus identical thumb/keyboard script is exact", () => {
    const run = () => {
      const rng = seededRandom("comeback-replay");
      const state = createJumperState(rng);
      for (let i = 0; i < 400; i += 1) {
        if (i % 53 === 0) applyThumbImpulse(state, i % 106 === 0 ? 40 : 320);
        step(state, { left: i % 90 < 12, right: i % 130 > 118 }, rng);
      }
      return state;
    };
    expect(run()).toEqual(run());
  });
});
