/** Seeded rhythm rules for Fanchant Hero, adapted from DaiDai's delivery. */

export const DESIGN_W = 360;
export const DESIGN_H = 640;
export const LANES = 4;
export const BPM = 120;
export const BEAT_MS = 60_000 / BPM;
export const SONG_BEATS = 120;
export const APPROACH_START_MS = 2200;
export const APPROACH_END_MS = 1450;
export const PERFECT_MS = 70;
export const GOOD_MS = 140;
export const OK_MS = 220;
export const SCORE_PERFECT = 100;
export const SCORE_GOOD = 60;
export const SCORE_OK = 30;
export const COMBO_BONUS = 2;
export const MAX_NOTES = 115;
export const MAX_SCORE =
  MAX_NOTES * SCORE_PERFECT + COMBO_BONUS * ((MAX_NOTES * (MAX_NOTES + 1)) / 2);

const WARMUP_UNTIL = 0.2;
const BUILD_UNTIL = 0.5;
const BUILD_DENSITY = 0.75;
const GROOVE_DENSITY = 0.92;
const BUILD_DOUBLE_CHANCE = 0.06;
const GROOVE_DOUBLE_BASE = 0.16;
const NEAR_LANE_UNTIL = 0.35;

export const GOODIE_KEYS = [
  "lightstick",
  "heart",
  "photocard_a",
  "photocard_b",
  "towel",
  "poster",
  "cd",
  "plush_a",
  "plush_b",
  "bouquet",
  "bracelet",
  "polaroid",
  "micro",
  "gift",
] as const;

export type GoodieKey = (typeof GOODIE_KEYS)[number];
export type Rng = () => number;
export type NoteStatus = "pending" | "hit" | "missed";
export type Judgement = "perfect" | "good" | "ok";

export interface FanchantNote {
  beat: number;
  lane: number;
  goodie: GoodieKey;
  status: NoteStatus;
}

export interface FanchantState {
  status: "playing" | "over";
  notes: FanchantNote[];
  elapsedMs: number;
  score: number;
  combo: number;
  maxCombo: number;
  hits: number;
  judged: number;
}

export interface RhythmStepEvent {
  missed: number;
  beats: number[];
  ended: boolean;
}

export interface HitEvent {
  judgement: Judgement;
  lane: number;
  goodie: GoodieKey;
  combo: number;
  points: number;
}

function randomItem<T>(items: readonly T[], rng: Rng): T {
  return items[Math.min(items.length - 1, Math.floor(rng() * items.length))];
}

export function buildChart(rng: Rng): FanchantNote[] {
  const notes: FanchantNote[] = [];
  let lastLane = 1;
  for (let beat = 4; beat < SONG_BEATS; beat += 1) {
    const progress = (beat - 4) / (SONG_BEATS - 4);
    let place: boolean;
    let doubleChance: number;
    let laneChoices: number[];
    if (progress < WARMUP_UNTIL) {
      place = beat % 2 === 0;
      doubleChance = 0;
      laneChoices = [1, 2];
    } else if (progress < BUILD_UNTIL) {
      place = rng() < BUILD_DENSITY;
      doubleChance = BUILD_DOUBLE_CHANCE;
      laneChoices = [0, 1, 2, 3];
    } else {
      place = rng() < GROOVE_DENSITY;
      doubleChance = GROOVE_DOUBLE_BASE + progress * 0.06;
      laneChoices = [0, 1, 2, 3];
    }
    if (!place) continue;

    let lane: number;
    if (progress < NEAR_LANE_UNTIL) {
      const near = laneChoices.filter(
        (candidate) => Math.abs(candidate - lastLane) <= 1,
      );
      lane = randomItem(near, rng);
    } else {
      lane = randomItem(laneChoices, rng);
    }
    lastLane = lane;
    notes.push({
      beat,
      lane,
      goodie: randomItem(GOODIE_KEYS, rng),
      status: "pending",
    });
    if (rng() < doubleChance) {
      const other = (lane + 1 + Math.floor(rng() * (LANES - 1))) % LANES;
      notes.push({
        beat,
        lane: other,
        goodie: randomItem(GOODIE_KEYS, rng),
        status: "pending",
      });
    }
  }
  return notes.slice(0, MAX_NOTES);
}

export function createFanchantState(rng: Rng): FanchantState {
  return {
    status: "playing",
    notes: buildChart(rng),
    elapsedMs: -APPROACH_START_MS,
    score: 0,
    combo: 0,
    maxCombo: 0,
    hits: 0,
    judged: 0,
  };
}

export function approachMsForBeat(beat: number): number {
  const progress = Math.max(0, Math.min(1, (beat - 4) / (SONG_BEATS - 4)));
  return APPROACH_START_MS + (APPROACH_END_MS - APPROACH_START_MS) * progress;
}

export function accuracyOf(state: FanchantState): number {
  return state.judged === 0
    ? 100
    : Math.round((state.hits / state.judged) * 100);
}

export function gradeForAccuracy(
  accuracy: number,
): "S" | "A" | "B" | "C" | "D" {
  if (accuracy >= 95) return "S";
  if (accuracy >= 88) return "A";
  if (accuracy >= 75) return "B";
  if (accuracy >= 60) return "C";
  return "D";
}

export function tapFanchantLane(
  state: FanchantState,
  lane: number,
): HitEvent | null {
  if (state.status !== "playing" || lane < 0 || lane >= LANES) return null;
  let nearest: FanchantNote | null = null;
  let nearestDelta = Number.POSITIVE_INFINITY;
  for (const note of state.notes) {
    if (note.status !== "pending" || note.lane !== lane) continue;
    const delta = Math.abs(note.beat * BEAT_MS - state.elapsedMs);
    if (delta < nearestDelta) {
      nearest = note;
      nearestDelta = delta;
    }
  }
  if (!nearest || nearestDelta > OK_MS) return null;

  let judgement: Judgement;
  let base: number;
  if (nearestDelta <= PERFECT_MS) {
    judgement = "perfect";
    base = SCORE_PERFECT;
  } else if (nearestDelta <= GOOD_MS) {
    judgement = "good";
    base = SCORE_GOOD;
  } else {
    judgement = "ok";
    base = SCORE_OK;
  }

  nearest.status = "hit";
  state.judged += 1;
  state.hits += 1;
  state.combo += 1;
  state.maxCombo = Math.max(state.maxCombo, state.combo);
  const points = base + state.combo * COMBO_BONUS;
  state.score += points;
  return {
    judgement,
    lane,
    goodie: nearest.goodie,
    combo: state.combo,
    points,
  };
}

export function stepFanchant(
  state: FanchantState,
  dtMs: number,
): RhythmStepEvent {
  if (state.status !== "playing") return { missed: 0, beats: [], ended: false };
  const beforeBeat = Math.floor(state.elapsedMs / BEAT_MS);
  state.elapsedMs += dtMs;
  const afterBeat = Math.floor(state.elapsedMs / BEAT_MS);
  const beats: number[] = [];
  for (let beat = beforeBeat + 1; beat <= afterBeat; beat += 1) {
    if (beat >= 0) beats.push(beat);
  }

  let missed = 0;
  for (const note of state.notes) {
    if (
      note.status === "pending" &&
      note.beat * BEAT_MS < state.elapsedMs - OK_MS
    ) {
      note.status = "missed";
      state.judged += 1;
      state.combo = 0;
      missed += 1;
    }
  }

  const ended = state.elapsedMs > (SONG_BEATS + 2) * BEAT_MS;
  if (ended) state.status = "over";
  return { missed, beats, ended };
}
