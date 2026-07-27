/**
 * Bias Flap — pure deterministic core (docs/games/bias-flap.md).
 *
 * Ported from Daidai's delivered build (2026-07-27): a stan girl flies
 * through giant lightsticks toward the front row. The delivery sized
 * everything as fractions of a live canvas; this port fixes them in the
 * 360×640 design box at 60Hz ticks (the delivery ran per-frame under
 * requestAnimationFrame, i.e. the same 60fps cadence).
 *
 * Faithful to the delivery: the 5-level table (gates/speed/gap straight
 * from config.js), the ≤24%-of-height jump between consecutive gap
 * centers (no impossible sequences), crash = restart the CURRENT level
 * with the score rolled back to its level-start value (unlimited
 * retries, no lives), cash-out ends the run keeping the score, per-gate
 * scoring `10 × levelNumber` (perfect run 1700), a run timer that keeps
 * counting through crashes but freezes on overlays, and a GATES stat
 * that counts every gate passed including retried levels.
 *
 * Adaptations (deliberate):
 * - Gap centers draw from the run's SEEDED rng (delivery: Math.random),
 *   so counted runs replay identically. One draw per obstacle, retries
 *   continue the stream.
 * - The delivery's per-frame loop + `setInterval` timer become the
 *   shell's fixed-step accumulator; the timer derives from tick time.
 * - Intro/level/quit/end SCREENS are overlays in the module/host, not
 *   DOM; `backend.js` (plays/day + subscription) is replaced by portal
 *   policy (OD-1/OD-3).
 */

export type Rng = () => number;

export const DESIGN_W = 360;
export const DESIGN_H = 640;
export const STEP_MS = 1000 / 60;

export interface LevelSpec {
  gates: number;
  /** delivery px/frame at a 420px-wide canvas; scaled by W/420 here */
  speed: number;
  /** gap height as a fraction of design height */
  gap: number;
}

/** Delivery config.js values, verbatim. */
export const LEVELS: readonly LevelSpec[] = [
  { gates: 6, speed: 2.4, gap: 0.335 },
  { gates: 8, speed: 2.6, gap: 0.315 },
  { gates: 10, speed: 2.8, gap: 0.3 },
  { gates: 12, speed: 3.0, gap: 0.285 },
  { gates: 14, speed: 3.2, gap: 0.27 },
];

export const SCORE_PER_GATE = 10; // × level number (1..5)
/** 6·10 + 8·20 + 10·30 + 12·40 + 14·50 — only a full run reaches it. */
export const MAX_SCORE = LEVELS.reduce(
  (sum, level, index) => sum + level.gates * SCORE_PER_GATE * (index + 1),
  0,
); // 1700

/** Fairness bound: consecutive gap centers shift ≤ 24% of height. */
export const MAX_GAP_JUMP_FRAC = 0.24;
export const SPACING_FRAC = 0.6; // horizontal obstacle spacing (of width)
export const GAP_MARGIN_FRAC = 0.14; // gap center clear of both edges

/** Hero geometry (delivery fractions of canvas width). */
export const HERO_X = DESIGN_W * 0.3; // 108
export const HERO_W = DESIGN_W * 0.135; // 48.6
export const HERO_H = HERO_W * (141 / 160);
export const HERO_START_Y = DESIGN_H * 0.45;
/** Axis-aligned hitbox half-extents (delivery: ±0.34 of each side). */
export const HERO_HITBOX = 0.34;

/** Stick sprite metrics (140×722 source; shaft columns 39..103). */
export const STICK_SRC = { w: 140, h: 722, shaftX0: 39, shaftX1: 103 };
export const STICK_W = DESIGN_W * 0.165; // 59.4
export const STICK_H = STICK_W * (STICK_SRC.h / STICK_SRC.w);

/** Physics per 60Hz tick (delivery constants at ch=700/cw=420, scaled). */
export const GRAVITY = 0.42 * (DESIGN_H / 700);
export const FLAP_VY = -DESIGN_H * 0.0128;
export const CEILING_FORGIVE = DESIGN_H * 0.02; // may poke slightly above

/** Crash beat before the level resets (delivery: 850ms). */
export const CRASH_BEAT_MS = 850;

export function speedPerTick(level: number): number {
  return LEVELS[level].speed * (DESIGN_W / 420);
}

export interface Obstacle {
  x: number;
  gapTop: number;
  gapBot: number;
  passed: boolean;
}

export type FlappyStatus =
  | "waiting" // level armed only by the first flap; timer frozen
  | "flying"
  | "crashed" // 850ms beat, then the level restarts
  | "levelBreak" // between levels; host-side tap advances
  | "quitConfirm" // cash-out confirmation; sim + timer frozen
  | "won"
  | "cashedOut";

export interface FlappyState {
  status: FlappyStatus;
  /** 0-based */
  level: number;
  score: number;
  /** score at the start of the current level — crash rolls back to it */
  levelStartScore: number;
  /** gates passed THIS level attempt */
  gates: number;
  /** every gate ever passed, retries included (the delivery's stat) */
  totalGates: number;
  heroY: number;
  heroVy: number;
  obstacles: Obstacle[];
  /** active-play ms: runs from a level's first flap through crashes,
   * frozen on overlays and before the level is armed */
  elapsedMs: number;
  /** whether THIS level attempt has been armed by a flap yet */
  timerArmed: boolean;
  crashBeatMs: number;
  /** where quitConfirm returns to on "keep flying" */
  resumeStatus: "waiting" | "flying";
  tickAccumulatorMs: number;
}

export function levelSpec(state: FlappyState): LevelSpec {
  return LEVELS[state.level];
}

function gapBounds(level: number): { lo: number; hi: number } {
  const gapH = DESIGN_H * LEVELS[level].gap;
  const margin = DESIGN_H * GAP_MARGIN_FRAC;
  return { lo: margin + gapH / 2, hi: DESIGN_H - margin - gapH / 2 };
}

/**
 * One obstacle, gap center drawn from the seeded rng — clamped within
 * MAX_GAP_JUMP of the previous center so every sequence stays flyable
 * (delivery fairness rule). Exactly ONE rng draw per obstacle.
 */
function drawGapCenter(level: number, prev: number | null, rng: Rng): number {
  const { lo, hi } = gapBounds(level);
  if (prev === null) return lo + rng() * (hi - lo);
  const jl = Math.max(lo, prev - DESIGN_H * MAX_GAP_JUMP_FRAC);
  const jh = Math.min(hi, prev + DESIGN_H * MAX_GAP_JUMP_FRAC);
  return jl + rng() * (jh - jl);
}

/** (Re)build the current level: hero at rest, all gates pre-spawned. */
export function setupLevel(
  state: FlappyState,
  rng: Rng,
  mode: "fresh" | "retry",
): void {
  if (mode === "fresh") {
    state.levelStartScore = state.score;
    state.timerArmed = false; // a NEW level waits for its first flap
  } else {
    state.score = state.levelStartScore; // crash rollback
    // timerArmed stays true: the delivery's clock keeps counting
    // through crashes within a level.
  }
  state.gates = 0;
  state.heroY = HERO_START_Y;
  state.heroVy = 0;
  state.obstacles = [];
  const gapH = DESIGN_H * LEVELS[state.level].gap;
  let x = DESIGN_W * 1.15;
  let prev: number | null = null;
  for (let i = 0; i < LEVELS[state.level].gates; i++) {
    const gapC = drawGapCenter(state.level, prev, rng);
    prev = gapC;
    state.obstacles.push({
      x,
      gapTop: gapC - gapH / 2,
      gapBot: gapC + gapH / 2,
      passed: false,
    });
    x += DESIGN_W * SPACING_FRAC;
  }
  state.status = "waiting";
  state.crashBeatMs = 0;
  state.tickAccumulatorMs = 0;
}

export function createFlappyState(rng: Rng): FlappyState {
  const state: FlappyState = {
    status: "waiting",
    level: 0,
    score: 0,
    levelStartScore: 0,
    gates: 0,
    totalGates: 0,
    heroY: HERO_START_Y,
    heroVy: 0,
    obstacles: [],
    elapsedMs: 0,
    timerArmed: false,
    crashBeatMs: 0,
    resumeStatus: "waiting",
    tickAccumulatorMs: 0,
  };
  setupLevel(state, rng, "fresh");
  return state;
}

/** First flap of a level arms it (and its clock); mid-air flaps steer. */
export function flap(state: FlappyState): boolean {
  if (state.status === "waiting") {
    state.status = "flying";
    state.timerArmed = true;
  }
  if (state.status !== "flying") return false;
  state.heroVy = FLAP_VY;
  return true;
}

/** Open the cash-out confirmation (the delivery's ⏹ leave button). */
export function openQuitConfirm(state: FlappyState): boolean {
  if (state.status !== "flying" && state.status !== "waiting") return false;
  state.resumeStatus = state.status;
  state.status = "quitConfirm";
  return true;
}

export function keepFlying(state: FlappyState): void {
  if (state.status !== "quitConfirm") return;
  state.status = state.resumeStatus;
}

/** Leave & save: the run ends, current score stands. */
export function cashOut(state: FlappyState): void {
  if (state.status !== "quitConfirm") return;
  state.status = "cashedOut";
}

/** Advance past a level break into the next level. */
export function continueFromLevelBreak(state: FlappyState, rng: Rng): void {
  if (state.status !== "levelBreak") return;
  state.level++;
  setupLevel(state, rng, "fresh");
}

function crash(state: FlappyState): void {
  state.status = "crashed";
  state.crashBeatMs = CRASH_BEAT_MS;
}

/** Hero hitbox against one stick pair (delivery collision, verbatim). */
function hitsObstacle(state: FlappyState, o: Obstacle): boolean {
  const x0 = HERO_X - HERO_W * HERO_HITBOX;
  const x1 = HERO_X + HERO_W * HERO_HITBOX;
  const y0 = state.heroY - HERO_H * HERO_HITBOX;
  const y1 = state.heroY + HERO_H * HERO_HITBOX;
  const sw = STICK_W;
  const shaftHalf =
    (sw * ((STICK_SRC.shaftX1 - STICK_SRC.shaftX0) / STICK_SRC.w)) / 2;
  const orbHalf = sw * 0.46;
  const cx = o.x;
  // Top stick occupies y < gapTop (orb at its bottom); the shaft gets a
  // small forgiveness near the gap edge, the wider orb does not.
  if (x1 > cx - shaftHalf && x0 < cx + shaftHalf && y0 < o.gapTop - sw * 0.02)
    return true;
  if (
    x1 > cx - orbHalf &&
    x0 < cx + orbHalf &&
    y0 < o.gapTop &&
    y0 > o.gapTop - sw * 0.95
  )
    return true;
  // Bottom stick occupies y > gapBot (orb at its top).
  if (x1 > cx - shaftHalf && x0 < cx + shaftHalf && y1 > o.gapBot + sw * 0.02)
    return true;
  if (
    x1 > cx - orbHalf &&
    x0 < cx + orbHalf &&
    y1 > o.gapBot &&
    y1 < o.gapBot + sw * 0.95
  )
    return true;
  return false;
}

/** ONE 60Hz simulation tick while flying. */
export function tick(state: FlappyState): void {
  if (state.status !== "flying") return;
  const L = levelSpec(state);
  state.heroVy += GRAVITY;
  state.heroY += state.heroVy;
  const sp = speedPerTick(state.level);
  for (const o of state.obstacles) o.x -= sp;

  for (const o of state.obstacles) {
    if (!o.passed && o.x + STICK_W / 2 < HERO_X) {
      o.passed = true;
      state.gates++;
      state.totalGates++;
      state.score += SCORE_PER_GATE * (state.level + 1);
      if (state.gates >= L.gates) {
        state.status = state.level >= LEVELS.length - 1 ? "won" : "levelBreak";
        return;
      }
    }
  }

  if (
    state.heroY - HERO_H / 2 < -CEILING_FORGIVE ||
    state.heroY + HERO_H / 2 > DESIGN_H
  ) {
    crash(state);
    return;
  }
  for (const o of state.obstacles) {
    if (hitsObstacle(state, o)) {
      crash(state);
      return;
    }
  }
}

/**
 * Advance by real time. Drives 60Hz ticks while flying, runs the crash
 * beat (then restarts the level with fresh seeded gaps), and accumulates
 * the active-play clock: armed waiting/flying/crash time counts;
 * overlays (levelBreak, quitConfirm) and terminal states do not.
 *
 * RETURNS the resulting status — reading `state.status` after this call
 * keeps TypeScript's pre-call narrowing and dead-ends comparisons.
 */
export function step(state: FlappyState, dtMs: number, rng: Rng): FlappyStatus {
  if (
    state.status === "won" ||
    state.status === "cashedOut" ||
    state.status === "levelBreak" ||
    state.status === "quitConfirm"
  ) {
    return state.status;
  }

  if (state.timerArmed) state.elapsedMs += dtMs;

  if (state.status === "crashed") {
    state.crashBeatMs -= dtMs;
    if (state.crashBeatMs <= 0) {
      setupLevel(state, rng, "retry");
      // Respawned into "waiting"; the clock keeps running (armed).
    }
    return state.status;
  }
  if (state.status !== "flying") return state.status; // waiting: frozen sim

  state.tickAccumulatorMs += dtMs;
  while (state.tickAccumulatorMs >= STEP_MS && state.status === "flying") {
    state.tickAccumulatorMs -= STEP_MS;
    tick(state);
  }
  return state.status;
}

/** Whole-second MM:SS, the delivery's HUD/stat format. */
export function formatTime(elapsedMs: number): string {
  const s = Math.floor(elapsedMs / 1000);
  return `${String(Math.floor(s / 60)).padStart(2, "0")}:${String(s % 60).padStart(2, "0")}`;
}
