/** Seeded rules for DaiDai's Bias Match delivery. */

export type Rng = () => number;

export interface BiasMatchLevel {
  cols: number;
  rows: number;
  peekMs: number;
  clearBonus: number;
}

export const LEVELS: readonly BiasMatchLevel[] = [
  { cols: 2, rows: 3, peekMs: 2200, clearBonus: 30 },
  { cols: 3, rows: 4, peekMs: 2100, clearBonus: 40 },
  { cols: 4, rows: 4, peekMs: 2000, clearBonus: 60 },
  { cols: 4, rows: 6, peekMs: 1900, clearBonus: 80 },
  { cols: 4, rows: 7, peekMs: 1800, clearBonus: 100 },
] as const;

export const FACE_COUNT = 16;
export const FIXED_LIVES = 5;
export const SCORE_PER_PAIR_PER_LEVEL = 10;
export const BONUS_PAIR_CHANCE = 0.25;
export const BONUS_MULTIPLIER = 2;
export const CARD_ASPECT = 1.433;
export const MATCH_DELAY_MS = 320;
export const MISMATCH_DELAY_MS = 750;

export const MAX_SCORE = LEVELS.reduce((total, level, index) => {
  const pairs = (level.cols * level.rows) / 2;
  return (
    total +
    pairs * SCORE_PER_PAIR_PER_LEVEL * (index + 1) * BONUS_MULTIPLIER +
    level.clearBonus
  );
}, 0);

export type CardStatus = "hidden" | "flipped" | "matched";

export interface BiasMatchCard {
  id: string;
  face: number;
  bonus: boolean;
  status: CardStatus;
}

export interface PendingPair {
  kind: "match" | "mismatch";
  indices: readonly [number, number];
  remainingMs: number;
}

export interface BiasMatchState {
  phase: "playing" | "transition" | "lost" | "won";
  level: number;
  lives: number;
  score: number;
  elapsedMs: number;
  peekRemainingMs: number;
  cards: BiasMatchCard[];
  firstIndex: number | null;
  pending: PendingPair | null;
  matchedPairs: number;
}

export interface StepEvent {
  changed: boolean;
  scoreChanged: boolean;
  resolved: "match" | "gold" | "mismatch" | null;
  levelCleared: boolean;
  ended: "completed" | "lost" | null;
}

function shuffle<T>(items: T[], rng: Rng): T[] {
  for (let index = items.length - 1; index > 0; index -= 1) {
    const other = Math.floor(rng() * (index + 1));
    [items[index], items[other]] = [items[other], items[index]];
  }
  return items;
}

export function pairCountForLevel(level: number): number {
  const config = LEVELS[level - 1];
  if (!config) throw new Error(`invalid Bias Match level: ${level}`);
  return (config.cols * config.rows) / 2;
}

export function buildDeck(level: number, rng: Rng): BiasMatchCard[] {
  const pairCount = pairCountForLevel(level);
  const faces = shuffle(
    Array.from({ length: FACE_COUNT }, (_, index) => index),
    rng,
  ).slice(0, pairCount);
  const bonusFaces = new Set(faces.filter(() => rng() < BONUS_PAIR_CHANCE));
  if (bonusFaces.size === 0) bonusFaces.add(faces[0]);

  return shuffle(
    faces.flatMap((face) =>
      ([0, 1] as const).map((copy) => ({
        id: `${face}-${copy}`,
        face,
        bonus: bonusFaces.has(face),
        status: "hidden" as const,
      })),
    ),
    rng,
  );
}

export function createBiasMatchState(rng: Rng): BiasMatchState {
  return {
    phase: "playing",
    level: 1,
    lives: FIXED_LIVES,
    score: 0,
    elapsedMs: 0,
    peekRemainingMs: LEVELS[0].peekMs,
    cards: buildDeck(1, rng),
    firstIndex: null,
    pending: null,
    matchedPairs: 0,
  };
}

export function continueBiasMatch(state: BiasMatchState, rng: Rng): boolean {
  if (state.phase !== "transition" || state.level >= LEVELS.length) {
    return false;
  }
  state.level += 1;
  state.phase = "playing";
  state.lives = FIXED_LIVES;
  state.peekRemainingMs = LEVELS[state.level - 1].peekMs;
  state.cards = buildDeck(state.level, rng);
  state.firstIndex = null;
  state.pending = null;
  state.matchedPairs = 0;
  return true;
}

export function selectBiasMatchCard(
  state: BiasMatchState,
  index: number,
): "ignored" | "first" | "pair" {
  const card = state.cards[index];
  if (
    state.phase !== "playing" ||
    state.peekRemainingMs > 0 ||
    state.pending ||
    !card ||
    card.status !== "hidden"
  ) {
    return "ignored";
  }

  card.status = "flipped";
  if (state.firstIndex === null) {
    state.firstIndex = index;
    return "first";
  }

  const firstIndex = state.firstIndex;
  state.firstIndex = null;
  state.pending = {
    kind: state.cards[firstIndex].face === card.face ? "match" : "mismatch",
    indices: [firstIndex, index],
    remainingMs:
      state.cards[firstIndex].face === card.face
        ? MATCH_DELAY_MS
        : MISMATCH_DELAY_MS,
  };
  return "pair";
}

export function stepBiasMatch(state: BiasMatchState, dtMs: number): StepEvent {
  const event: StepEvent = {
    changed: false,
    scoreChanged: false,
    resolved: null,
    levelCleared: false,
    ended: null,
  };
  if (state.phase !== "playing") return event;

  state.elapsedMs += Math.max(0, dtMs);
  if (state.peekRemainingMs > 0) {
    const before = state.peekRemainingMs;
    state.peekRemainingMs = Math.max(0, before - dtMs);
    event.changed = before > 0 && state.peekRemainingMs === 0;
  }

  const pending = state.pending;
  if (!pending) return event;
  pending.remainingMs -= dtMs;
  if (pending.remainingMs > 0) return event;

  const [firstIndex, secondIndex] = pending.indices;
  const first = state.cards[firstIndex];
  const second = state.cards[secondIndex];
  state.pending = null;
  event.changed = true;

  if (pending.kind === "mismatch") {
    first.status = "hidden";
    second.status = "hidden";
    state.lives -= 1;
    event.resolved = "mismatch";
    if (state.lives <= 0) {
      state.phase = "lost";
      event.ended = "lost";
    }
    return event;
  }

  first.status = "matched";
  second.status = "matched";
  state.matchedPairs += 1;
  const points =
    SCORE_PER_PAIR_PER_LEVEL *
    state.level *
    (first.bonus ? BONUS_MULTIPLIER : 1);
  state.score += points;
  event.scoreChanged = true;
  event.resolved = first.bonus ? "gold" : "match";

  if (state.matchedPairs === pairCountForLevel(state.level)) {
    state.score += LEVELS[state.level - 1].clearBonus;
    event.levelCleared = true;
    if (state.level === LEVELS.length) {
      state.phase = "won";
      event.ended = "completed";
    } else {
      state.phase = "transition";
    }
  }
  return event;
}

export function formattedTime(elapsedMs: number): string {
  const seconds = Math.floor(elapsedMs / 1000);
  return `${String(Math.floor(seconds / 60)).padStart(2, "0")}:${String(
    seconds % 60,
  ).padStart(2, "0")}`;
}
