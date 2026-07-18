/**
 * Comeback Climb rule vectors (docs/games/jumper.md — "Required vectors"):
 * bounce/drag trajectories, seeded reachable platforms, one credit per
 * platform, camera/world separation, #1 completion and fall-boundary
 * end-at-most-once.
 */

import { describe, expect, it } from "vitest";
import { seededRandom } from "@/shell/rng";
import {
  createJumperState,
  nextPlatform,
  rankOf,
  steer,
  step,
  BOUNCE_IMPULSE,
  DESIGN,
  GRAVITY,
  MAX_CLIMB,
  PLATFORM_W,
  PLAYER_H,
  PLAYER_W,
  SPAWN_DX_MAX,
  SPAWN_DY_MAX,
  SPAWN_DY_MIN,
  STEER_MAX,
  type JumperState,
  type Platform,
} from "@/games/jumper/logic";

describe("jumper rules (docs/games/jumper.md vectors)", () => {
  it("V1: bounce and steering follow the adopted-unit trajectory", () => {
    const rng = seededRandom("jumper-v1");
    const state = createJumperState(rng);
    expect(state.vy).toBe(BOUNCE_IMPULSE);
    const y0 = state.y;
    step(state, rng);
    expect(state.vy).toBeCloseTo(BOUNCE_IMPULSE + GRAVITY, 10);
    expect(state.y).toBeCloseTo(y0 + BOUNCE_IMPULSE + GRAVITY, 10);

    // Steering converges toward the target with the ±8 clamp.
    const xBefore = state.x;
    steer(state, xBefore + 200);
    step(state, rng);
    expect(state.x).toBeCloseTo(xBefore + STEER_MAX, 10); // clamped
    const xNear = state.x;
    steer(state, xNear + 10);
    step(state, rng);
    expect(state.x).toBeCloseTo(xNear + 10 * 0.15, 10); // proportional
  });

  it("V2: seeded platforms are in-bounds and reachable", () => {
    const rng = seededRandom("jumper-v2");
    let previous: Platform = { x: 148, y: 500, credited: false };
    for (let i = 0; i < 100; i++) {
      const platform = nextPlatform(previous, rng);
      const dy = previous.y - platform.y;
      expect(dy).toBeGreaterThanOrEqual(SPAWN_DY_MIN);
      expect(dy).toBeLessThanOrEqual(SPAWN_DY_MAX);
      // |dx| bound holds up to the clamp at the walls.
      expect(Math.abs(platform.x - previous.x)).toBeLessThanOrEqual(
        SPAWN_DX_MAX,
      );
      expect(platform.x).toBeGreaterThanOrEqual(10);
      expect(platform.x).toBeLessThanOrEqual(DESIGN.w - PLATFORM_W - 10);
      previous = platform;
    }
    // Determinism.
    const again = nextPlatform(
      { x: 148, y: 500, credited: false },
      seededRandom("jumper-v2"),
    );
    const first = nextPlatform(
      { x: 148, y: 500, credited: false },
      seededRandom("jumper-v2"),
    );
    expect(again).toEqual(first);
  });

  it("V3: a platform credits rank exactly once", () => {
    const rng = seededRandom("jumper-v3");
    const platform: Platform = { x: 150, y: 400, credited: false };
    const state: JumperState = {
      x: 155,
      // Feet at 398, vy 3 → feet cross the y=400 top THIS step.
      y: 400 - PLAYER_H - 2,
      vy: 3,
      steerX: 155,
      cameraY: 0,
      platforms: [platform],
      climbed: 0,
      status: "running",
    };
    step(state, rng);
    expect(state.climbed).toBe(1);
    expect(rankOf(state)).toBe(99);
    // Land on the SAME platform again: bounce, but no second credit.
    state.y = 400 - PLAYER_H - 2;
    state.vy = 3;
    step(state, rng);
    expect(state.vy).toBe(BOUNCE_IMPULSE); // bounced
    expect(state.climbed).toBe(1); // not re-credited
  });

  it("V4: side/bottom contact never lands; camera never changes physics", () => {
    const rng = seededRandom("jumper-v4");
    // Rising THROUGH a platform (vy < 0): no landing.
    const rising: JumperState = {
      x: 155,
      y: 400 + 2,
      vy: -9,
      steerX: 155,
      cameraY: 0,
      platforms: [{ x: 150, y: 400, credited: false }],
      climbed: 0,
      status: "running",
    };
    step(rising, rng);
    expect(rising.climbed).toBe(0);
    expect(rising.vy).toBeCloseTo(-9 + GRAVITY, 10); // untouched by platform

    // Identical world state under two LIVE camera offsets (both keep the
    // player inside the loss boundary and the platform un-culled) →
    // identical FULL outcome: status, credit, kinematics, and platforms.
    const build = (cameraY: number): JumperState => ({
      x: 155,
      y: 400 - PLAYER_H - 2, // lands this step
      vy: 3,
      steerX: 155,
      cameraY,
      platforms: [{ x: 150, y: 400, credited: false }],
      climbed: 0,
      status: "running",
    });
    const a = build(0);
    const b = build(-100);
    step(a, seededRandom("jumper-v4b"));
    step(b, seededRandom("jumper-v4b"));
    expect(a.status).toBe(b.status);
    expect(a.status).toBe("running");
    expect(a.climbed).toBe(b.climbed);
    expect(a.climbed).toBe(1); // the landing actually happened
    expect(a.x).toBe(b.x);
    expect(a.y).toBe(b.y);
    expect(a.vy).toBe(b.vy);
    expect(a.platforms).toEqual(b.platforms); // same spawns, same credits
  });

  it("V5: #1 completes with score 99; falling ends exactly once", () => {
    const rng = seededRandom("jumper-v5");
    // One landing away from #1.
    const platform: Platform = { x: 150, y: 400, credited: false };
    const state: JumperState = {
      x: 155,
      y: 400 - PLAYER_H - 2, // feet cross the platform top this step
      vy: 3,
      steerX: 155,
      cameraY: 400 - 500,
      platforms: [platform],
      climbed: MAX_CLIMB - 1,
      status: "running",
    };
    step(state, rng);
    expect(state.status).toBe("completed");
    expect(state.climbed).toBe(MAX_CLIMB);
    expect(rankOf(state)).toBe(1);
    const frozen = JSON.parse(JSON.stringify(state)) as JumperState;
    step(state, rng);
    expect(state).toEqual(frozen);

    // Fall boundary: below the camera by a full screen → lost, once.
    const falling: JumperState = {
      x: 100,
      y: 1000,
      vy: 10,
      steerX: 100,
      cameraY: 200,
      platforms: [{ x: 10, y: -400, credited: false }],
      climbed: 5,
      status: "running",
    };
    step(falling, seededRandom("jumper-v5b"));
    expect(falling.status).toBe("lost");
    const lostFrozen = JSON.parse(JSON.stringify(falling)) as JumperState;
    step(falling, seededRandom("jumper-v5b"));
    expect(falling).toEqual(lostFrozen);
  });

  it("V6: identical seed + steering script replays identically", () => {
    const run = (seed: string) => {
      const rng = seededRandom(seed);
      const state = createJumperState(rng);
      for (let i = 0; i < 240; i++) {
        if (i % 30 === 0) steer(state, (i * 37) % (DESIGN.w - PLAYER_W));
        step(state, rng);
      }
      return state;
    };
    expect(run("jumper-v6")).toEqual(run("jumper-v6"));
  });
});
