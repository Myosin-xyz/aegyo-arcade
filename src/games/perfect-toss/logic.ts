/** Pure, fixed-tick rules for Perfect Toss. */

export const DESIGN_W = 360;
export const DESIGN_H = 640;
export const TOSS_TICK_RATE = 60;
export const TOSS_STEP_MS = 1000 / TOSS_TICK_RATE;
export const THROW_TICKS = 33; // 0.55 seconds at 60 Hz
export const REACTION_TICKS = 30; // 0.5 seconds at 60 Hz

export const START_HALF_WIDTH = 0.3;
export const PERFECT_FRAC = 0.32;
export const SHRINK_ON_GOOD = 0.9;
export const MIN_HALF_WIDTH = 0.045;
export const START_SPEED = 1;
export const SPEED_GROW = 1.045;
export const SCORE_GOOD = 10;
export const SCORE_PERFECT = 25;
export const BONUS_SCORE = 50;
export const ZONE_RELOCATE_AFTER = 4;
export const ZONE_DRIFT_AFTER = 9;
export const ZONE_DRIFT_SPEED = 0.35;
export const ZONE_DRIFT_AMP = 0.3;
export const BONUS_CHANCE = 0.28;
export const BONUS_HALF_WIDTH_FRAC = 0.16;

export type Rng = () => number;
export type TossResult = "good" | "perfect" | "miss";
export type PerfectTossStatus = "playing" | "miss-reaction" | "over";

/** Stored relative to the sweet spot so it follows the late-game drift. */
export interface BonusZone {
  offset: number;
  halfWidth: number;
}

export interface ActiveThrow {
  ageTicks: number;
  durationTicks: number;
  offset: number;
  result: TossResult;
  bonusHit: boolean;
}

export interface TossReaction {
  result: TossResult;
  ticksRemaining: number;
}

export interface PerfectTossState {
  status: PerfectTossStatus;
  tick: number;
  halfWidth: number;
  speed: number;
  phase: number;
  catches: number;
  score: number;
  bestScore: number;
  zoneCenter: number;
  zonePhase: number;
  bonusZone: BonusZone | null;
  thrown: ActiveThrow | null;
  reaction: TossReaction | null;
}

export interface TossAttemptEvent {
  kind: "thrown";
  result: TossResult;
  bonusHit: boolean;
  points: number;
  catches: number;
  score: number;
}

export type TossStepEvent =
  | { kind: "landed"; result: TossResult; bonusHit: boolean }
  | { kind: "ended"; result: "miss" };

export function markerPosition(state: PerfectTossState): number {
  return 0.5 + 0.5 * Math.sin(state.phase);
}

export function bonusCenter(state: PerfectTossState): number | null {
  return state.bonusZone ? state.zoneCenter + state.bonusZone.offset : null;
}

function rollBonusZone(state: PerfectTossState, rng: Rng): void {
  if (rng() >= BONUS_CHANCE) {
    state.bonusZone = null;
    return;
  }
  const halfWidth = state.halfWidth * BONUS_HALF_WIDTH_FRAC;
  const maxOffset = Math.max(0, state.halfWidth - halfWidth);
  state.bonusZone = {
    offset: (rng() * 2 - 1) * maxOffset,
    halfWidth,
  };
}

function driftCenter(state: PerfectTossState): number {
  // A wide, never-shrunk PERFECT streak must still stay on the bar.
  const amplitude = Math.min(
    ZONE_DRIFT_AMP,
    Math.max(0, 0.5 - state.halfWidth),
  );
  return 0.5 + amplitude * Math.sin(state.zonePhase);
}

export function createPerfectTossState(
  rng: Rng,
  bestScore = 0,
): PerfectTossState {
  const state: PerfectTossState = {
    status: "playing",
    tick: 0,
    halfWidth: START_HALF_WIDTH,
    speed: START_SPEED,
    phase: -Math.PI / 2,
    catches: 0,
    score: 0,
    bestScore,
    zoneCenter: 0.5,
    zonePhase: rng() * Math.PI * 2,
    bonusZone: null,
    thrown: null,
    reaction: null,
  };
  rollBonusZone(state, rng);
  return state;
}

export function attemptToss(
  state: PerfectTossState,
  rng: Rng,
): TossAttemptEvent | null {
  if (state.status !== "playing" || state.thrown) return null;

  const marker = markerPosition(state);
  const offset = marker - state.zoneCenter;
  const absoluteOffset = Math.abs(offset);
  const perfectHalfWidth = state.halfWidth * PERFECT_FRAC;
  const result: TossResult =
    absoluteOffset <= perfectHalfWidth
      ? "perfect"
      : absoluteOffset <= state.halfWidth
        ? "good"
        : "miss";
  const center = bonusCenter(state);
  const bonusHit =
    result !== "miss" &&
    center !== null &&
    Math.abs(marker - center) <= state.bonusZone!.halfWidth;

  let points = 0;
  if (result === "perfect") {
    points = SCORE_PERFECT;
    state.catches += 1;
  } else if (result === "good") {
    points = SCORE_GOOD;
    state.catches += 1;
    state.halfWidth = Math.max(
      MIN_HALF_WIDTH,
      state.halfWidth * SHRINK_ON_GOOD,
    );
  }
  if (bonusHit) points += BONUS_SCORE;
  state.score += points;
  state.bestScore = Math.max(state.bestScore, state.score);

  state.thrown = {
    ageTicks: 0,
    durationTicks: THROW_TICKS,
    offset,
    result,
    bonusHit,
  };

  if (result !== "miss") {
    state.speed *= SPEED_GROW;
    if (
      state.catches >= ZONE_RELOCATE_AFTER &&
      state.catches < ZONE_DRIFT_AFTER
    ) {
      const margin = state.halfWidth + 0.05;
      state.zoneCenter = margin + rng() * (1 - margin * 2);
    } else if (state.catches >= ZONE_DRIFT_AFTER) {
      state.zoneCenter = driftCenter(state);
    }
    rollBonusZone(state, rng);
  }

  return {
    kind: "thrown",
    result,
    bonusHit,
    points,
    catches: state.catches,
    score: state.score,
  };
}

/** Advance exactly one 60 Hz simulation tick. */
export function stepPerfectToss(state: PerfectTossState): TossStepEvent | null {
  if (state.status === "over") return null;
  state.tick += 1;

  if (state.status === "miss-reaction") {
    if (state.reaction) state.reaction.ticksRemaining -= 1;
    if (!state.reaction || state.reaction.ticksRemaining <= 0) {
      state.reaction = null;
      state.status = "over";
      return { kind: "ended", result: "miss" };
    }
    return null;
  }

  state.phase += state.speed / TOSS_TICK_RATE;
  if (state.catches >= ZONE_DRIFT_AFTER) {
    state.zonePhase += ZONE_DRIFT_SPEED / TOSS_TICK_RATE;
    state.zoneCenter = driftCenter(state);
  }

  if (state.reaction) {
    state.reaction.ticksRemaining -= 1;
    if (state.reaction.ticksRemaining <= 0) state.reaction = null;
  }

  const active = state.thrown;
  if (!active) return null;
  active.ageTicks += 1;
  if (active.ageTicks < active.durationTicks) return null;

  state.thrown = null;
  state.reaction = {
    result: active.result,
    ticksRemaining: REACTION_TICKS,
  };
  if (active.result === "miss") state.status = "miss-reaction";
  return {
    kind: "landed",
    result: active.result,
    bonusHit: active.bonusHit,
  };
}
