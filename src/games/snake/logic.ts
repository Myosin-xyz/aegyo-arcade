/**
 * Snake Freebies — pure deterministic core (docs/games/snake-freebies.md).
 *
 * Ported from Daidai's delivered build (2026-07-26). The snake's body is a
 * CHAIN OF FREEBIES: eating a gift box appends the next freebie sprite
 * tail-side, cycling f00→f18. Three levels share one 13×13 arena —
 * difficulty comes from chain length + tick speed, not layout.
 *
 * Faithful to the delivery: level targets/speeds, 3 lives per level reset
 * at each level start, `10 × levelNumber` per freebie (perfect run 1950),
 * and the chain-preserving death (respawn at centre at FULL length, the
 * chain re-emerging behind the head via `growPending`).
 *
 * Adaptations (deliberate):
 * - Food placement draws from the run's SEEDED rng, not bare Math.random,
 *   so counted runs replay identically (portal requirement).
 * - The delivery's `setInterval` tick becomes a fixed-step accumulator —
 *   the frozen runtime contract owns the loop.
 * - Death / level-break / game-over SCREENS are the host's, not the game's.
 */

export type Rng = () => number;

export interface Cell {
  x: number;
  y: number;
}

export type SnakeStatus = "playing" | "dying" | "levelBreak" | "won" | "lost";

export interface LevelSpec {
  grid: number;
  /** ms per simulation tick */
  speed: number;
  /** freebies needed to clear the level */
  gifts: number;
}

/** Delivery values — one fixed arena, ramping target + speed. */
export const LEVELS: readonly LevelSpec[] = [
  { grid: 13, speed: 180, gifts: 10 },
  { grid: 13, speed: 150, gifts: 25 },
  { grid: 13, speed: 125, gifts: 45 },
];

export const LIVES_PER_LEVEL = 3;
export const START_LENGTH = 3; // head + 2 starter freebies
export const SCORE_PER_GIFT = 10; // × level number
export const FREEBIE_SPRITE_COUNT = 19;
/** Pause after a death before the chain re-emerges (delivery: 900ms). */
export const DEATH_PAUSE_MS = 900;

/** 10·10 + 25·20 + 45·30 — the perfect run. */
export const MAX_SCORE = LEVELS.reduce(
  (sum, level, index) => sum + level.gifts * SCORE_PER_GIFT * (index + 1),
  0,
);

export interface SnakeState {
  status: SnakeStatus;
  /** 0-based */
  level: number;
  lives: number;
  score: number;
  /** freebies collected THIS level */
  gifts: number;
  snake: Cell[];
  /** sprite index per body segment (segment i uses bodySprites[i-1]) */
  bodySprites: number[];
  /** sprite the next gift will contribute */
  nextSprite: number;
  /** segments still to re-emerge after a respawn */
  growPending: number;
  dir: Cell;
  nextDir: Cell;
  food: Cell;
  /** seconds elapsed across the WHOLE run (all levels) */
  elapsed: number;
  /** ms remaining on the death pause, 0 when not dying */
  deathPauseMs: number;
  /** accumulates real time between fixed ticks */
  tickAccumulatorMs: number;
}

export function gridOf(state: SnakeState): number {
  return LEVELS[state.level].grid;
}

export function levelTarget(state: SnakeState): number {
  return LEVELS[state.level].gifts;
}

export function tickMs(state: SnakeState): number {
  return LEVELS[state.level].speed;
}

function placeFood(state: SnakeState, rng: Rng): void {
  const grid = gridOf(state);
  let candidate: Cell;
  do {
    candidate = { x: Math.floor(rng() * grid), y: Math.floor(rng() * grid) };
  } while (state.snake.some((s) => s.x === candidate.x && s.y === candidate.y));
  state.food = candidate;
}

/**
 * Respawn at centre KEEPING the freebie chain: the body re-emerges behind
 * the head one tick at a time (delivery's `growPending`). Only a new level
 * resets the chain itself.
 */
function respawn(state: SnakeState): void {
  const centre = Math.floor(gridOf(state) / 2);
  state.snake = [{ x: centre, y: centre }];
  state.growPending = state.bodySprites.length;
  state.dir = { x: 1, y: 0 };
  state.nextDir = state.dir;
  // A respawn starts a FRESH movement interval, as the delivery does by
  // clearing and re-creating its tick interval. Carrying the partial tick
  // that was in flight when the snake died would make the first step after
  // the death beat land early. Sole owner of this reset — `startLevel`
  // reaches it through here.
  state.tickAccumulatorMs = 0;
}

function startLevel(state: SnakeState, level: number, rng: Rng): void {
  state.level = level;
  state.gifts = 0;
  state.lives = LIVES_PER_LEVEL;
  // Fresh starter chain — the only place the chain resets.
  state.bodySprites = [];
  for (let i = 0; i < START_LENGTH - 1; i++) {
    state.bodySprites.push(i % FREEBIE_SPRITE_COUNT);
  }
  state.nextSprite = (START_LENGTH - 1) % FREEBIE_SPRITE_COUNT;
  respawn(state); // also zeroes the tick accumulator
  placeFood(state, rng);
  state.status = "playing";
}

export function createSnakeState(rng: Rng): SnakeState {
  const state: SnakeState = {
    status: "playing",
    level: 0,
    lives: LIVES_PER_LEVEL,
    score: 0,
    gifts: 0,
    snake: [],
    bodySprites: [],
    nextSprite: 0,
    growPending: 0,
    dir: { x: 1, y: 0 },
    nextDir: { x: 1, y: 0 },
    food: { x: 0, y: 0 },
    elapsed: 0,
    deathPauseMs: 0,
    tickAccumulatorMs: 0,
  };
  startLevel(state, 0, rng);
  return state;
}

/**
 * Queue a direction for the next tick. A straight reversal is rejected
 * (it would fold the snake into its own neck); the queue is per-tick, so a
 * fast double-tap cannot turn twice within one step.
 */
export function queueDirection(state: SnakeState, dir: Cell): boolean {
  if (state.status !== "playing") return false;
  if (dir.x === -state.dir.x && dir.y === -state.dir.y) return false;
  state.nextDir = dir;
  return true;
}

/** Advance past a level break (host-driven, like the delivery's GO! button). */
export function continueFromLevelBreak(state: SnakeState, rng: Rng): void {
  if (state.status !== "levelBreak") return;
  startLevel(state, state.level + 1, rng);
}

function die(state: SnakeState): void {
  state.lives--;
  if (state.lives <= 0) {
    state.status = "lost";
    return;
  }
  state.status = "dying";
  state.deathPauseMs = DEATH_PAUSE_MS;
}

/** ONE simulation tick (the delivery's `tick`). */
export function tick(state: SnakeState, rng: Rng): void {
  if (state.status !== "playing") return;
  state.dir = state.nextDir;
  const head: Cell = {
    x: state.snake[0].x + state.dir.x,
    y: state.snake[0].y + state.dir.y,
  };
  const grid = gridOf(state);
  if (head.x < 0 || head.y < 0 || head.x >= grid || head.y >= grid) {
    die(state);
    return;
  }
  if (state.snake.some((s) => s.x === head.x && s.y === head.y)) {
    die(state);
    return;
  }
  state.snake.unshift(head);

  if (head.x === state.food.x && head.y === state.food.y) {
    state.gifts++;
    state.score += SCORE_PER_GIFT * (state.level + 1);
    // The freebie inside the gift joins the chain, tail-side.
    state.bodySprites.push(state.nextSprite);
    state.nextSprite = (state.nextSprite + 1) % FREEBIE_SPRITE_COUNT;
    if (state.gifts >= levelTarget(state)) {
      state.status = state.level >= LEVELS.length - 1 ? "won" : "levelBreak";
      return;
    }
    placeFood(state, rng);
  } else if (state.growPending > 0) {
    state.growPending--; // chain still re-emerging after a respawn
  } else {
    state.snake.pop();
  }
}

/**
 * Advance by real time: drives ticks on the level's cadence and runs the
 * post-death pause. The run timer counts up across the WHOLE run.
 *
 * RETURNS the resulting status so callers can branch on it — reading
 * `state.status` after this call keeps TypeScript's pre-call narrowing and
 * silently dead-ends the comparisons.
 */
export function step(state: SnakeState, dtMs: number, rng: Rng): SnakeStatus {
  if (state.status === "won" || state.status === "lost") return state.status;

  if (state.status === "dying") {
    state.deathPauseMs -= dtMs;
    if (state.deathPauseMs <= 0) {
      state.deathPauseMs = 0;
      respawn(state);
      placeFood(state, rng);
      state.status = "playing";
    }
    return state.status;
  }
  if (state.status !== "playing") return state.status;

  // The timer advances only while the snake is actually moving: the
  // delivery clears BOTH its tick and timer intervals during the death
  // beat, so a nonterminal collision costs a life, not clock. (Level
  // breaks are likewise frozen — they never reach this line.)
  state.elapsed += dtMs / 1000;
  state.tickAccumulatorMs += dtMs;
  const period = tickMs(state);
  while (state.tickAccumulatorMs >= period && state.status === "playing") {
    state.tickAccumulatorMs -= period;
    tick(state, rng);
  }
  return state.status;
}
