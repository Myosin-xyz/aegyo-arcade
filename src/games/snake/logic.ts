/**
 * Aegyo Snake — pure, deterministic rules (docs/games/snake.md).
 *
 * All randomness flows through the injected RunContext PRNG, so a seeded
 * run replays identically. The board is stored on the state so tests can
 * exercise small grids; production uses GRID (20).
 */

export const GRID = 20;
export const STEP_MS = 140;

export type Dir = "up" | "down" | "left" | "right";

export interface Cell {
  x: number;
  y: number;
}

export interface SnakeState {
  grid: number;
  /** Head first. */
  body: Cell[];
  dir: Dir;
  queuedDir: Dir | null;
  food: Cell | null;
  collected: number;
  status: "running" | "lost" | "completed";
}

const DELTA: Record<Dir, Cell> = {
  up: { x: 0, y: -1 },
  down: { x: 0, y: 1 },
  left: { x: -1, y: 0 },
  right: { x: 1, y: 0 },
};

const OPPOSITE: Record<Dir, Dir> = {
  up: "down",
  down: "up",
  left: "right",
  right: "left",
};

export function createSnakeState(
  rng: () => number,
  grid: number = GRID,
): SnakeState {
  const mid = Math.floor(grid / 2) - 1;
  const body: Cell[] = [
    { x: mid, y: mid },
    { x: mid - 1, y: mid },
    { x: mid - 2, y: mid },
  ];
  const state: SnakeState = {
    grid,
    body,
    dir: "right",
    queuedDir: null,
    food: null,
    collected: 0,
    status: "running",
  };
  state.food = spawnFood(state, rng);
  return state;
}

/** Photocards never spawn on the snake (docs/games/snake.md rule edge). */
export function spawnFood(state: SnakeState, rng: () => number): Cell | null {
  const occupied = new Set(state.body.map((c) => `${c.x},${c.y}`));
  const free: Cell[] = [];
  for (let y = 0; y < state.grid; y++) {
    for (let x = 0; x < state.grid; x++) {
      if (!occupied.has(`${x},${y}`)) free.push({ x, y });
    }
  }
  if (free.length === 0) return null;
  return free[Math.floor(rng() * free.length)];
}

/**
 * Queue a direction. A single slot (latest wins); reversal into the
 * previous cell is rejected at APPLY time so a queued opposite can never
 * slip through.
 */
export function queueDirection(state: SnakeState, dir: Dir): void {
  if (state.status !== "running") return;
  if (dir === state.dir) return;
  state.queuedDir = dir;
}

/** One fixed movement step. No-op after the run ended (end-at-most-once). */
export function step(state: SnakeState, rng: () => number): void {
  if (state.status !== "running") return;

  // At most one direction change per step; reversals are ignored.
  if (state.queuedDir && state.queuedDir !== OPPOSITE[state.dir]) {
    state.dir = state.queuedDir;
  }
  state.queuedDir = null;

  const head = state.body[0];
  const delta = DELTA[state.dir];
  const next: Cell = { x: head.x + delta.x, y: head.y + delta.y };

  const hitsWall =
    next.x < 0 || next.y < 0 || next.x >= state.grid || next.y >= state.grid;
  const hitsSelf = state.body.some((c) => c.x === next.x && c.y === next.y);
  if (hitsWall || hitsSelf) {
    state.status = "lost";
    return;
  }

  state.body.unshift(next);
  if (state.food && next.x === state.food.x && next.y === state.food.y) {
    state.collected += 1;
    state.food = spawnFood(state, rng);
    if (state.food === null) {
      // Full board: maximum possible score, completed (docs rule edge).
      state.status = "completed";
    }
  } else {
    state.body.pop();
  }
}
