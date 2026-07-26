/**
 * Snake Freebies rule vectors (docs/games/snake-freebies.md).
 *
 * Pins the delivery mechanics the port must preserve: level targets +
 * speeds, per-level scoring, the 1950 perfect run, 3 lives reset per
 * level, the CHAIN-PRESERVING death (respawn full length, chain
 * re-emerging via growPending), sprite cycling, and seeded replay.
 */

import { describe, expect, it } from "vitest";
import { seededRandom } from "@/shell/rng";
import {
  DEATH_PAUSE_MS,
  FREEBIE_SPRITE_COUNT,
  LEVELS,
  LIVES_PER_LEVEL,
  MAX_SCORE,
  SCORE_PER_GIFT,
  START_LENGTH,
  continueFromLevelBreak,
  createSnakeState,
  gridOf,
  queueDirection,
  step,
  tick,
  type SnakeState,
} from "@/games/snake/logic";

const RIGHT = { x: 1, y: 0 };
const LEFT = { x: -1, y: 0 };
const UP = { x: 0, y: -1 };
const DOWN = { x: 0, y: 1 };

/** Put the food directly in front of the head so the next tick eats it. */
function feedAhead(state: SnakeState): void {
  state.food = {
    x: state.snake[0].x + state.dir.x,
    y: state.snake[0].y + state.dir.y,
  };
}

/**
 * Eat `n` freebies. These vectors are about SCORING / CHAIN / LEVEL rules,
 * not navigation, so the snake is parked at centre facing right before each
 * bite — otherwise it simply runs into the wall after a few cells and the
 * rule under test never gets exercised.
 */
function eat(state: SnakeState, n: number, rng: () => number): void {
  for (let i = 0; i < n; i++) {
    const centre = Math.floor(gridOf(state) / 2);
    state.snake = [{ x: centre, y: centre }];
    state.growPending = 0;
    state.dir = { x: 1, y: 0 };
    state.nextDir = state.dir;
    feedAhead(state);
    tick(state, rng);
  }
}

describe("snake — delivery constants (V1)", () => {
  it("3 levels on one 13x13 arena: targets 10/25/45, speeds 180/150/125", () => {
    expect(LEVELS).toHaveLength(3);
    expect(LEVELS.map((l) => l.grid)).toEqual([13, 13, 13]);
    expect(LEVELS.map((l) => l.gifts)).toEqual([10, 25, 45]);
    expect(LEVELS.map((l) => l.speed)).toEqual([180, 150, 125]);
    expect(LIVES_PER_LEVEL).toBe(3);
    expect(START_LENGTH).toBe(3);
    expect(FREEBIE_SPRITE_COUNT).toBe(19);
  });

  it("a perfect run is exactly 1950 (10·10 + 25·20 + 45·30)", () => {
    expect(MAX_SCORE).toBe(1950);
    expect(MAX_SCORE).toBe(10 * 10 + 25 * 20 + 45 * 30);
  });
});

describe("snake — scoring scales with level number (V2)", () => {
  it("each freebie pays 10 × levelNumber", () => {
    const rng = seededRandom("score");
    const state = createSnakeState(rng);
    eat(state, 1, rng);
    expect(state.score).toBe(SCORE_PER_GIFT * 1);
    // Jump to level 2 by clearing level 1, then check the new rate.
    eat(state, LEVELS[0].gifts - 1, rng);
    expect(state.status).toBe("levelBreak");
    continueFromLevelBreak(state, rng);
    expect(state.level).toBe(1);
    const atLevel2 = state.score;
    eat(state, 1, rng);
    expect(state.score - atLevel2).toBe(SCORE_PER_GIFT * 2);
  });

  it("clearing the last level WINS; clearing an earlier one breaks", () => {
    const rng = seededRandom("levels");
    const state = createSnakeState(rng);
    eat(state, LEVELS[0].gifts, rng);
    expect(state.status).toBe("levelBreak");
    continueFromLevelBreak(state, rng);
    eat(state, LEVELS[1].gifts, rng);
    expect(state.status).toBe("levelBreak");
    continueFromLevelBreak(state, rng);
    expect(state.level).toBe(2);
    eat(state, LEVELS[2].gifts, rng);
    expect(state.status).toBe("won");
    expect(state.score).toBe(MAX_SCORE); // perfect run through the real path
  });
});

describe("snake — lives + chain-preserving death (V3)", () => {
  it("a wall hit costs a life and pauses; the chain re-emerges at FULL length", () => {
    const rng = seededRandom("death");
    const state = createSnakeState(rng);
    // Grow the chain a bit first.
    eat(state, 4, rng);
    const chain = state.bodySprites.length;
    expect(chain).toBe(START_LENGTH - 1 + 4);

    // Drive into the right wall.
    const grid = gridOf(state);
    state.food = { x: -1, y: -1 }; // unreachable, so no accidental eating
    for (let i = 0; i < grid + 2 && state.status === "playing"; i++) {
      tick(state, rng);
    }
    expect(state.status).toBe("dying");
    expect(state.lives).toBe(LIVES_PER_LEVEL - 1);
    // The chain is NOT reset by a death.
    expect(state.bodySprites).toHaveLength(chain);

    // After the pause the snake is back at centre, chain still pending.
    step(state, DEATH_PAUSE_MS, rng);
    expect(state.status).toBe("playing");
    expect(state.snake).toHaveLength(1);
    expect(state.growPending).toBe(chain);

    // It re-emerges one segment per tick, not instantly.
    state.food = { x: -1, y: -1 };
    tick(state, rng);
    expect(state.snake).toHaveLength(2);
    expect(state.growPending).toBe(chain - 1);
  });

  it("the third death in a level ends the run as lost", () => {
    const rng = seededRandom("gameover");
    const state = createSnakeState(rng);
    state.food = { x: -1, y: -1 };
    const crash = () => {
      for (let i = 0; i < gridOf(state) + 2; i++) {
        if (state.status !== "playing") return;
        tick(state, rng);
      }
    };
    crash();
    expect(state.lives).toBe(2);
    step(state, DEATH_PAUSE_MS, rng);
    crash();
    expect(state.lives).toBe(1);
    step(state, DEATH_PAUSE_MS, rng);
    crash();
    expect(state.lives).toBe(0);
    expect(state.status).toBe("lost");
  });

  it("a new level resets lives AND the chain (the only chain reset)", () => {
    const rng = seededRandom("levelreset");
    const state = createSnakeState(rng);
    eat(state, LEVELS[0].gifts, rng); // clears level 1, chain is long
    expect(state.bodySprites.length).toBeGreaterThan(START_LENGTH);
    state.lives = 1;
    continueFromLevelBreak(state, rng);
    expect(state.lives).toBe(LIVES_PER_LEVEL);
    expect(state.bodySprites).toHaveLength(START_LENGTH - 1);
    expect(state.gifts).toBe(0);
  });
});

describe("snake — steering (V4)", () => {
  it("rejects a straight reversal but accepts a perpendicular turn", () => {
    const state = createSnakeState(seededRandom("turn"));
    expect(state.dir).toEqual(RIGHT);
    expect(queueDirection(state, LEFT)).toBe(false); // would fold the neck
    expect(state.nextDir).toEqual(RIGHT);
    expect(queueDirection(state, DOWN)).toBe(true);
    expect(state.nextDir).toEqual(DOWN);
    // Reversal is judged against the CURRENT direction, not the queued one:
    // travelling RIGHT, a queued UP is a legal perpendicular turn even if
    // DOWN was queued first — the snake never folds, the last input wins.
    expect(queueDirection(state, UP)).toBe(true);
    expect(state.nextDir).toEqual(UP);
  });

  it("self-collision costs a life", () => {
    const rng = seededRandom("selfhit");
    const state = createSnakeState(rng);
    // Hand-built body so the collision is exact, not seed-dependent: the
    // head at (5,5) heading right into its own segment at (6,5).
    state.snake = [
      { x: 5, y: 5 },
      { x: 6, y: 5 },
      { x: 6, y: 6 },
      { x: 5, y: 6 },
    ];
    state.bodySprites = [0, 1, 2];
    state.growPending = 0;
    state.dir = { x: 1, y: 0 };
    state.nextDir = state.dir;
    state.food = { x: -1, y: -1 };
    tick(state, rng);
    expect(state.status).toBe("dying");
    expect(state.lives).toBe(LIVES_PER_LEVEL - 1);
  });
});

describe("snake — freebie chain sprites (V5)", () => {
  it("appends sprites in f00→f18 order and cycles past the end", () => {
    const rng = seededRandom("sprites");
    const state = createSnakeState(rng);
    // Starter chain is sprites 0..START_LENGTH-2, next is START_LENGTH-1.
    expect(state.bodySprites).toEqual([0, 1]);
    expect(state.nextSprite).toBe(2);
    eat(state, 3, rng);
    expect(state.bodySprites).toEqual([0, 1, 2, 3, 4]);
    // Cycle: push it past the sprite count.
    state.nextSprite = FREEBIE_SPRITE_COUNT - 1;
    eat(state, 2, rng);
    expect(state.bodySprites.slice(-2)).toEqual([FREEBIE_SPRITE_COUNT - 1, 0]);
  });
});

describe("snake — determinism (V6)", () => {
  it("same seed → identical food sequence and score", () => {
    const play = (seed: string) => {
      const rng = seededRandom(seed);
      const state = createSnakeState(rng);
      const foods: string[] = [];
      for (let i = 0; i < 8; i++) {
        feedAhead(state);
        tick(state, rng);
        foods.push(`${state.food.x},${state.food.y}`);
      }
      return { foods, score: state.score };
    };
    expect(play("replay-1")).toEqual(play("replay-1"));
    expect(play("replay-2").foods).not.toEqual(play("replay-1").foods);
  });

  it("the death beat freezes the clock AND restarts the movement interval", () => {
    const rng = seededRandom("death-timing");
    const state = createSnakeState(rng);
    const period = LEVELS[0].speed;
    state.food = { x: -1, y: -1 }; // unreachable: no accidental eating

    // The head starts at centre (6) on a 13-wide grid facing right, so the
    // 7th tick walks off the edge. Feed 7 periods PLUS a partial one so
    // there is tick time in flight at the moment of death.
    expect(step(state, period * 7 + 100, rng)).toBe("dying");
    expect(state.lives).toBe(LIVES_PER_LEVEL - 1);
    const elapsedAtDeath = state.elapsed;

    // The 900 ms beat advances no clock (the delivery clears its timer).
    expect(step(state, DEATH_PAUSE_MS, rng)).toBe("playing");
    expect(state.elapsed).toBe(elapsedAtDeath);

    // ...and the movement interval restarts from zero rather than
    // inheriting the partial tick, so the first move after the respawn
    // takes a FULL period.
    expect(state.tickAccumulatorMs).toBe(0);
    const centre = state.snake[0].x;
    step(state, period - 1, rng);
    expect(state.snake[0].x, "moved before a full tick elapsed").toBe(centre);
    step(state, 1, rng);
    expect(state.snake[0].x).toBe(centre + 1);
  });

  it("step() drives ticks on the level cadence and returns the status", () => {
    const rng = seededRandom("cadence");
    const state = createSnakeState(rng);
    state.food = { x: -1, y: -1 };
    const startX = state.snake[0].x;
    // Just under one tick period: no movement yet.
    const status = step(state, LEVELS[0].speed - 1, rng);
    expect(status).toBe("playing");
    expect(state.snake[0].x).toBe(startX);
    // Crossing the period advances exactly one cell.
    step(state, 1, rng);
    expect(state.snake[0].x).toBe(startX + 1);
  });
});
