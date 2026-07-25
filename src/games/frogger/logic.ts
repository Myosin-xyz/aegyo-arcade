/**
 * Cross to the Concert — pure deterministic core (docs/games/frogger.md).
 *
 * Ported verbatim from Daidai's delivered build (M3 acceptance rubric):
 * 360×467 playfield, 7 rows (goal, 5 hazard lanes, start), two obstacle
 * instances per lane at 180·i + seeded 0–40px jitter, per-frame speeds ×
 * a LINEAR ramp `1 + (level−1)/9` (1.0× at L1 → 2.0× at L10; team tuning
 * 2026-07-24 — the delivery's eased `^1.6` curve was flat early and
 * players didn't feel the difficulty climb), 1-D collision on the hero's
 * row with `|x−180| < 9 + 0.3·drawW`, 90-tick invulnerability, 105-tick
 * frozen checkpoint beats, monotonic new-best-row scoring (6 per level,
 * hard max 60 across 10 levels).
 *
 * The delivery ran these constants per FRAME with dt=1 (frame-rate
 * dependent); this port fixes them at 60Hz ticks, which reproduces the
 * intended 60fps behavior exactly. The delivery's only RNG is the lane
 * jitter — everything else is deterministic by construction.
 */

export const STEP_MS = 1000 / 60;

export const GAME_W = 360;
export const GAME_H = 467;
/** Delivered control-strip art (480×113) scaled to design width. */
export const BAR_H = Math.round((113 * GAME_W) / 480); // 85
export const DESIGN_W = GAME_W;
export const DESIGN_H = GAME_H + BAR_H; // 552

export const ROW_FRACS = [
  0.0, 0.3474, 0.4521, 0.5546, 0.6586, 0.7641, 0.8943, 1.0,
] as const;
export const ROWS = 7;
export const START_ROW = 6;
export const GOAL_ROW = 0;
export const HERO_X = GAME_W / 2; // fixed forever — single-axis game
export const HERO_HALF = 9;
export const HERO_TARGET_H = 30;

export const TOTAL_LEVELS = 10;
export const LIVES = 3;
export const POINTS_PER_LEVEL = START_ROW - GOAL_ROW; // 6
export const MAX_SCORE = TOTAL_LEVELS * POINTS_PER_LEVEL; // 60

export const INVULN_TICKS = 90;
export const CHECKPOINT_TICKS = 105;
export const TOAST_TICKS = 78; // ≈ the delivery's 1300ms toast
export const ANIM_DECAY = 0.08; // cosmetic move-bounce decay per tick

export const INSTANCES_PER_LANE = 2;
export const JITTER_MAX = 40;

export type LaneKey = "golf" | "merch" | "scalper" | "kfood" | "guard";

export interface LaneSpec {
  key: LaneKey;
  /** px per 60Hz tick at level 1 (delivery baseSpeed, dt=1). */
  baseSpeed: number;
  dir: 1 | -1;
  /** Draw height; width follows the native sprite aspect. */
  targetH: number;
  nativeW: number;
  nativeH: number;
}

/** Row 1..5 in order. Directions are fixed real-world (rubric). */
export const LANES: readonly LaneSpec[] = [
  {
    key: "golf",
    baseSpeed: 0.62,
    dir: 1,
    targetH: 40,
    nativeW: 147,
    nativeH: 104,
  },
  {
    key: "merch",
    baseSpeed: 0.38,
    dir: -1,
    targetH: 34,
    nativeW: 178,
    nativeH: 124,
  },
  {
    key: "scalper",
    baseSpeed: 0.55,
    dir: 1,
    targetH: 32,
    nativeW: 143,
    nativeH: 109,
  },
  {
    key: "kfood",
    baseSpeed: 0.38,
    dir: -1,
    targetH: 34,
    nativeW: 206,
    nativeH: 120,
  },
  {
    key: "guard",
    baseSpeed: 0.58,
    dir: 1,
    targetH: 34,
    nativeW: 83,
    nativeH: 128,
  },
] as const;

export function laneDrawWidth(lane: LaneSpec): number {
  return (lane.targetH * lane.nativeW) / lane.nativeH;
}

/**
 * Linear difficulty ramp: 1.0× at L1 → 2.0× at L10, +1/9 per level so the
 * climb is felt on every advance (team tuning 2026-07-24; replaced the
 * delivery's flat-early `^1.6` eased curve — see docs/games/frogger.md).
 */
export function speedMult(level: number): number {
  return 1 + (level - 1) / 9;
}

export function rowCenterY(row: number): number {
  return ((ROW_FRACS[row] + ROW_FRACS[row + 1]) / 2) * GAME_H;
}

export type Rng = () => number;

export interface LaneState {
  spec: LaneSpec;
  xs: number[]; // one per instance
}

export type FroggerStatus = "playing" | "checkpoint" | "won" | "lost";

export interface Toast {
  key: string;
  params: Record<string, string>;
  ticks: number;
}

export interface FroggerState {
  status: FroggerStatus;
  level: number; // 1-based
  lives: number;
  score: number;
  row: number;
  /** Lowest (closest-to-goal) row reached THIS level — score credit. */
  bestRow: number;
  invuln: number;
  anim: number; // cosmetic move bounce 1→0
  checkpointKind: "denied" | "congrats" | null;
  checkpointTimer: number;
  lanes: LaneState[];
  toast: Toast | null;
  /** 60Hz ticks since run start — drives the m:ss stopwatch. */
  tick: number;
}

/**
 * The delivery's ONLY RNG: instance x = (W/count)·i + rand()·40, drawn
 * lane by lane (row 1→5), instance 0 then 1. Called at run start and on
 * every level advance.
 */
export function buildLanes(rng: Rng): LaneState[] {
  return LANES.map((spec) => ({
    spec,
    xs: Array.from(
      { length: INSTANCES_PER_LANE },
      (_, i) => (GAME_W / INSTANCES_PER_LANE) * i + rng() * JITTER_MAX,
    ),
  }));
}

export function createFroggerState(rng: Rng): FroggerState {
  return {
    status: "playing",
    level: 1,
    lives: LIVES,
    score: 0,
    row: START_ROW,
    bestRow: START_ROW,
    invuln: 0,
    anim: 0,
    checkpointKind: null,
    checkpointTimer: 0,
    lanes: buildLanes(rng),
    toast: null,
    tick: 0,
  };
}

/**
 * Instant single-axis move (delivery: no tween, no queue, no cooldown).
 * Scores only NEW best rows — backward moves never subtract, re-crossing
 * after a hit re-earns nothing. Reaching the goal starts the checkpoint
 * beat (the level's 6th point is credited first, so a full clean run
 * submits exactly 60).
 */
export function move(state: FroggerState, delta: -1 | 1): void {
  if (state.status !== "playing") return;
  const newRow = state.row + delta;
  if (newRow < GOAL_ROW || newRow > START_ROW) return;
  state.row = newRow;
  state.anim = 1;
  if (newRow < state.bestRow) {
    state.score += state.bestRow - newRow;
    state.bestRow = newRow;
  }
  if (newRow === GOAL_ROW) {
    state.status = "checkpoint";
    state.checkpointKind = state.level >= TOTAL_LEVELS ? "congrats" : "denied";
    state.checkpointTimer = 0;
  }
}

function hitThreshold(spec: LaneSpec): number {
  return HERO_HALF + 0.3 * laneDrawWidth(spec);
}

const HIT_TOAST_KEYS: Record<LaneKey, string> = {
  golf: "game.frogger.obstacle.golf",
  merch: "game.frogger.obstacle.merch",
  scalper: "game.frogger.obstacle.scalper",
  kfood: "game.frogger.obstacle.kfood",
  guard: "game.frogger.obstacle.guard",
};

function handleHit(state: FroggerState, laneKey: LaneKey): void {
  state.lives--;
  state.invuln = INVULN_TICKS;
  // Delivery parity: ONLY the hero resets — obstacles keep moving,
  // bestRow stands (no re-earning), the stopwatch keeps counting.
  state.row = START_ROW;
  if (state.lives <= 0) {
    state.status = "lost";
    return;
  }
  state.toast = {
    key: "game.frogger.toast.hit",
    params: { labelKey: HIT_TOAST_KEYS[laneKey], lives: String(state.lives) },
    ticks: TOAST_TICKS,
  };
}

/** One fixed 60Hz simulation step. */
export function step(state: FroggerState, rng: Rng): void {
  if (state.status === "won" || state.status === "lost") return;
  state.tick++;
  if (state.anim > 0) state.anim = Math.max(0, state.anim - ANIM_DECAY);
  if (state.toast && --state.toast.ticks <= 0) state.toast = null;

  if (state.status === "checkpoint") {
    // Obstacles FREEZE during the guard beat (delivery: running=false).
    state.checkpointTimer++;
    if (state.checkpointTimer > CHECKPOINT_TICKS) {
      if (state.checkpointKind === "congrats") {
        state.status = "won";
        return;
      }
      state.level++;
      state.row = START_ROW;
      state.bestRow = START_ROW;
      state.invuln = 0;
      state.checkpointKind = null;
      state.lanes = buildLanes(rng); // re-randomized every level (delivery)
      state.status = "playing";
      state.toast = {
        key: "game.frogger.toast.level",
        params: { level: String(state.level) },
        ticks: TOAST_TICKS,
      };
    }
    return;
  }

  if (state.invuln > 0) state.invuln--;

  const mult = speedMult(state.level);
  for (const lane of state.lanes) {
    const w = laneDrawWidth(lane.spec);
    const v = lane.spec.baseSpeed * mult * lane.spec.dir;
    for (let i = 0; i < lane.xs.length; i++) {
      lane.xs[i] += v;
      if (lane.spec.dir === 1 && lane.xs[i] > GAME_W + w) lane.xs[i] = -w;
      if (lane.spec.dir === -1 && lane.xs[i] < -w) lane.xs[i] = GAME_W + w;
    }
  }

  // 1-D collision on the hero's row only (rows 1..5 are lanes 0..4).
  if (state.invuln <= 0 && state.row >= 1 && state.row <= 5) {
    const lane = state.lanes[state.row - 1];
    const threshold = hitThreshold(lane.spec);
    for (const x of lane.xs) {
      if (Math.abs(x - HERO_X) < threshold) {
        handleHit(state, lane.spec.key);
        return;
      }
    }
  }
}

/** m:ss (delivery format: minutes unpadded, seconds padded). */
export function formatTime(ticks: number): string {
  const totalSeconds = Math.floor(ticks / 60);
  const mins = Math.floor(totalSeconds / 60);
  const secs = totalSeconds % 60;
  return `${mins}:${String(secs).padStart(2, "0")}`;
}
