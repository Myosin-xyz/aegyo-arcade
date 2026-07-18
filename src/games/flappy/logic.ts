/**
 * Bias Flap — pure, deterministic rules (docs/games/flappy.md).
 *
 * Adopted M2 units, per fixed 60Hz simulation step (the recovered mock
 * constants were frame-based; these reproduce that feel exactly):
 *   gravity 0.45 px/step², flap impulse −7.5 px/step, pipe speed 2.6
 *   px/step, pipe spacing 180 px, gap 180 px (half 90), gap-center safe
 *   range [120, 520] in the 360×640 design box.
 */

export const DESIGN = { w: 360, h: 640 } as const;
export const GRAVITY = 0.45;
export const FLAP_IMPULSE = -7.5;
export const PIPE_SPEED = 2.6;
export const PIPE_WIDTH = 46;
export const PIPE_SPACING = 180;
export const GAP_HALF = 90;
export const PLAYER_X = 70;
export const PLAYER_RADIUS = 16;
export const GAP_CENTER_MIN = GAP_HALF + 30; // 120
export const GAP_CENTER_MAX = DESIGN.h - GAP_HALF - 30; // 520
export const FLOOR_Y = DESIGN.h - 20;

export interface Pipe {
  x: number;
  gapCenter: number;
  scored: boolean;
}

export interface FlappyState {
  y: number;
  vy: number;
  pipes: Pipe[];
  score: number;
  status: "running" | "lost";
}

/** Seeded gap center, always inside the documented safe margins. */
export function nextGapCenter(rng: () => number): number {
  return GAP_CENTER_MIN + rng() * (GAP_CENTER_MAX - GAP_CENTER_MIN);
}

export function createFlappyState(rng: () => number): FlappyState {
  const pipes: Pipe[] = [];
  for (let i = 0; i < 3; i++) {
    pipes.push({
      x: 400 + i * PIPE_SPACING,
      gapCenter: nextGapCenter(rng),
      scored: false,
    });
  }
  return { y: DESIGN.h / 2, vy: 0, pipes, score: 0, status: "running" };
}

export function flap(state: FlappyState): void {
  if (state.status !== "running") return;
  state.vy = FLAP_IMPULSE;
}

function collides(state: FlappyState, pipe: Pipe): boolean {
  if (
    PLAYER_X + PLAYER_RADIUS <= pipe.x ||
    PLAYER_X - PLAYER_RADIUS >= pipe.x + PIPE_WIDTH
  ) {
    return false;
  }
  return (
    state.y - PLAYER_RADIUS < pipe.gapCenter - GAP_HALF ||
    state.y + PLAYER_RADIUS > pipe.gapCenter + GAP_HALF
  );
}

/** One fixed step. No-op after the run ended (end-at-most-once). */
export function step(state: FlappyState, rng: () => number): void {
  if (state.status !== "running") return;

  state.vy += GRAVITY;
  state.y += state.vy;
  for (const pipe of state.pipes) pipe.x -= PIPE_SPEED;

  // Vertical bounds end the run.
  if (state.y + PLAYER_RADIUS > FLOOR_Y || state.y - PLAYER_RADIUS < 0) {
    state.status = "lost";
    return;
  }

  // Collision resolves BEFORE scoring in the same step (docs rule edge).
  for (const pipe of state.pipes) {
    if (collides(state, pipe)) {
      state.status = "lost";
      return;
    }
  }
  for (const pipe of state.pipes) {
    if (!pipe.scored && pipe.x + PIPE_WIDTH < PLAYER_X - PLAYER_RADIUS) {
      pipe.scored = true;
      state.score += 1;
    }
  }

  // Recycle: keep exactly 3 pipes, seeded gaps inside safe margins.
  if (state.pipes[0].x < -PIPE_WIDTH) {
    state.pipes.shift();
    const last = state.pipes[state.pipes.length - 1];
    state.pipes.push({
      x: last.x + PIPE_SPACING,
      gapCenter: nextGapCenter(rng),
      scored: false,
    });
  }
}
