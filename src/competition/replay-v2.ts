import { seededRandom } from "@/shell/rng";
import {
  continueFromLevelBreak as continueSnake,
  createSnakeState,
  queueDirection,
  step as stepSnake,
  type SnakeStatus,
} from "@/games/snake/logic";
import {
  cashOut,
  continueFromLevelBreak as continueFlappy,
  createFlappyState,
  flap,
  keepFlying,
  openQuitConfirm,
  step as stepFlappy,
  type FlappyStatus,
} from "@/games/flappy/logic";
import {
  attemptToss,
  createPerfectTossState,
  stepPerfectToss,
  type PerfectTossStatus,
} from "@/games/perfect-toss/logic";

export const COMPETITION_TICK_RATE = 60 as const;
export const COMPETITION_STEP_MS = 1000 / COMPETITION_TICK_RATE;
export const MAX_TRACE_TICKS = 900 * COMPETITION_TICK_RATE;
export const MAX_TRACE_EVENTS = 10_000;
export const MAX_TRACE_BYTES = 256 * 1024;
export type CompetitionGameId = "snake" | "flappy" | "perfect-toss";
export type CompetitionAction =
  | "snake:up"
  | "snake:down"
  | "snake:left"
  | "snake:right"
  | "snake:continue"
  | "flappy:flap"
  | "flappy:continue"
  | "flappy:open-quit"
  | "flappy:keep-flying"
  | "flappy:cash-out"
  | "flappy:retry"
  | "perfect-toss:throw"
  | "pause"
  | "resume";
export interface CompetitionTraceEvent {
  tick: number;
  sequence: number;
  phase: "before" | "after";
  action: CompetitionAction;
}
export interface CompetitionTraceV2 {
  version: 2;
  gameId: CompetitionGameId;
  seed: string;
  tickRate: typeof COMPETITION_TICK_RATE;
  events: CompetitionTraceEvent[];
  terminal: {
    tick: number;
    reason: "completed" | "lost" | "quit";
    status: SnakeStatus | FlappyStatus | PerfectTossStatus;
  };
}

const ACTIONS = new Set<CompetitionAction>([
  "snake:up",
  "snake:down",
  "snake:left",
  "snake:right",
  "snake:continue",
  "flappy:flap",
  "flappy:continue",
  "flappy:open-quit",
  "flappy:keep-flying",
  "flappy:cash-out",
  "flappy:retry",
  "perfect-toss:throw",
  "pause",
  "resume",
]);

export class CompetitionTraceCaptureV2 {
  private tick = 0;
  private sequence = 0;
  private events: CompetitionTraceEvent[] = [];
  private terminal: CompetitionTraceV2["terminal"] | null = null;
  constructor(
    private readonly gameId: CompetitionGameId,
    private readonly seed: string,
  ) {}
  record(
    action: CompetitionAction,
    phase: "before" | "after" = "before",
  ): void {
    if (!this.terminal && this.events.length < MAX_TRACE_EVENTS)
      this.events.push({
        tick: this.tick,
        sequence: this.sequence++,
        phase,
        action,
      });
  }
  advanceTick(): void {
    if (!this.terminal && this.tick < MAX_TRACE_TICKS) this.tick++;
  }
  finish(
    reason: "completed" | "lost" | "quit",
    status: SnakeStatus | FlappyStatus | PerfectTossStatus,
  ): CompetitionTraceV2 {
    this.terminal ??= { tick: this.tick, reason, status };
    return {
      version: 2,
      gameId: this.gameId,
      seed: this.seed,
      tickRate: COMPETITION_TICK_RATE,
      events: this.events.map((e) => ({ ...e })),
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
const object = (v: unknown): v is Record<string, unknown> =>
  !!v && typeof v === "object" && !Array.isArray(v);
const uint = (v: unknown, max: number): v is number =>
  Number.isSafeInteger(v) && (v as number) >= 0 && (v as number) <= max;

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
    input.version !== 2 ||
    (input.gameId !== "snake" &&
      input.gameId !== "flappy" &&
      input.gameId !== "perfect-toss") ||
    typeof input.seed !== "string" ||
    input.seed.length < 1 ||
    input.seed.length > 200 ||
    /[\u0000-\u001f]/u.test(input.seed) ||
    input.tickRate !== COMPETITION_TICK_RATE ||
    !Array.isArray(input.events) ||
    input.events.length > MAX_TRACE_EVENTS ||
    !object(input.terminal) ||
    !uint(input.terminal.tick, MAX_TRACE_TICKS)
  )
    return reject("invalid_trace_shape");
  if (
    input.terminal.reason !== "completed" &&
    input.terminal.reason !== "lost" &&
    input.terminal.reason !== "quit"
  )
    return reject("invalid_terminal");

  const events: CompetitionTraceEvent[] = [];
  let priorTick = -1;
  let priorPhase: "before" | "after" = "before";
  for (let i = 0; i < input.events.length; i++) {
    const e = input.events[i];
    if (
      !object(e) ||
      !uint(e.tick, MAX_TRACE_TICKS) ||
      e.sequence !== i ||
      (e.phase !== "before" && e.phase !== "after") ||
      typeof e.action !== "string" ||
      !ACTIONS.has(e.action as CompetitionAction) ||
      e.tick > input.terminal.tick ||
      e.tick < priorTick ||
      (e.tick === priorTick && priorPhase === "after" && e.phase === "before")
    )
      return reject("invalid_event_order");
    priorTick = e.tick;
    priorPhase = e.phase;
    events.push(e as unknown as CompetitionTraceEvent);
  }

  const gameId = input.gameId;
  const seed = input.seed;
  const rng = seededRandom(seed);
  const snake = gameId === "snake" ? createSnakeState(rng) : null;
  const flappy = gameId === "flappy" ? createFlappyState(rng) : null;
  const perfectToss =
    gameId === "perfect-toss" ? createPerfectTossState(rng) : null;
  let snakeArmed = false;
  let paused = false;
  let cursor = 0;
  const apply = (e: CompetitionTraceEvent): boolean => {
    if (e.action === "pause") {
      if (paused) return false;
      paused = true;
      return true;
    }
    if (e.action === "resume") {
      if (!paused) return false;
      paused = false;
      return true;
    }
    if (paused) return false;
    if (snake) {
      const dirs = {
        "snake:up": { x: 0, y: -1 },
        "snake:down": { x: 0, y: 1 },
        "snake:left": { x: -1, y: 0 },
        "snake:right": { x: 1, y: 0 },
      } as const;
      if (e.action in dirs) {
        const accepted = queueDirection(
          snake,
          dirs[e.action as keyof typeof dirs],
        );
        if (accepted) snakeArmed = true;
        return accepted;
      }
      if (e.action === "snake:continue" && snake.status === "levelBreak") {
        continueSnake(snake, rng);
        return true;
      }
      return false;
    }
    if (perfectToss)
      return e.action === "perfect-toss:throw"
        ? attemptToss(perfectToss, rng) !== null
        : false;
    if (!flappy) return false;
    if (e.action === "flappy:flap") return flap(flappy);
    if (e.action === "flappy:continue" && flappy.status === "levelBreak") {
      continueFlappy(flappy, rng);
      return true;
    }
    if (e.action === "flappy:open-quit") return openQuitConfirm(flappy);
    if (e.action === "flappy:keep-flying" && flappy.status === "quitConfirm") {
      keepFlying(flappy);
      return true;
    }
    if (e.action === "flappy:cash-out" && flappy.status === "quitConfirm") {
      cashOut(flappy);
      return true;
    }
    return false;
  };
  for (let tick = 0; tick <= input.terminal.tick; tick++) {
    while (
      cursor < events.length &&
      events[cursor].tick === tick &&
      events[cursor].phase === "before"
    )
      if (!apply(events[cursor++])) return reject("action_not_accepted");
    const beforeFlappy = flappy?.status;
    if (!paused && tick < input.terminal.tick) {
      if (snake && snakeArmed) stepSnake(snake, COMPETITION_STEP_MS, rng);
      if (flappy) stepFlappy(flappy, COMPETITION_STEP_MS, rng);
      if (perfectToss) stepPerfectToss(perfectToss);
    }
    const retried = beforeFlappy === "crashed" && flappy?.status === "waiting";
    let retryRecorded = false;
    while (
      cursor < events.length &&
      events[cursor].tick === tick &&
      events[cursor].phase === "after"
    ) {
      const e = events[cursor++];
      if (e.action !== "flappy:retry" || !retried || retryRecorded)
        return reject("transition_not_observed");
      retryRecorded = true;
    }
    if (retried && !retryRecorded) return reject("transition_not_recorded");
  }
  if (cursor !== events.length || paused) return reject("incomplete_trace");
  const status = snake?.status ?? flappy?.status ?? perfectToss?.status;
  if (!status || status !== input.terminal.status)
    return reject("terminal_state_mismatch");
  const expectedReason =
    status === "won"
      ? "completed"
      : status === "lost" || status === "over"
        ? "lost"
        : status === "cashedOut"
          ? "quit"
          : null;
  if (expectedReason !== input.terminal.reason)
    return reject("terminal_reason_mismatch");
  return {
    ok: true,
    gameId,
    seed,
    score: perfectToss?.catches ?? snake?.score ?? flappy?.score ?? 0,
    status,
    reason: input.terminal.reason,
    ticks: input.terminal.tick,
  };
}
