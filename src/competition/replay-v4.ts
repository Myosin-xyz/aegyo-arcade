/** NO CAP replay: compact integer pointer events keep a 90-second swipe run below the API body cap. */
import {
  createNoCapState,
  DESIGN_H,
  DESIGN_W,
  RUN_TICKS,
  stepNoCap,
  swipeNoCap,
  type SwipeAction,
} from "@/games/no-cap/logic";
import { seededRandom } from "@/shell/rng";

export const MAX_TRACE_BYTES = 256 * 1024;
export const MAX_TRACE_EVENTS = 8000;
type EventCode = 0 | 1 | 2 | 3;
export type NoCapTraceEvent = [
  tick: number,
  code: EventCode,
  x: number,
  y: number,
];
export interface CompetitionTraceV4 {
  version: 4;
  gameId: "no-cap";
  seed: string;
  tickRate: 60;
  events: NoCapTraceEvent[];
  terminal: { tick: typeof RUN_TICKS; reason: "completed"; status: "over" };
}

const CODES: Record<SwipeAction, EventCode> = {
  down: 0,
  move: 1,
  up: 2,
  cancel: 3,
};
const POINTER_ACTIONS: SwipeAction[] = ["down", "move", "up", "cancel"];

export class CompetitionTraceCaptureV4 {
  private tick = 0;
  private events: NoCapTraceEvent[] = [];
  private terminal: CompetitionTraceV4["terminal"] | null = null;
  constructor(private readonly seed: string) {}
  canRecord(): boolean {
    return !this.terminal && this.events.length < MAX_TRACE_EVENTS;
  }
  record(action: SwipeAction, x: number, y: number): void {
    if (!this.canRecord()) throw new Error("no_cap_trace_full");
    this.events.push([this.tick, CODES[action], x, y]);
  }
  advanceTick(): void {
    if (!this.terminal && this.tick < RUN_TICKS) this.tick += 1;
  }
  finish(): CompetitionTraceV4 {
    this.terminal ??= { tick: RUN_TICKS, reason: "completed", status: "over" };
    return {
      version: 4,
      gameId: "no-cap",
      seed: this.seed,
      tickRate: 60,
      events: this.events.map((event) => [...event]),
      terminal: { ...this.terminal },
    };
  }
}

export type ReplayResultV4 =
  | {
      ok: true;
      gameId: "no-cap";
      seed: string;
      score: number;
      status: "over";
      reason: "completed";
      ticks: number;
    }
  | { ok: false; code: string };
const reject = (code: string): ReplayResultV4 => ({ ok: false, code });
const object = (value: unknown): value is Record<string, unknown> =>
  !!value && typeof value === "object" && !Array.isArray(value);
const integer = (value: unknown, max: number): value is number =>
  Number.isSafeInteger(value) &&
  (value as number) >= 0 &&
  (value as number) <= max;

export function verifyCompetitionTrace(input: unknown): ReplayResultV4 {
  let size: number;
  try {
    size = new TextEncoder().encode(JSON.stringify(input)).byteLength;
  } catch {
    return reject("trace_not_serializable");
  }
  if (size > MAX_TRACE_BYTES) return reject("trace_too_large");
  if (
    !object(input) ||
    input.version !== 4 ||
    input.gameId !== "no-cap" ||
    typeof input.seed !== "string" ||
    input.seed.length < 1 ||
    input.seed.length > 200 ||
    /[\u0000-\u001f]/u.test(input.seed) ||
    input.tickRate !== 60 ||
    !Array.isArray(input.events) ||
    input.events.length > MAX_TRACE_EVENTS ||
    !object(input.terminal) ||
    input.terminal.tick !== RUN_TICKS ||
    input.terminal.reason !== "completed" ||
    input.terminal.status !== "over"
  )
    return reject("invalid_trace_shape");

  const rng = seededRandom(input.seed);
  const state = createNoCapState();
  let cursor = 0;
  let priorTick = -1;
  const events = input.events as unknown[];
  for (const raw of events) {
    if (
      !Array.isArray(raw) ||
      raw.length !== 4 ||
      !integer(raw[0], RUN_TICKS - 1) ||
      !integer(raw[1], 3) ||
      !integer(raw[2], DESIGN_W) ||
      !integer(raw[3], DESIGN_H) ||
      raw[0] < priorTick
    )
      return reject("invalid_event_order");
    priorTick = raw[0];
  }
  for (let tick = 0; tick < RUN_TICKS; tick++) {
    while (
      cursor < events.length &&
      (events[cursor] as NoCapTraceEvent)[0] === tick
    ) {
      const [, code, x, y] = events[cursor++] as NoCapTraceEvent;
      if (!swipeNoCap(state, POINTER_ACTIONS[code], x, y).accepted) {
        return reject("action_not_accepted");
      }
    }
    stepNoCap(state, rng);
  }
  if (cursor !== events.length || state.status !== "over")
    return reject("incomplete_trace");
  return {
    ok: true,
    gameId: "no-cap",
    seed: input.seed,
    score: state.score,
    status: "over",
    reason: "completed",
    ticks: RUN_TICKS,
  };
}
