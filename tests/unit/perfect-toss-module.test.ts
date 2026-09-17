import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { perfectTossDefinition } from "@/games/perfect-toss/module";
import type { PerfectTossState } from "@/games/perfect-toss/logic";
import { REACTION_TICKS, THROW_TICKS } from "@/games/perfect-toss/logic";
import * as tossRender from "@/games/perfect-toss/render";
import type {
  GameContext,
  NormalizedKey,
  NormalizedPointer,
  RunContext,
} from "@/shell/contract";
import { seededRandom } from "@/shell/rng";
import { verifyCompetitionTrace } from "@/competition/verify-replay";

vi.mock("@/games/perfect-toss/render", { spy: true });

class LoadedImage {
  onload: (() => void) | null = null;
  onerror: (() => void) | null = null;
  naturalWidth = 220;
  naturalHeight = 360;
  complete = true;
  set src(_value: string) {
    queueMicrotask(() => this.onload?.());
  }
}

function run(seed: string): RunContext {
  return {
    mode: "practice",
    attemptId: null,
    seed,
    random: seededRandom(seed),
    signal: new AbortController().signal,
  };
}

describe("Perfect Toss shell module", () => {
  beforeEach(() => {
    vi.stubGlobal("Image", LoadedImage);
    vi.mocked(tossRender.renderPerfectToss).mockImplementation(() => {});
  });

  afterEach(() => {
    vi.unstubAllGlobals();
    vi.restoreAllMocks();
    document.body.replaceChildren();
  });

  async function mount() {
    let pointer: ((value: NormalizedPointer) => void) | null = null;
    let key: ((value: NormalizedKey) => void) | null = null;
    const offPointer = vi.fn();
    const offKey = vi.fn();
    const scores: number[] = [];
    const ends: string[] = [];
    const endResults: unknown[] = [];
    const host = document.createElement("div");
    const canvas = document.createElement("canvas");
    document.body.appendChild(host);
    const ctx = {
      host,
      surface: {
        kind: "canvas",
        canvas,
        context2d: {} as CanvasRenderingContext2D,
        designBox: { w: 360, h: 640 },
      },
      input: {
        onPointer: (listener: (value: NormalizedPointer) => void) => {
          pointer = listener;
          return offPointer;
        },
        onKey: (listener: (value: NormalizedKey) => void) => {
          key = listener;
          return offKey;
        },
      },
      audio: { register: vi.fn(), play: vi.fn() },
      t: (translationKey: string) => translationKey,
      report: {
        score: (score: number) => scores.push(score),
        end: (result?: { reason?: string }) => {
          endResults.push(result);
          ends.push(result?.reason ?? "missing");
        },
      },
    } as unknown as GameContext;
    const game = perfectTossDefinition.create(ctx);
    if (game.loop !== "shell") throw new Error("expected shell loop");
    await game.init(new AbortController().signal);
    game.start(run("perfect-toss-module"));
    return {
      game,
      state: () => (game as unknown as { state: PerfectTossState }).state,
      pointer: (value: NormalizedPointer) => pointer?.(value),
      key: (value: NormalizedKey) => key?.(value),
      scores,
      ends,
      endResults,
      offPointer,
      offKey,
      audio: ctx.audio,
    };
  }

  it("reports catches while preserving local score in authored state", async () => {
    const mounted = await mount();
    const state = mounted.state();
    state.phase = Math.PI / 2;
    state.zoneCenter = 1;
    state.bonusZone = null;
    mounted.pointer({ action: "down", x: 180, y: 320, pointerId: 1 });
    expect(state.catches).toBe(1);
    expect(state.score).toBe(25);
    expect(mounted.scores).toEqual([0, 1]);
    mounted.pointer({ action: "down", x: 180, y: 320, pointerId: 1 });
    expect(mounted.scores).toEqual([0, 1]);
    mounted.game.destroy();
  });

  it("keeps the sad reaction visible before ending exactly once", async () => {
    const mounted = await mount();
    mounted.pointer({ action: "down", x: 180, y: 320, pointerId: 1 });
    for (let tick = 0; tick < THROW_TICKS; tick += 1)
      mounted.game.update(1000 / 60);
    expect(mounted.state().status).toBe("miss-reaction");
    expect(mounted.state().reaction?.result).toBe("miss");
    expect(mounted.ends).toEqual([]);
    mounted.game.render(0);
    expect(tossRender.renderPerfectToss).toHaveBeenCalled();

    for (let tick = 0; tick < REACTION_TICKS; tick += 1)
      mounted.game.update(1000 / 60);
    expect(mounted.state().status).toBe("over");
    expect(mounted.ends).toEqual(["lost"]);
    mounted.pointer({ action: "down", x: 180, y: 320, pointerId: 1 });
    mounted.key({ action: "down", code: "Space" });
    mounted.game.update(1000 / 60);
    expect(mounted.ends).toEqual(["lost"]);
    mounted.game.destroy();
  });

  it("emits a server-replayable trace for an official attempt", async () => {
    const mounted = await mount();
    const seed = "perfect-toss-official-module";
    mounted.game.start({
      mode: "prize",
      attemptId: "10000000-0000-4000-8000-000000000001",
      seed,
      random: seededRandom(seed),
      signal: new AbortController().signal,
      competition: { captureTrace: true },
    });
    mounted.pointer({ action: "down", x: 180, y: 320, pointerId: 1 });
    for (let tick = 0; tick < THROW_TICKS + REACTION_TICKS; tick += 1)
      mounted.game.update(1000 / 60);
    const result = mounted.endResults.at(-1) as {
      competitionTrace?: unknown;
    };
    expect(result.competitionTrace).toBeDefined();
    const verified = verifyCompetitionTrace(result.competitionTrace);
    if (!verified.ok) throw new Error(`trace rejected: ${verified.code}`);
    expect(verified).toMatchObject({
      ok: true,
      gameId: "perfect-toss",
      seed,
      score: 0,
      status: "over",
      reason: "lost",
    });
    mounted.game.destroy();
  });

  it("pauses, restarts cleanly, and tears subscriptions down idempotently", async () => {
    const mounted = await mount();
    const tick = mounted.state().tick;
    mounted.game.pause("system");
    mounted.game.update(1000 / 60);
    expect(mounted.state().tick).toBe(tick);
    mounted.game.resume();
    mounted.game.update(1000 / 60);
    expect(mounted.state().tick).toBe(tick + 1);

    mounted.game.start(run("perfect-toss-restart"));
    expect(mounted.state()).toMatchObject({
      status: "playing",
      tick: 0,
      catches: 0,
      score: 0,
      thrown: null,
      reaction: null,
    });
    mounted.game.destroy();
    mounted.game.destroy();
    expect(mounted.offPointer).toHaveBeenCalledOnce();
    expect(mounted.offKey).toHaveBeenCalledOnce();
  });
});
