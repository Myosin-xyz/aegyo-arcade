/** Seeded rules for Photocard Stack, adapted from DaiDai's delivery. */

export const DESIGN_W = 360;
export const DESIGN_H = 640;
export const CARD_ASPECT = 1.433;
export const START_WIDTH = DESIGN_W * 0.42;
export const STACK_OVERLAP = 0.62;
export const MIN_WIDTH = DESIGN_W * 0.045;
export const PERFECT_TOLERANCE = DESIGN_W * 0.014;
export const HOLO_EVERY = 10;
export const SCORE_NORMAL = 5;
export const SCORE_PERFECT = 10;
export const SCORE_COMBO_STEP = 2;
export const SCORE_HOLO = 50;
export const MAX_VALIDATED_HEIGHT = 1000;

const START_SPEED = DESIGN_W * 0.008 * 60;
const SPEED_RAMP = DESIGN_W * 0.00035 * 60;
const MAX_SPEED = DESIGN_W * 0.02 * 60;
const ART_COUNT = 11;

export type Rng = () => number;

export interface StackCard {
  x: number;
  y: number;
  w: number;
  art: number;
  holo: boolean;
}

export interface PhotocardStackState {
  status: "playing" | "over";
  stack: StackCard[];
  moving: StackCard;
  direction: -1 | 1;
  speed: number;
  score: number;
  bestHeight: number;
  cameraY: number;
  perfectCombo: number;
  hasDropped: boolean;
}

export interface FallingCard extends StackCard {
  direction: -1 | 1;
}

export type DropEvent =
  | {
      kind: "miss";
      falling: FallingCard;
      scoreChanged: false;
      rankIndex: null;
    }
  | {
      kind: "landed" | "toppled";
      falling: FallingCard | null;
      scoreChanged: true;
      perfect: boolean;
      holo: boolean;
      combo: number;
      rankIndex: number | null;
    };

export const RANK_HEIGHTS = [0, 10, 20, 35, 50] as const;

export function cardHeight(width: number): number {
  return width * CARD_ASPECT;
}

export function stackStep(width: number): number {
  return cardHeight(width) * (1 - STACK_OVERLAP);
}

export function heightOf(state: PhotocardStackState): number {
  return state.stack.length - 1;
}

export function rankIndexForHeight(height: number): number {
  let index = 0;
  for (let i = 0; i < RANK_HEIGHTS.length; i += 1) {
    if (height >= RANK_HEIGHTS[i]) index = i;
  }
  return index;
}

export function maximumScoreForHeight(height: number): number {
  return (
    height * SCORE_PERFECT +
    SCORE_COMBO_STEP * ((height * (height + 1)) / 2) +
    Math.floor(height / HOLO_EVERY) * SCORE_HOLO
  );
}

function randomIndex(rng: Rng): number {
  return Math.min(ART_COUNT - 1, Math.floor(rng() * ART_COUNT));
}

function makeMoving(
  stack: StackCard[],
  rng: Rng,
): { moving: StackCard; direction: -1 | 1 } {
  const top = stack[stack.length - 1];
  const direction: -1 | 1 = rng() < 0.5 ? 1 : -1;
  const nextHeight = stack.length;
  const holo = nextHeight % HOLO_EVERY === 0;
  return {
    direction,
    moving: {
      x: direction > 0 ? -top.w : DESIGN_W,
      y: top.y - stackStep(top.w),
      w: top.w,
      art: randomIndex(rng),
      holo,
    },
  };
}

export function createPhotocardStackState(
  rng: Rng,
  bestHeight = 0,
): PhotocardStackState {
  const base: StackCard = {
    x: (DESIGN_W - START_WIDTH) / 2,
    y: DESIGN_H * 0.72,
    w: START_WIDTH,
    art: randomIndex(rng),
    holo: false,
  };
  const next = makeMoving([base], rng);
  return {
    status: "playing",
    stack: [base],
    moving: next.moving,
    direction: next.direction,
    speed: START_SPEED,
    score: 0,
    bestHeight,
    cameraY: 0,
    perfectCombo: 0,
    hasDropped: false,
  };
}

export function stepPhotocardStack(
  state: PhotocardStackState,
  dtMs: number,
): void {
  if (state.status !== "playing") return;
  state.moving.x += state.direction * state.speed * (dtMs / 1000);
  if (state.direction > 0 && state.moving.x > DESIGN_W) state.direction = -1;
  if (state.direction < 0 && state.moving.x + state.moving.w < 0) {
    state.direction = 1;
  }

  const wanted = Math.max(0, DESIGN_H * 0.32 - state.moving.y);
  const smoothing = 1 - Math.pow(0.88, dtMs / (1000 / 60));
  state.cameraY += (wanted - state.cameraY) * smoothing;
}

function finish(state: PhotocardStackState): void {
  state.status = "over";
  state.bestHeight = Math.max(state.bestHeight, heightOf(state));
}

export function dropPhotocard(
  state: PhotocardStackState,
  rng: Rng,
): DropEvent | null {
  if (state.status !== "playing") return null;
  state.hasDropped = true;
  const top = state.stack[state.stack.length - 1];
  const moving = state.moving;
  const overlapLeft = Math.max(moving.x, top.x);
  const overlapRight = Math.min(moving.x + moving.w, top.x + top.w);
  const overlap = overlapRight - overlapLeft;

  if (overlap <= 0) {
    const falling: FallingCard = { ...moving, direction: state.direction };
    finish(state);
    return {
      kind: "miss",
      falling,
      scoreChanged: false,
      rankIndex: null,
    };
  }

  const cut = moving.w - overlap;
  const perfect = Math.abs(moving.x - top.x) < PERFECT_TOLERANCE;
  let falling: FallingCard | null = null;
  if (perfect) {
    state.perfectCombo += 1;
    moving.x = top.x;
    moving.w = top.w;
    state.score += SCORE_PERFECT + state.perfectCombo * SCORE_COMBO_STEP;
  } else {
    state.perfectCombo = 0;
    if (moving.x < top.x) {
      falling = { ...moving, w: cut, direction: -1 };
      moving.x = overlapLeft;
    } else {
      falling = {
        ...moving,
        x: overlapRight,
        w: cut,
        direction: 1,
      };
    }
    moving.w = overlap;
    state.score += SCORE_NORMAL;
  }

  state.stack.push({ ...moving });
  if (moving.holo) state.score += SCORE_HOLO;
  const height = heightOf(state);
  const rankIndex = RANK_HEIGHTS.findIndex(
    (threshold) => threshold > 0 && threshold === height,
  );

  if (moving.w < MIN_WIDTH) {
    finish(state);
    return {
      kind: "toppled",
      falling,
      scoreChanged: true,
      perfect,
      holo: moving.holo,
      combo: state.perfectCombo,
      rankIndex: rankIndex < 0 ? null : rankIndex,
    };
  }

  state.speed = Math.min(MAX_SPEED, state.speed + SPEED_RAMP);
  const next = makeMoving(state.stack, rng);
  state.moving = next.moving;
  state.direction = next.direction;
  return {
    kind: "landed",
    falling,
    scoreChanged: true,
    perfect,
    holo: moving.holo,
    combo: state.perfectCombo,
    rankIndex: rankIndex < 0 ? null : rankIndex,
  };
}
