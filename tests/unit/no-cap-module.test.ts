import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { noCapDefinition } from "@/games/no-cap/module";
import { RUN_TICKS, type NoCapState } from "@/games/no-cap/logic";
import * as noCapRender from "@/games/no-cap/render";
import { seededRandom } from "@/shell/rng";
import { verifyCompetitionTrace } from "@/competition/verify-replay";
import type { CompetitionTraceV4 } from "@/competition/replay-v4";
import type { GameContext, NormalizedPointer } from "@/shell/contract";

vi.mock("@/games/no-cap/render", { spy: true });

class LoadedImage {
  onload: (() => void) | null = null;
  onerror: (() => void) | null = null;
  naturalWidth = 150;
  naturalHeight = 150;
  set src(_value: string) {
    queueMicrotask(() => this.onload?.());
  }
}

class SilentAudio {
  volume = 1;
  muted = false;
  loop = false;
  preload = "none";
  constructor(_src: string) {}
  cloneNode() {
    return new SilentAudio("");
  }
  play() {
    return Promise.resolve();
  }
  pause() {}
  addEventListener() {}
}

describe("NO CAP shell module", () => {
  beforeEach(() => {
    vi.stubGlobal("Image", LoadedImage);
    vi.stubGlobal("Audio", SilentAudio);
    vi.mocked(noCapRender.renderNoCap).mockImplementation(() => {});
  });
  afterEach(() => {
    vi.unstubAllGlobals();
    vi.restoreAllMocks();
  });

  it("records actual pointer input and ends with a server-replayable score", async () => {
    const seed = "no-cap-module-prize";
    const input: {
      pointerListener: ((value: NormalizedPointer) => void) | null;
    } = { pointerListener: null };
    const scores: number[] = [];
    const ends: { competitionTrace?: unknown; reason?: string }[] = [];
    const ctx = {
      surface: {
        kind: "canvas",
        canvas: document.createElement("canvas"),
        context2d: {},
      },
      input: {
        onPointer: (listener: (value: NormalizedPointer) => void) => {
          input.pointerListener = listener;
          return () => {
            input.pointerListener = null;
          };
        },
      },
      audio: { muted: true, onMutedChange: () => () => {} },
      t: (key: string) => key,
      report: {
        score: (score: number) => scores.push(score),
        end: (result: (typeof ends)[number]) => ends.push(result),
      },
    } as unknown as GameContext;
    const game = noCapDefinition.create(ctx);
    if (game.loop !== "shell") throw new Error("expected shell-loop game");
    await game.init(new AbortController().signal);
    game.start({
      mode: "prize",
      attemptId: "10000000-0000-4000-8000-000000000001",
      seed,
      random: seededRandom(seed),
      signal: new AbortController().signal,
      competition: { captureTrace: true },
    });
    const state = () => (game as unknown as { state: NoCapState }).state;
    let sliced = false;
    for (let tick = 0; tick < RUN_TICKS; tick++) {
      const target = state().items.find(
        (entry) => entry.fake && entry.y > 100 && entry.y < 500,
      );
      if (target && !sliced) {
        const y = Math.round(target.y);
        const left = Math.max(0, Math.round(target.x - 25));
        const right = Math.min(360, Math.round(target.x + 25));
        input.pointerListener?.({ action: "down", x: left, y, pointerId: 1 });
        for (let move = 1; move <= 25; move++) {
          input.pointerListener?.({
            action: "move",
            x: Math.round(left + ((right - left) * move) / 25),
            y,
            pointerId: 1,
          });
        }
        input.pointerListener?.({ action: "up", x: right, y, pointerId: 1 });
        input.pointerListener?.({ action: "down", x: left, y, pointerId: 1 });
        game.pause("system");
        expect(state().pointer).toBeNull();
        game.resume();
        sliced = true;
      }
      game.update(1000 / 60);
    }
    expect(sliced).toBe(true);
    expect(scores.at(-1)).toBeGreaterThan(0);
    expect(ends).toHaveLength(1);
    expect(ends[0].reason).toBe("completed");
    const trace = ends[0].competitionTrace as CompetitionTraceV4;
    expect(trace.events.filter((event) => event[1] === 1)).toHaveLength(1);
    expect(verifyCompetitionTrace(ends[0].competitionTrace)).toMatchObject({
      ok: true,
      gameId: "no-cap",
      score: scores.at(-1),
      ticks: RUN_TICKS,
    });
    game.update(1000 / 60);
    expect(ends).toHaveLength(1);
    game.destroy();
    expect(input.pointerListener).toBeNull();
  });
});
