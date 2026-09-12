import {
  CompetitionTraceCapture,
  COMPETITION_STEP_MS,
  MAX_TRACE_TICKS,
  type CompetitionAction,
  type CompetitionTraceV1,
} from "@/competition/replay";
import { seededRandom } from "@/shell/rng";
import {
  continueFromLevelBreak,
  createSnakeState,
  queueDirection,
  step,
  tickMs,
  type Cell,
  type SnakeState,
} from "@/games/snake/logic";

export interface CompetitionTraceFixture {
  trace: CompetitionTraceV1;
  expectedScore: number;
  durationMs: number;
}

const actionFor = (dir: Cell): CompetitionAction =>
  dir.y < 0
    ? "snake:up"
    : dir.y > 0
      ? "snake:down"
      : dir.x < 0
        ? "snake:left"
        : "snake:right";

function pathToFood(state: SnakeState): Cell | null {
  const start = state.snake[0];
  const queue: { cell: Cell; first: Cell | null }[] = [
    { cell: start, first: null },
  ];
  const seen = new Set([`${start.x},${start.y}`]);
  const occupied = new Set(state.snake.map((cell) => `${cell.x},${cell.y}`));
  const dirs: Cell[] = [
    { x: 1, y: 0 },
    { x: 0, y: 1 },
    { x: -1, y: 0 },
    { x: 0, y: -1 },
  ];
  while (queue.length) {
    const current = queue.shift()!;
    for (const dir of dirs) {
      if (!current.first && dir.x === -state.dir.x && dir.y === -state.dir.y)
        continue;
      const next = { x: current.cell.x + dir.x, y: current.cell.y + dir.y };
      const key = `${next.x},${next.y}`;
      if (
        next.x < 0 ||
        next.y < 0 ||
        next.x >= 13 ||
        next.y >= 13 ||
        seen.has(key) ||
        occupied.has(key)
      )
        continue;
      const first = current.first ?? dir;
      if (next.x === state.food.x && next.y === state.food.y) return first;
      seen.add(key);
      queue.push({ cell: next, first });
    }
  }
  return null;
}

/** Deterministic, positive-score, terminal trace using the production Snake core. */
export function positiveSnakeTraceFixture(): CompetitionTraceFixture {
  const seed = "snake-level-continuation";
  const rng = seededRandom(seed);
  const state = createSnakeState(rng);
  const capture = new CompetitionTraceCapture("snake", seed);
  let continued = false;
  let armed = false;
  for (
    let frame = 0;
    frame < MAX_TRACE_TICKS && state.status !== "lost";
    frame++
  ) {
    if (state.status === "levelBreak") {
      capture.record("snake:continue");
      continueFromLevelBreak(state, rng);
      continued = true;
    }
    if (
      !continued &&
      state.status === "playing" &&
      (!armed || state.tickAccumulatorMs + COMPETITION_STEP_MS >= tickMs(state))
    ) {
      const dir = pathToFood(state);
      if (dir && queueDirection(state, dir)) {
        capture.record(actionFor(dir));
        armed = true;
      }
    }
    if (armed) step(state, COMPETITION_STEP_MS, rng);
    capture.advanceTick();
  }
  if (!continued || state.status !== "lost" || state.score <= 0)
    throw new Error(
      "positive Snake fixture did not reach its expected terminal",
    );
  const trace = capture.finish("lost", "lost");
  return {
    trace,
    expectedScore: state.score,
    durationMs: (trace.terminal.tick * 1000) / trace.tickRate,
  };
}

/** Minimal valid terminal trace for route/idempotency cases that need no score. */
export function zeroScoreFlappyTraceFixture(): CompetitionTraceFixture {
  const capture = new CompetitionTraceCapture("flappy", "flappy-zero-cashout");
  capture.record("flappy:open-quit");
  capture.record("flappy:cash-out");
  const trace = capture.finish("quit", "cashedOut");
  return { trace, expectedScore: 0, durationMs: 0 };
}
