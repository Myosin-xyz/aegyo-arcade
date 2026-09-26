/** Deterministic 60 Hz rules for DaiDai's 90-second NO CAP time attack. */
export const DESIGN_W = 360;
export const DESIGN_H = 640;
export const TICK_RATE = 60;
export const RUN_TICKS = 90 * TICK_RATE;
export const SLICE_RADIUS = DESIGN_W * 0.058;
export const FAKE_KEYS = [
  "ticket",
  "cap",
  "sunglasses",
  "vinyl",
  "perfume",
  "watch",
  "backpack",
  "mug",
  "sticker",
  "hoodie",
] as const;
export const REAL_KEYS = [
  "lightstick",
  "photocard",
  "ticket",
  "portrait",
  "plush",
  "hoodie",
  "wristband",
  "totebag",
  "phonecase",
  "polaroid",
] as const;

export type Rng = () => number;
export type SwipeAction = "down" | "move" | "up" | "cancel";
export type NoCapStatus = "playing" | "over";
export interface FlyingItem {
  id: number;
  x: number;
  y: number;
  vx: number;
  vy: number;
  rot: number;
  rotSpeed: number;
  fake: boolean;
  gold: boolean;
  silver: boolean;
  key: string;
  sliced: boolean;
  missed: boolean;
}
export interface SliceHit {
  item: FlyingItem;
  points: number;
  combo: number;
  score: number;
}
export interface NoCapState {
  status: NoCapStatus;
  tick: number;
  score: number;
  bestScore: number;
  combo: number;
  lastHitTick: number;
  spawnCountdown: number;
  nextItemId: number;
  items: FlyingItem[];
  pointer: { x: number; y: number } | null;
  scalperThrowTicks: number;
}

export function createNoCapState(bestScore = 0): NoCapState {
  return {
    status: "playing",
    tick: 0,
    score: 0,
    bestScore,
    combo: 0,
    lastHitTick: -10_000,
    spawnCountdown: 0.6 * TICK_RATE,
    nextItemId: 1,
    items: [],
    pointer: null,
    scalperThrowTicks: 0,
  };
}

function spawn(state: NoCapState, rng: Rng): void {
  const fake = rng() < 0.8;
  const roll = rng();
  const gold = fake && roll < 0.05;
  const silver = fake && !gold && roll < 0.19;
  const keys = fake ? FAKE_KEYS : REAL_KEYS;
  const key = keys[Math.floor(rng() * keys.length)];
  const x = DESIGN_W * (0.16 + rng() * 0.68);
  const vy = -DESIGN_H * 1.18 * (0.65 + rng() * 0.67);
  const towardCenter = (DESIGN_W * 0.5 - x) / DESIGN_W;
  const vx = DESIGN_W * (towardCenter * 0.35 + (rng() - 0.5) * 0.25);
  state.items.push({
    id: state.nextItemId++,
    x,
    y: DESIGN_H * 1.02,
    vx,
    vy,
    rot: rng() * Math.PI * 2,
    rotSpeed: (rng() - 0.5) * 4,
    fake,
    gold,
    silver,
    key,
    sliced: false,
    missed: false,
  });
  state.scalperThrowTicks = 13;
}

export function stepNoCap(state: NoCapState, rng: Rng): boolean {
  if (state.status !== "playing") return false;
  state.tick += 1;
  if (state.tick >= RUN_TICKS) {
    state.status = "over";
    state.pointer = null;
    return true;
  }
  state.spawnCountdown -= 1;
  if (state.spawnCountdown <= 0) {
    const ramp = Math.min(1, state.tick / (55 * TICK_RATE));
    const interval = 1.05 + (0.42 - 1.05) * ramp;
    spawn(state, rng);
    state.spawnCountdown = interval * TICK_RATE * (0.85 + rng() * 0.3);
  }
  const dt = 1 / TICK_RATE;
  for (const item of state.items) {
    if (item.sliced || item.missed) continue;
    item.vy += DESIGN_H * 1.38 * dt;
    item.x += item.vx * dt;
    item.y += item.vy * dt;
    item.rot += item.rotSpeed * dt;
    if (item.y > DESIGN_H * 1.15 && item.vy > 0) item.missed = true;
  }
  state.items = state.items.filter((item) => !item.sliced && !item.missed);
  if (state.scalperThrowTicks > 0) state.scalperThrowTicks -= 1;
  return false;
}

function pointSegmentDistance(
  px: number,
  py: number,
  ax: number,
  ay: number,
  bx: number,
  by: number,
): number {
  const dx = bx - ax;
  const dy = by - ay;
  const lengthSquared = dx * dx + dy * dy;
  const t =
    lengthSquared > 0
      ? Math.max(
          0,
          Math.min(1, ((px - ax) * dx + (py - ay) * dy) / lengthSquared),
        )
      : 0;
  return Math.hypot(px - ax - dx * t, py - ay - dy * t);
}

/** Input is design-box coordinates. Only accepted actions belong in a replay. */
export function swipeNoCap(
  state: NoCapState,
  action: SwipeAction,
  x: number,
  y: number,
): { accepted: boolean; hits: SliceHit[] } {
  if (state.status !== "playing" || !Number.isFinite(x) || !Number.isFinite(y))
    return { accepted: false, hits: [] };
  if (x < 0 || x > DESIGN_W || y < 0 || y > DESIGN_H)
    return { accepted: false, hits: [] };
  if (action === "down") {
    if (state.pointer) return { accepted: false, hits: [] };
    state.pointer = { x, y };
    return { accepted: true, hits: [] };
  }
  if (!state.pointer) return { accepted: false, hits: [] };
  if (action === "up" || action === "cancel") {
    state.pointer = null;
    return { accepted: true, hits: [] };
  }
  const from = state.pointer;
  state.pointer = { x, y };
  const hits: SliceHit[] = [];
  for (const item of state.items) {
    if (
      item.sliced ||
      item.missed ||
      pointSegmentDistance(item.x, item.y, from.x, from.y, x, y) >= SLICE_RADIUS
    )
      continue;
    item.sliced = true;
    state.combo =
      state.tick - state.lastHitTick < 0.7 * TICK_RATE ? state.combo + 1 : 1;
    state.lastHitTick = state.tick;
    let points = 0;
    if (item.fake) {
      const base = item.gold ? 100 : item.silver ? 40 : 15;
      points = Math.round(
        base * (state.combo >= 2 ? 1 + (state.combo - 1) * 0.25 : 1),
      );
      state.score += points;
    } else {
      points = -Math.min(20, state.score);
      state.score += points;
      state.combo = 0;
    }
    state.bestScore = Math.max(state.bestScore, state.score);
    hits.push({
      item: { ...item },
      points,
      combo: state.combo,
      score: state.score,
    });
  }
  state.items = state.items.filter((item) => !item.sliced);
  return { accepted: true, hits };
}
