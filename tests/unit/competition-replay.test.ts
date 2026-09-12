import { describe, expect, it } from "vitest";
import {
  CompetitionTraceCapture,
  MAX_TRACE_BYTES,
  MAX_TRACE_TICKS,
  verifyCompetitionTrace,
  type CompetitionAction,
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

describe("competition replay validation", () => {
  it("replays an actual-core level continuation before terminal loss", () => {
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
        (!armed || state.tickAccumulatorMs + 1000 / 60 >= tickMs(state))
      ) {
        const dir = pathToFood(state);
        if (dir && queueDirection(state, dir)) {
          capture.record(actionFor(dir));
          armed = true;
        }
      }
      if (armed) step(state, 1000 / 60, rng);
      capture.advanceTick();
    }
    expect(continued).toBe(true);
    expect(state.status).toBe("lost");
    const trace = capture.finish("lost", "lost");
    expect(
      trace.events.some((event) => event.action === "snake:continue"),
    ).toBe(true);
    const verified = verifyCompetitionTrace(trace);
    expect(verified).toMatchObject({
      ok: true,
      score: 100,
      status: "lost",
    });
  });

  it("computes a cash-out result from seed and accepted actions", () => {
    const capture = new CompetitionTraceCapture("flappy", "bounded-cashout");
    capture.record("flappy:flap");
    capture.advanceTick();
    capture.record("flappy:open-quit");
    capture.record("flappy:keep-flying");
    capture.record("flappy:open-quit");
    capture.record("flappy:cash-out");
    const trace = capture.finish("quit", "cashedOut");
    expect(verifyCompetitionTrace({ ...trace, score: 999_999 })).toEqual({
      ok: true,
      gameId: "flappy",
      seed: "bounded-cashout",
      score: 0,
      status: "cashedOut",
      reason: "quit",
      ticks: 1,
    });
  });

  it("rejects reordered, impossible, oversized, and overlong traces", () => {
    const base = new CompetitionTraceCapture("flappy", "tamper");
    base.record("flappy:open-quit");
    base.record("flappy:cash-out");
    const trace = base.finish("quit", "cashedOut");
    expect(
      verifyCompetitionTrace({
        ...trace,
        events: trace.events.map((e) => ({ ...e, sequence: e.sequence + 1 })),
      }),
    ).toEqual({ ok: false, code: "invalid_event_order" });
    expect(
      verifyCompetitionTrace({
        ...trace,
        events: [{ ...trace.events[0], action: "snake:up" }],
      }),
    ).toEqual({ ok: false, code: "action_not_accepted" });
    expect(
      verifyCompetitionTrace({ ...trace, seed: "x".repeat(MAX_TRACE_BYTES) }),
    ).toEqual({ ok: false, code: "trace_too_large" });
    expect(
      verifyCompetitionTrace({
        ...trace,
        terminal: { ...trace.terminal, tick: MAX_TRACE_TICKS + 1 },
      }),
    ).toEqual({ ok: false, code: "invalid_trace_shape" });
  });

  it("rejects a claimed terminal score/state that mechanics did not reach", () => {
    const trace = new CompetitionTraceCapture("snake", "never-started").finish(
      "lost",
      "lost",
    );
    expect(verifyCompetitionTrace(trace)).toEqual({
      ok: false,
      code: "terminal_state_mismatch",
    });
  });
});
