/**
 * Freebie Frenzy — pure deterministic core (docs/games/freebie.md).
 *
 * Ported verbatim from Daidai's delivered game.html (M2.5 acceptance
 * rubric): tier table, level configs, queue build with exactly one
 * guaranteed lightstick per level, combo curve with half-up rounding,
 * clean-clear bonus, PSD-derived geometry. All randomness flows through
 * the injected RNG (the run's seeded PRNG), and the simulation advances
 * in fixed 60Hz steps, so counted runs replay deterministically.
 *
 * IMPORTANT: `drawX = x + sin(wobble)*8` participates in catch collision
 * (as in the delivery), so wobble is simulation state, not decoration.
 */

export const DESIGN_W = 480;
export const DESIGN_H = 760;
export const STEP_MS = 1000 / 60;
const DT = STEP_MS / 1000; // seconds per fixed step

// PSD-derived anchors (delivery lines 437–443).
export const GROUND_Y = DESIGN_H * (3440 / 4097); // ≈ 638.1
export const HERO_W = DESIGN_W * (246 / 2598); // ≈ 45.45
export const HERO_H = DESIGN_H * (385 / 4097); // ≈ 71.4

export const TOTAL_LEVELS = 5;
export const ITEMS_PER_LEVEL = 10;
export const LIVES_PER_LEVEL = 3;
export const GUARANTEED_TIER = 5;
export const CLEAN_BONUS_PER_LEVEL = 50;

export const TIER_POINTS = [5, 10, 15, 20, 30, 50] as const;
export const TIER_SPEEDS = [95, 118, 140, 162, 190, 230] as const;
export const TIER_WEIGHTS = [30, 25, 20, 15, 8, 4] as const;

export interface LevelConfig {
  spawnMs: number;
  speedMul: number;
  /** Pool size: weighted picks draw from tiers 0..poolSize-1. */
  poolSize: number;
}

export const LEVEL_CONFIG: readonly LevelConfig[] = [
  { spawnMs: 1400, speedMul: 1.0, poolSize: 2 },
  { spawnMs: 1220, speedMul: 1.14, poolSize: 3 },
  { spawnMs: 1060, speedMul: 1.28, poolSize: 4 },
  { spawnMs: 900, speedMul: 1.44, poolSize: 5 },
  { spawnMs: 760, speedMul: 1.62, poolSize: 6 },
] as const;

// Movement physics (delivery line 834).
export const ACCEL = 1800;
export const MAX_SPEED = 420;
export const FRICTION = 0.86; // per 60Hz step
export const DRAG_RATE = 14;
export const EDGE_PAD = 6;

// Catch geometry (delivery lines 866–869).
export const CATCH_Y = GROUND_Y - HERO_H * 0.62; // ≈ 593.9
export const CATCH_TOLERANCE = 30;
export const CATCH_SLACK = 6;
export const WOBBLE_AMPLITUDE = 8;
export const WOBBLE_RATE = 3; // rad/s
export const SPAWN_Y = -30;
export const SPAWN_X_MIN = 40;
export const SPAWN_X_SPAN = DESIGN_W - 80;

export type Rng = () => number;

export interface Freebie {
  tier: number;
  x: number;
  y: number;
  vy: number;
  size: number;
  rot: number;
  rotSpeed: number;
  wobble: number;
}

export interface Popup {
  x: number;
  y: number;
  text: string;
  /** Seconds since spawn; render fades it, step() culls at POPUP_TTL. */
  age: number;
}

export const POPUP_TTL = 0.9;

/** Catch callout, mapped to i18n by the renderer. */
export interface Callout {
  kind: "nice" | "jackpot";
  variant: number;
  age: number;
}

export const CALLOUT_TTL = 1.2;
export const CALLOUT_VARIANTS = 3;

export type FreebieStatus = "playing" | "recap" | "won" | "lost";

export interface FreebieInput {
  left: boolean;
  right: boolean;
  /** Design-box X while dragging, null otherwise. Wins over keys. */
  dragX: number | null;
}

export interface FreebieState {
  status: FreebieStatus;
  level: number; // 1-based
  lives: number;
  combo: number;
  score: number;
  levelScore: number;
  /** Bonus awarded by the most recent level completion (recap display). */
  lastBonus: number;
  queue: number[];
  spawned: number;
  freebies: Freebie[];
  spawnTimerMs: number;
  catcher: { x: number; vx: number; bob: number; glow: number };
  popups: Popup[];
  callout: Callout | null;
  time: number;
  /** Seconds remaining on the red "missed a catch" flash (Daidai:
   * players need a clear life-loss cue). Deterministic, decays with DT. */
  missFlash: number;
}

/** Duration of the red miss flash, seconds (brief, like the original). */
export const MISS_FLASH_SEC = 0.3;

export function comboMultiplier(combo: number): number {
  return 1 + Math.min(5, Math.floor(combo / 4)) * 0.1;
}

/**
 * Shrink a font so text fits a box: the base size if it already fits,
 * else scaled down proportionally to the overflow, floored at minSize.
 * Pure so the HUD score-fit is unit-testable without a real canvas
 * (Daidai: the score overflowed its frame past 3 digits).
 */
export function fitFontPx(
  measuredWidth: number,
  maxWidth: number,
  baseSize: number,
  minSize = 10,
): number {
  if (measuredWidth <= 0 || measuredWidth <= maxWidth) return baseSize;
  return Math.max(minSize, Math.floor(baseSize * (maxWidth / measuredWidth)));
}

/** Fan rank index (0..6) for a total score — titles live in i18n. */
export const RANK_THRESHOLDS = [0, 120, 300, 550, 850, 1200, 1600] as const;
export function fanRank(score: number): number {
  let rank = 0;
  for (let i = 0; i < RANK_THRESHOLDS.length; i++) {
    if (score >= RANK_THRESHOLDS[i]) rank = i;
  }
  return rank;
}

function weightedPick(rng: Rng, poolSize: number): number {
  let total = 0;
  for (let i = 0; i < poolSize; i++) total += TIER_WEIGHTS[i];
  let r = rng() * total;
  for (let i = 0; i < poolSize; i++) {
    r -= TIER_WEIGHTS[i];
    if (r < 0) return i;
  }
  return poolSize - 1;
}

/**
 * 9 weighted picks from the level pool, one guaranteed lightstick at a
 * random slot, Fisher–Yates shuffle — every level has EXACTLY one
 * guaranteed tier-5 (even level 1), matching the delivery.
 */
export function buildLevelQueue(rng: Rng, level: number): number[] {
  const { poolSize } = LEVEL_CONFIG[level - 1];
  const queue: number[] = [];
  for (let i = 0; i < ITEMS_PER_LEVEL - 1; i++) {
    queue.push(weightedPick(rng, poolSize));
  }
  queue.splice(Math.floor(rng() * ITEMS_PER_LEVEL), 0, GUARANTEED_TIER);
  for (let i = queue.length - 1; i > 0; i--) {
    const j = Math.floor(rng() * (i + 1));
    [queue[i], queue[j]] = [queue[j], queue[i]];
  }
  return queue;
}

function startLevel(state: FreebieState, rng: Rng, level: number): void {
  state.level = level;
  state.lives = LIVES_PER_LEVEL;
  state.combo = 0;
  state.levelScore = 0;
  state.queue = buildLevelQueue(rng, level);
  state.spawned = 0;
  state.freebies = [];
  state.spawnTimerMs = 0;
  state.popups = [];
  state.callout = null;
  state.missFlash = 0;
  state.status = "playing";
}

export function createFreebieState(rng: Rng): FreebieState {
  const state: FreebieState = {
    status: "playing",
    level: 1,
    lives: LIVES_PER_LEVEL,
    combo: 0,
    score: 0,
    levelScore: 0,
    lastBonus: 0,
    queue: [],
    spawned: 0,
    freebies: [],
    spawnTimerMs: 0,
    catcher: { x: DESIGN_W / 2, vx: 0, bob: 0, glow: 0 },
    popups: [],
    callout: null,
    time: 0,
    missFlash: 0,
  };
  startLevel(state, rng, 1);
  return state;
}

/** Recap → next level. No-op unless the state is actually in recap. */
export function continueFromRecap(state: FreebieState, rng: Rng): void {
  if (state.status !== "recap") return;
  startLevel(state, rng, state.level + 1);
}

function spawnFreebie(state: FreebieState, rng: Rng): void {
  const tier = state.queue.shift();
  if (tier === undefined) return;
  const { speedMul } = LEVEL_CONFIG[state.level - 1];
  state.freebies.push({
    tier,
    x: SPAWN_X_MIN + rng() * SPAWN_X_SPAN,
    y: SPAWN_Y,
    vy: TIER_SPEEDS[tier] * speedMul,
    size: 46 + tier * 4,
    rot: rng() * Math.PI,
    rotSpeed: (rng() - 0.5) * 2.4,
    wobble: rng() * 2 * Math.PI,
  });
  state.spawned++;
  state.spawnTimerMs = 0;
}

/** The X used for BOTH drawing and collision (delivery parity). */
export function freebieDrawX(f: Freebie): number {
  return f.x + Math.sin(f.wobble) * WOBBLE_AMPLITUDE;
}

/**
 * Score one caught tier through the production path: combo increments
 * FIRST, then half-up rounding on the multiplied points (16.5 → 17 is
 * load-bearing for the 2277 maximum).
 */
export function scoreCatch(state: FreebieState, tier: number): number {
  state.combo++;
  const gained = Math.round(TIER_POINTS[tier] * comboMultiplier(state.combo));
  state.score += gained;
  state.levelScore += gained;
  return gained;
}

function loseLife(state: FreebieState): void {
  state.lives--;
  state.combo = 0;
  state.missFlash = MISS_FLASH_SEC; // arm the red damage flash
  if (state.lives <= 0) state.status = "lost";
}

/**
 * Complete the current level through the production path: clean-clear
 * bonus (`level × 50`; the delivery's lives>0 guard is a dead branch —
 * kept for parity), then recap or final win.
 */
export function completeLevel(state: FreebieState): void {
  const bonus = state.lives > 0 ? state.level * CLEAN_BONUS_PER_LEVEL : 0;
  state.lastBonus = bonus;
  state.score += bonus;
  state.status = state.level >= TOTAL_LEVELS ? "won" : "recap";
}

/** One fixed 60Hz simulation step. */
export function step(state: FreebieState, input: FreebieInput, rng: Rng): void {
  if (state.status !== "playing") return;
  state.time += DT;
  // Decay the miss flash BEFORE resolving catches — a miss this step
  // re-arms it to full afterward (loseLife), so a fresh miss stays bright.
  if (state.missFlash > 0) state.missFlash = Math.max(0, state.missFlash - DT);

  // Catcher movement: drag (position lerp) wins over hold (accelerate).
  const c = state.catcher;
  if (input.dragX !== null) {
    c.x += (input.dragX - c.x) * Math.min(1, DT * DRAG_RATE);
    c.vx = 0;
  } else if (input.left || input.right) {
    // Delivery parity: left/right accelerate INDEPENDENTLY and friction
    // applies only when neither is held — simultaneous Left+Right
    // cancels to zero net accel and PRESERVES velocity.
    if (input.left) c.vx -= ACCEL * DT;
    if (input.right) c.vx += ACCEL * DT;
    c.vx = Math.max(-MAX_SPEED, Math.min(MAX_SPEED, c.vx));
    c.x += c.vx * DT;
  } else {
    c.vx *= FRICTION;
    c.x += c.vx * DT;
  }
  const lo = HERO_W / 2 + EDGE_PAD;
  const hi = DESIGN_W - HERO_W / 2 - EDGE_PAD;
  c.x = Math.max(lo, Math.min(hi, c.x));
  c.bob += DT * 6;
  c.glow = Math.max(0, c.glow - DT * 2);

  // Spawning: interval-gated, one at a time from the level queue.
  state.spawnTimerMs += STEP_MS;
  if (
    state.queue.length > 0 &&
    state.spawnTimerMs >= LEVEL_CONFIG[state.level - 1].spawnMs
  ) {
    spawnFreebie(state, rng);
  }

  // Freebies: fall, wobble, catch or miss — resolved NEWEST-FIRST
  // (delivery parity: when two items resolve in one step across a combo
  // multiplier boundary, order changes the score).
  for (let i = state.freebies.length - 1; i >= 0; i--) {
    const f = state.freebies[i];
    f.y += f.vy * DT;
    f.rot += f.rotSpeed * DT;
    f.wobble += DT * WOBBLE_RATE;
    const drawX = freebieDrawX(f);
    const inCatchY =
      f.y >= CATCH_Y - CATCH_TOLERANCE && f.y <= CATCH_Y + CATCH_TOLERANCE;
    const inCatchX =
      Math.abs(drawX - c.x) < HERO_W / 2 + f.size / 2 - CATCH_SLACK;
    if (inCatchY && inCatchX) {
      const gained = scoreCatch(state, f.tier);
      state.popups.push({ x: drawX, y: f.y, text: `+${gained}`, age: 0 });
      if (f.tier >= 4) {
        state.callout = {
          kind: f.tier >= 5 ? "jackpot" : "nice",
          variant: Math.floor(rng() * CALLOUT_VARIANTS),
          age: 0,
        };
      }
      c.glow = 1;
      state.freebies.splice(i, 1);
    } else if (f.y - f.size / 2 > DESIGN_H) {
      state.freebies.splice(i, 1);
      loseLife(state);
      if (state.status !== "playing") return;
    }
  }

  // Cosmetic decay (deterministic, but rules-inert).
  for (const p of state.popups) p.age += DT;
  state.popups = state.popups.filter((p) => p.age < POPUP_TTL);
  if (state.callout) {
    state.callout.age += DT;
    if (state.callout.age >= CALLOUT_TTL) state.callout = null;
  }

  // Level completion: all 10 items resolved.
  if (
    state.queue.length === 0 &&
    state.freebies.length === 0 &&
    state.spawned >= ITEMS_PER_LEVEL
  ) {
    completeLevel(state);
  }
}
