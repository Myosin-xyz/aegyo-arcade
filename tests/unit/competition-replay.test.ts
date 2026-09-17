import { describe, expect, it } from "vitest";
import {
  CompetitionTraceCapture,
  MAX_TRACE_BYTES,
  MAX_TRACE_TICKS,
} from "@/competition/replay";
import { verifyCompetitionTrace } from "@/competition/verify-replay";
import {
  positivePerfectTossTraceFixture,
  positiveSnakeTraceFixture,
  zeroScoreFlappyTraceFixture,
} from "../fixtures/competition-traces";

describe("competition replay validation", () => {
  it("replays an actual-core level continuation before terminal loss", () => {
    const { trace, expectedScore, durationMs } = positiveSnakeTraceFixture();
    expect(
      trace.events.some((event) => event.action === "snake:continue"),
    ).toBe(true);
    expect(durationMs).toBe((trace.terminal.tick * 1000) / 60);
    const verified = verifyCompetitionTrace(trace);
    expect(verified).toMatchObject({
      ok: true,
      score: expectedScore,
      status: "lost",
    });
  });

  it("computes a cash-out result from seed and accepted actions", () => {
    const { trace } = zeroScoreFlappyTraceFixture();
    expect(verifyCompetitionTrace({ ...trace, score: 999_999 })).toEqual({
      ok: true,
      gameId: "flappy",
      seed: "flappy-zero-cashout",
      score: 0,
      status: "cashedOut",
      reason: "quit",
      ticks: 0,
    });
  });

  it("replays Perfect Toss inputs and ranks the verified catch count", () => {
    const { trace, expectedScore } = positivePerfectTossTraceFixture();
    expect(verifyCompetitionTrace(trace)).toEqual({
      ok: true,
      gameId: "perfect-toss",
      seed: "perfect-toss-one-catch",
      score: expectedScore,
      status: "over",
      reason: "lost",
      ticks: trace.terminal.tick,
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
