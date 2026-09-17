import { createHangmanState, guess, scoreOf } from "@/games/hangman/logic";
import { seededRandom } from "@/shell/rng";

export const COMPETITION_TICK_RATE = 60 as const;
export const MAX_TRACE_TICKS = 900 * COMPETITION_TICK_RATE;
export const MAX_TRACE_EVENTS = 10_000;
export const MAX_TRACE_BYTES = 256 * 1024;
export type CompetitionGameId = "hangman";
export type HangmanGuessAction = `hangman:guess:${string}`;
export type CompetitionAction = HangmanGuessAction | "pause" | "resume";
export interface CompetitionTraceEvent {
  tick: number;
  sequence: number;
  phase: "before";
  action: CompetitionAction;
}
export interface CompetitionTraceV3 {
  version: 3;
  gameId: CompetitionGameId;
  seed: string;
  tickRate: typeof COMPETITION_TICK_RATE;
  events: CompetitionTraceEvent[];
  terminal: {
    tick: number;
    reason: "completed" | "lost";
    status: "completed" | "lost";
  };
}

export class CompetitionTraceCaptureV3 {
  private tick = 0;
  private sequence = 0;
  private events: CompetitionTraceEvent[] = [];
  private terminal: CompetitionTraceV3["terminal"] | null = null;

  constructor(
    private readonly gameId: CompetitionGameId,
    private readonly seed: string,
  ) {}

  record(action: CompetitionAction): void {
    if (!this.terminal && this.events.length < MAX_TRACE_EVENTS) {
      this.events.push({
        tick: this.tick,
        sequence: this.sequence++,
        phase: "before",
        action,
      });
    }
  }

  advanceTick(): void {
    if (!this.terminal && this.tick < MAX_TRACE_TICKS) this.tick += 1;
  }

  finish(
    reason: CompetitionTraceV3["terminal"]["reason"],
    status: CompetitionTraceV3["terminal"]["status"],
  ): CompetitionTraceV3 {
    this.terminal ??= { tick: this.tick, reason, status };
    return {
      version: 3,
      gameId: this.gameId,
      seed: this.seed,
      tickRate: COMPETITION_TICK_RATE,
      events: this.events.map((event) => ({ ...event })),
      terminal: { ...this.terminal },
    };
  }
}

export type ReplayResult =
  | {
      ok: true;
      gameId: CompetitionGameId;
      seed: string;
      score: number;
      status: string;
      reason: string;
      ticks: number;
    }
  | { ok: false; code: string };

const reject = (code: string): ReplayResult => ({ ok: false, code });
const object = (value: unknown): value is Record<string, unknown> =>
  !!value && typeof value === "object" && !Array.isArray(value);
const uint = (value: unknown, max: number): value is number =>
  Number.isSafeInteger(value) &&
  (value as number) >= 0 &&
  (value as number) <= max;
const guessLetter = (action: string): string | null => {
  const match = /^hangman:guess:([A-Z])$/.exec(action);
  return match?.[1] ?? null;
};

export function verifyCompetitionTrace(input: unknown): ReplayResult {
  let size = MAX_TRACE_BYTES + 1;
  try {
    size = new TextEncoder().encode(JSON.stringify(input)).byteLength;
  } catch {
    return reject("trace_not_serializable");
  }
  if (size > MAX_TRACE_BYTES) return reject("trace_too_large");
  if (
    !object(input) ||
    input.version !== 3 ||
    input.gameId !== "hangman" ||
    typeof input.seed !== "string" ||
    input.seed.length < 1 ||
    input.seed.length > 200 ||
    /[\u0000-\u001f]/u.test(input.seed) ||
    input.tickRate !== COMPETITION_TICK_RATE ||
    !Array.isArray(input.events) ||
    input.events.length > MAX_TRACE_EVENTS ||
    !object(input.terminal) ||
    !uint(input.terminal.tick, MAX_TRACE_TICKS)
  ) {
    return reject("invalid_trace_shape");
  }
  if (
    (input.terminal.reason !== "completed" &&
      input.terminal.reason !== "lost") ||
    input.terminal.status !== input.terminal.reason
  ) {
    return reject("invalid_terminal");
  }

  const events: CompetitionTraceEvent[] = [];
  let priorTick = -1;
  for (let index = 0; index < input.events.length; index += 1) {
    const event = input.events[index];
    if (
      !object(event) ||
      !uint(event.tick, MAX_TRACE_TICKS) ||
      event.sequence !== index ||
      event.phase !== "before" ||
      typeof event.action !== "string" ||
      (event.action !== "pause" &&
        event.action !== "resume" &&
        !guessLetter(event.action)) ||
      event.tick > input.terminal.tick ||
      event.tick < priorTick
    ) {
      return reject("invalid_event_order");
    }
    priorTick = event.tick;
    events.push(event as unknown as CompetitionTraceEvent);
  }

  const state = createHangmanState(seededRandom(input.seed));
  let paused = false;
  for (const event of events) {
    if (event.action === "pause") {
      if (paused || state.status !== "running")
        return reject("action_not_accepted");
      paused = true;
      continue;
    }
    if (event.action === "resume") {
      if (!paused || state.status !== "running")
        return reject("action_not_accepted");
      paused = false;
      continue;
    }
    if (paused) return reject("action_not_accepted");
    const letter = guessLetter(event.action);
    if (!letter || guess(state, letter).kind === "ignored")
      return reject("action_not_accepted");
  }
  if (paused) return reject("incomplete_trace");
  if (state.status !== input.terminal.status)
    return reject("terminal_state_mismatch");

  return {
    ok: true,
    gameId: "hangman",
    seed: input.seed,
    score: scoreOf(state),
    status: state.status,
    reason: input.terminal.reason,
    ticks: input.terminal.tick,
  };
}
