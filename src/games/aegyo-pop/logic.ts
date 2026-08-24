/**
 * Seeded Aegyo Pop rules, adapted from DaiDai's standalone delivery.
 *
 * Mechanics live here so counted runs can be replayed from RunContext.random
 * and rule vectors never need a canvas or browser clock.
 */

export const DESIGN_W = 390;
export const DESIGN_H = 780;
export const COLS = 8;
export const RADIUS = DESIGN_W / (COLS * 2 + 1);
export const OFFSET_TOP = DESIGN_H * 0.1;
export const SHOOTER_X = DESIGN_W / 2;
export const SHOOTER_Y = DESIGN_H * 0.92;

export const COLOR_KEYS = ["star", "heart", "diamond", "sun", "moon"] as const;

export type ColorKey = (typeof COLOR_KEYS)[number];
export type Rng = () => number;

export interface LevelConfig {
  rows: number;
  colorCount: number;
  dropEvery: number;
  ceilingLimit: number;
  maxDrops: number;
  iceChance: number;
  captive: boolean;
}

export const LEVELS: readonly LevelConfig[] = [
  {
    rows: 5,
    colorCount: 3,
    dropEvery: 8,
    ceilingLimit: 0.8,
    maxDrops: 3,
    iceChance: 0,
    captive: false,
  },
  {
    rows: 6,
    colorCount: 3,
    dropEvery: 7,
    ceilingLimit: 0.8,
    maxDrops: 4,
    iceChance: 0,
    captive: true,
  },
  {
    rows: 7,
    colorCount: 4,
    dropEvery: 6,
    ceilingLimit: 0.78,
    maxDrops: 4,
    iceChance: 0.1,
    captive: false,
  },
  {
    rows: 8,
    colorCount: 4,
    dropEvery: 6,
    ceilingLimit: 0.76,
    maxDrops: 5,
    iceChance: 0.12,
    captive: true,
  },
  {
    rows: 9,
    colorCount: 5,
    dropEvery: 5,
    ceilingLimit: 0.74,
    maxDrops: 5,
    iceChance: 0.14,
    captive: true,
  },
] as const;

export const SCORE_PER_BUBBLE_BASE = 10;
export const BOMB_SCORE_MULTIPLIER = 2;
export const COMBO_MULTIPLIER_STEP = 0.2;
export const COMBO_MULTIPLIER_CAP = 2.5;
export const CAPTIVE_RESCUE_BONUS_PER_LEVEL = 150;
export const CLEAR_BONUS = [50, 70, 100, 140, 200] as const;

/**
 * The delivery's refillable shooter can otherwise be farmed forever while
 * leaving one ceiling-connected bubble alive. V1 makes that competitive
 * surface explicit: raw play points saturate below 50k, then a 50k full-clear
 * bonus guarantees every five-level clear ranks above every incomplete run.
 */
export const MAX_RAW_SCORE = 49_999;
export const COMPLETION_BONUS = 50_000;
export const MAX_SCORE = MAX_RAW_SCORE + COMPLETION_BONUS;

const SPECIAL_CHANCE_BASE = 0.06;
const SPECIAL_CHANCE_PER_LEVEL = 0.005;
const DANGER_WARN_ROWS = 3.4;
const SHOT_SPEED = DESIGN_W * 0.032 * 60;
const SPIN_MIN = 0.11 * 60;
const SPIN_RANGE = 0.07 * 60;
const SUBSTEP_MAX_FRACTION = 0.85;

export type BubbleSpecial = "bomb" | "ice" | "captive" | null;

export interface Bubble {
  color?: ColorKey;
  special: BubbleSpecial;
  hp?: number;
}

export interface ProjectileBubble {
  color: ColorKey;
  special: "bomb" | null;
}

export interface FlyingBubble extends ProjectileBubble {
  x: number;
  y: number;
  vx: number;
  vy: number;
  rotation: number;
  rotationSpeed: number;
}

export interface CellPosition {
  row: number;
  col: number;
}

export type AegyoPopStatus = "playing" | "transition" | "over" | "won";

export interface AegyoPopState {
  status: AegyoPopStatus;
  grid: (Bubble | null)[][];
  level: number;
  score: number;
  shots: number;
  elapsedMs: number;
  shotsSinceDrop: number;
  dropsUsed: number;
  combo: number;
  dangerLevel: number;
  dangerWarned: boolean;
  aimAngle: number;
  loaded: ProjectileBubble | null;
  queued: ProjectileBubble;
  flying: FlyingBubble | null;
}

export type AegyoPopEvent =
  | { kind: "shot" }
  | {
      kind: "impact";
      x: number;
      y: number;
      color: ColorKey;
      fall: boolean;
      big: boolean;
    }
  | {
      kind: "pop";
      groupSize: number;
      gained: number;
      combo: number;
      bombExtra: number;
    }
  | { kind: "drop"; count: number }
  | { kind: "rescue"; bonus: number; x: number; y: number }
  | { kind: "last-wave" }
  | { kind: "danger" }
  | { kind: "level-clear" }
  | { kind: "lost" }
  | { kind: "won" };

function pick<T>(values: readonly T[], rng: Rng): T {
  return values[Math.min(values.length - 1, Math.floor(rng() * values.length))];
}

function levelConfig(state: AegyoPopState): LevelConfig {
  return LEVELS[state.level - 1];
}

function specialChance(level: number): number {
  return SPECIAL_CHANCE_BASE + (level - 1) * SPECIAL_CHANCE_PER_LEVEL;
}

function paletteFor(level: number): readonly ColorKey[] {
  return COLOR_KEYS.slice(0, LEVELS[level - 1].colorCount);
}

function randomProjectile(level: number, rng: Rng): ProjectileBubble {
  return {
    color: pick(paletteFor(level), rng),
    special: rng() < specialChance(level) ? "bomb" : null,
  };
}

function addRawScore(state: AegyoPopState, amount: number): number {
  const before = state.score;
  state.score = Math.min(MAX_RAW_SCORE, state.score + Math.max(0, amount));
  return state.score - before;
}

export function rowOffsetX(row: number): number {
  return row % 2 === 1 ? RADIUS : 0;
}

export function cellPosition(
  row: number,
  col: number,
): { x: number; y: number } {
  return {
    x: RADIUS + col * RADIUS * 2 + rowOffsetX(row),
    y: OFFSET_TOP + row * RADIUS * 1.73,
  };
}

export function neighbors(
  grid: readonly (readonly (Bubble | null)[])[],
  row: number,
  col: number,
): CellPosition[] {
  const deltas =
    row % 2 === 1
      ? [
          [0, -1],
          [0, 1],
          [-1, 0],
          [-1, 1],
          [1, 0],
          [1, 1],
        ]
      : [
          [0, -1],
          [0, 1],
          [-1, -1],
          [-1, 0],
          [1, -1],
          [1, 0],
        ];
  return deltas
    .map(([dr, dc]) => ({ row: row + dr, col: col + dc }))
    .filter(
      ({ row: nextRow, col: nextCol }) =>
        nextRow >= 0 && nextRow < grid.length && nextCol >= 0 && nextCol < COLS,
    );
}

function buildLevel(state: AegyoPopState, rng: Rng): void {
  const config = levelConfig(state);
  const palette = paletteFor(state.level);
  const chance = specialChance(state.level);
  state.grid = Array.from({ length: config.rows }, () =>
    Array.from({ length: COLS }, () => {
      const bomb = rng() < chance;
      const ice = !bomb && config.iceChance > 0 && rng() < config.iceChance;
      return {
        color: pick(palette, rng),
        special: bomb ? "bomb" : ice ? "ice" : null,
        hp: ice ? 2 : undefined,
      } satisfies Bubble;
    }),
  );
  if (config.captive) {
    const row = Math.min(config.rows - 1, Math.floor(config.rows * 0.55));
    state.grid[row][Math.floor(COLS / 2)] = { special: "captive" };
  }
  state.shotsSinceDrop = 0;
  state.dropsUsed = 0;
  state.combo = 0;
  state.dangerLevel = 0;
  state.dangerWarned = false;
  state.aimAngle = -Math.PI / 2;
  state.loaded = randomProjectile(state.level, rng);
  state.queued = randomProjectile(state.level, rng);
  state.flying = null;
  state.status = "playing";
}

export function createAegyoPopState(rng: Rng): AegyoPopState {
  const state: AegyoPopState = {
    status: "playing",
    grid: [],
    level: 1,
    score: 0,
    shots: 0,
    elapsedMs: 0,
    shotsSinceDrop: 0,
    dropsUsed: 0,
    combo: 0,
    dangerLevel: 0,
    dangerWarned: false,
    aimAngle: -Math.PI / 2,
    loaded: null,
    queued: { color: "star", special: null },
    flying: null,
  };
  buildLevel(state, rng);
  return state;
}

export function continueAegyoPop(state: AegyoPopState, rng: Rng): boolean {
  if (state.status !== "transition" || state.level >= LEVELS.length)
    return false;
  state.level += 1;
  buildLevel(state, rng);
  return true;
}

export function setAimFromPoint(
  state: AegyoPopState,
  x: number,
  y: number,
): void {
  if (state.status !== "playing") return;
  const angle = Math.atan2(y - SHOOTER_Y, x - SHOOTER_X);
  state.aimAngle = Math.max(-Math.PI + 0.12, Math.min(-0.12, angle));
}

export function nudgeAim(state: AegyoPopState, delta: number): void {
  if (state.status !== "playing") return;
  state.aimAngle = Math.max(
    -Math.PI + 0.12,
    Math.min(-0.12, state.aimAngle + delta),
  );
}

export function shootAegyoPop(state: AegyoPopState, rng: Rng): AegyoPopEvent[] {
  if (state.status !== "playing" || state.flying || !state.loaded) return [];
  const spinDirection = rng() < 0.5 ? -1 : 1;
  state.flying = {
    ...state.loaded,
    x: SHOOTER_X,
    y: SHOOTER_Y,
    vx: Math.cos(state.aimAngle) * SHOT_SPEED,
    vy: Math.sin(state.aimAngle) * SHOT_SPEED,
    rotation: 0,
    rotationSpeed: spinDirection * (SPIN_MIN + rng() * SPIN_RANGE),
  };
  state.loaded = null;
  state.shots += 1;
  state.shotsSinceDrop += 1;
  return [{ kind: "shot" }];
}

function crackOrRemove(
  state: AegyoPopState,
  row: number,
  col: number,
  events: AegyoPopEvent[],
  { fall = false, big = false }: { fall?: boolean; big?: boolean } = {},
): boolean {
  const cell = state.grid[row]?.[col];
  if (!cell || cell.special === "captive" || !cell.color) return false;
  if (cell.special === "ice") {
    cell.hp = Math.max(0, (cell.hp ?? 2) - 1);
  }
  const position = cellPosition(row, col);
  events.push({
    kind: "impact",
    ...position,
    color: cell.color,
    fall,
    big,
  });
  if (cell.special === "ice" && (cell.hp ?? 0) > 0) return false;
  state.grid[row][col] = null;
  return true;
}

export function dropOrphans(
  state: AegyoPopState,
  events: AegyoPopEvent[] = [],
): number {
  const connected = new Set<string>();
  const stack: CellPosition[] = [];
  for (let col = 0; col < COLS; col += 1) {
    if (!state.grid[0]?.[col]) continue;
    connected.add(`0,${col}`);
    stack.push({ row: 0, col });
  }
  while (stack.length > 0) {
    const current = stack.pop()!;
    for (const next of neighbors(state.grid, current.row, current.col)) {
      const key = `${next.row},${next.col}`;
      if (connected.has(key) || !state.grid[next.row][next.col]) continue;
      connected.add(key);
      stack.push(next);
    }
  }

  let fell = 0;
  for (let row = 0; row < state.grid.length; row += 1) {
    for (let col = 0; col < COLS; col += 1) {
      if (!state.grid[row][col] || connected.has(`${row},${col}`)) continue;
      if (crackOrRemove(state, row, col, events, { fall: true })) fell += 1;
    }
  }
  if (fell > 0) {
    addRawScore(state, fell * SCORE_PER_BUBBLE_BASE * state.level);
    events.push({ kind: "drop", count: fell });
  }
  return fell;
}

export function checkCaptiveRescue(
  state: AegyoPopState,
  events: AegyoPopEvent[] = [],
): number {
  let rescued = 0;
  for (let row = 0; row < state.grid.length; row += 1) {
    for (let col = 0; col < COLS; col += 1) {
      if (state.grid[row][col]?.special !== "captive") continue;
      const boxed = neighbors(state.grid, row, col).some(
        (next) => state.grid[next.row][next.col] !== null,
      );
      if (boxed) continue;
      state.grid[row][col] = null;
      const bonus = CAPTIVE_RESCUE_BONUS_PER_LEVEL * state.level;
      addRawScore(state, bonus);
      const position = cellPosition(row, col);
      events.push({ kind: "rescue", bonus, ...position });
      rescued += 1;
    }
  }
  return rescued;
}

function finishLevel(state: AegyoPopState, events: AegyoPopEvent[]): void {
  addRawScore(state, CLEAR_BONUS[state.level - 1]);
  if (state.level === LEVELS.length) {
    state.score = Math.min(MAX_SCORE, state.score + COMPLETION_BONUS);
    state.status = "won";
    events.push({ kind: "won" });
  } else {
    state.status = "transition";
    events.push({ kind: "level-clear" });
  }
}

function checkWinLoss(state: AegyoPopState, events: AegyoPopEvent[]): void {
  if (state.status !== "playing") return;
  if (state.grid.every((row) => row.every((cell) => cell === null))) {
    finishLevel(state, events);
    return;
  }

  const limitY = DESIGN_H * levelConfig(state).ceilingLimit;
  let closest = Number.POSITIVE_INFINITY;
  for (let row = 0; row < state.grid.length; row += 1) {
    for (let col = 0; col < COLS; col += 1) {
      if (!state.grid[row][col]) continue;
      const y = cellPosition(row, col).y;
      if (y > limitY - RADIUS) {
        state.status = "over";
        events.push({ kind: "lost" });
        return;
      }
      closest = Math.min(closest, limitY - y);
    }
  }
  state.dangerLevel =
    closest === Number.POSITIVE_INFINITY
      ? 0
      : Math.max(0, Math.min(1, 1 - closest / (RADIUS * DANGER_WARN_ROWS)));
  if (!state.dangerWarned && closest < RADIUS * DANGER_WARN_ROWS) {
    state.dangerWarned = true;
    events.push({ kind: "danger" });
  }
}

export function resolveMatches(
  state: AegyoPopState,
  start: CellPosition,
  events: AegyoPopEvent[] = [],
): AegyoPopEvent[] {
  const color = state.grid[start.row]?.[start.col]?.color;
  if (!color) {
    checkWinLoss(state, events);
    return events;
  }
  const seen = new Set<string>([`${start.row},${start.col}`]);
  const stack = [start];
  const group: CellPosition[] = [];
  while (stack.length > 0) {
    const current = stack.pop()!;
    group.push(current);
    for (const next of neighbors(state.grid, current.row, current.col)) {
      const key = `${next.row},${next.col}`;
      if (seen.has(key) || state.grid[next.row][next.col]?.color !== color) {
        continue;
      }
      seen.add(key);
      stack.push(next);
    }
  }

  if (group.length >= 3) {
    state.combo += 1;
    const comboMultiplier = Math.min(
      COMBO_MULTIPLIER_CAP,
      1 + (state.combo - 1) * COMBO_MULTIPLIER_STEP,
    );
    const hasBomb = group.some(
      ({ row, col }) => state.grid[row][col]?.special === "bomb",
    );
    let removed = 0;
    for (const cell of group) {
      if (crackOrRemove(state, cell.row, cell.col, events)) removed += 1;
    }
    let bombExtra = 0;
    if (hasBomb) {
      for (let row = 0; row < state.grid.length; row += 1) {
        for (let col = 0; col < COLS; col += 1) {
          if (state.grid[row][col]?.color !== color) continue;
          if (crackOrRemove(state, row, col, events, { big: true })) {
            bombExtra += 1;
          }
        }
      }
    }
    const rawPoints =
      removed * SCORE_PER_BUBBLE_BASE * state.level +
      bombExtra * SCORE_PER_BUBBLE_BASE * state.level * BOMB_SCORE_MULTIPLIER;
    const gained = addRawScore(state, Math.round(rawPoints * comboMultiplier));
    events.push({
      kind: "pop",
      groupSize: group.length,
      gained,
      combo: state.combo,
      bombExtra,
    });
    dropOrphans(state, events);
    checkCaptiveRescue(state, events);
  } else {
    state.combo = 0;
  }
  checkWinLoss(state, events);
  return events;
}

export function ceilingDrop(
  state: AegyoPopState,
  rng: Rng,
  events: AegyoPopEvent[] = [],
): boolean {
  const config = levelConfig(state);
  state.shotsSinceDrop = 0;
  if (state.dropsUsed >= config.maxDrops) return false;
  const palette = paletteFor(state.level);
  const chance = specialChance(state.level);
  state.grid.unshift(
    Array.from({ length: COLS }, () => ({
      color: pick(palette, rng),
      special: rng() < chance ? ("bomb" as const) : null,
    })),
  );
  state.dropsUsed += 1;
  if (state.dropsUsed === config.maxDrops) events.push({ kind: "last-wave" });
  checkWinLoss(state, events);
  return true;
}

function settleFlying(
  state: AegyoPopState,
  rng: Rng,
  events: AegyoPopEvent[],
): void {
  const flying = state.flying;
  if (!flying) return;
  let bestRow = 0;
  let bestCol = 0;
  let bestDistance = Number.POSITIVE_INFINITY;
  for (let row = 0; row <= state.grid.length; row += 1) {
    for (let col = 0; col < COLS; col += 1) {
      if (row < state.grid.length && state.grid[row][col]) continue;
      const position = cellPosition(row, col);
      const distance =
        (position.x - flying.x) ** 2 + (position.y - flying.y) ** 2;
      if (distance >= bestDistance) continue;
      bestDistance = distance;
      bestRow = row;
      bestCol = col;
    }
  }
  if (bestRow === state.grid.length) {
    state.grid.push(Array.from({ length: COLS }, () => null));
  }
  state.grid[bestRow][bestCol] = {
    color: flying.color,
    special: flying.special,
  };
  state.flying = null;
  state.loaded = state.queued;
  state.queued = randomProjectile(state.level, rng);
  resolveMatches(state, { row: bestRow, col: bestCol }, events);
}

function stepFlying(
  state: AegyoPopState,
  dtMs: number,
  rng: Rng,
  events: AegyoPopEvent[],
): void {
  const flying = state.flying;
  if (!flying) return;
  const dt = Math.min(50, Math.max(0, dtMs)) / 1000;
  flying.rotation += flying.rotationSpeed * dt;
  const dx = flying.vx * dt;
  const dy = flying.vy * dt;
  const distance = Math.hypot(dx, dy);
  const steps = Math.max(
    1,
    Math.ceil(distance / (RADIUS * SUBSTEP_MAX_FRACTION)),
  );
  for (let step = 0; step < steps; step += 1) {
    flying.x += dx / steps;
    flying.y += dy / steps;
    if (flying.x < RADIUS || flying.x > DESIGN_W - RADIUS) {
      flying.vx *= -1;
      flying.x = Math.max(RADIUS, Math.min(DESIGN_W - RADIUS, flying.x));
    }
    if (flying.y < OFFSET_TOP - RADIUS) {
      settleFlying(state, rng, events);
      return;
    }
    for (let row = 0; row < state.grid.length; row += 1) {
      for (let col = 0; col < COLS; col += 1) {
        if (!state.grid[row][col]) continue;
        const position = cellPosition(row, col);
        if (
          (position.x - flying.x) ** 2 + (position.y - flying.y) ** 2 <
          (RADIUS * 1.9) ** 2
        ) {
          settleFlying(state, rng, events);
          return;
        }
      }
    }
  }
}

export function stepAegyoPop(
  state: AegyoPopState,
  dtMs: number,
  rng: Rng,
): AegyoPopEvent[] {
  if (state.status !== "playing") return [];
  const events: AegyoPopEvent[] = [];
  state.elapsedMs += Math.max(0, dtMs);
  stepFlying(state, dtMs, rng, events);
  if (
    state.status === "playing" &&
    !state.flying &&
    state.shotsSinceDrop >= levelConfig(state).dropEvery
  ) {
    ceilingDrop(state, rng, events);
  }
  return events;
}

export function computeAimPath(
  state: AegyoPopState,
  maxDistance = DESIGN_W * 1.55,
): { x: number; y: number }[] {
  let x = SHOOTER_X;
  let y = SHOOTER_Y;
  let vx = Math.cos(state.aimAngle);
  const vy = Math.sin(state.aimAngle);
  const points = [{ x, y }];
  let distance = 0;
  const step = 6;
  while (distance < maxDistance) {
    x += vx * step;
    y += vy * step;
    distance += step;
    if (x < RADIUS || x > DESIGN_W - RADIUS) {
      vx *= -1;
      x = Math.max(RADIUS, Math.min(DESIGN_W - RADIUS, x));
      points.push({ x, y });
    }
    if (y < OFFSET_TOP - RADIUS) break;
    let hit = false;
    for (let row = 0; row < state.grid.length && !hit; row += 1) {
      for (let col = 0; col < COLS; col += 1) {
        if (!state.grid[row][col]) continue;
        const position = cellPosition(row, col);
        if (
          (position.x - x) ** 2 + (position.y - y) ** 2 <
          (RADIUS * 1.9) ** 2
        ) {
          hit = true;
          break;
        }
      }
    }
    if (hit) break;
  }
  points.push({ x, y });
  return points;
}

export function formatClock(elapsedMs: number): string {
  const seconds = Math.floor(elapsedMs / 1000);
  return `${String(Math.floor(seconds / 60)).padStart(2, "0")}:${String(
    seconds % 60,
  ).padStart(2, "0")}`;
}
