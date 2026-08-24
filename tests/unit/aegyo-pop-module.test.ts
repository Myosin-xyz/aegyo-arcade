import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { aegyoPopDefinition } from "@/games/aegyo-pop/module";
import type { AegyoPopState } from "@/games/aegyo-pop/logic";
import * as popRender from "@/games/aegyo-pop/render";
import type {
  GameContext,
  NormalizedKey,
  NormalizedPointer,
  RunContext,
} from "@/shell/contract";
import { seededRandom } from "@/shell/rng";

vi.mock("@/games/aegyo-pop/render", { spy: true });

class LoadedImage {
  onload: (() => void) | null = null;
  onerror: (() => void) | null = null;
  naturalWidth = 200;
  complete = true;
  private value = "";

  set src(value: string) {
    this.value = value;
    queueMicrotask(() => this.onload?.());
  }

  get src() {
    return this.value;
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

describe("Aegyo Pop shell module", () => {
  beforeEach(() => {
    vi.stubGlobal("Image", LoadedImage);
    vi.mocked(popRender.renderAegyoPop).mockImplementation(() => {});
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
    const host = document.createElement("div");
    document.body.appendChild(host);
    const ctx = {
      host,
      surface: {
        kind: "canvas",
        canvas: document.createElement("canvas"),
        context2d: {} as CanvasRenderingContext2D,
        designBox: { w: 390, h: 780 },
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
        end: (result?: { reason?: string }) =>
          ends.push(result?.reason ?? "missing"),
      },
    } as unknown as GameContext;
    const game = aegyoPopDefinition.create(ctx);
    await game.init(new AbortController().signal);
    game.start(run("aegyo-pop-module"));
    return {
      game,
      state: () => (game as unknown as { state: AegyoPopState }).state,
      pointer: (value: NormalizedPointer) => pointer?.(value),
      key: (value: NormalizedKey) => key?.(value),
      scores,
      ends,
      offPointer,
      offKey,
    };
  }

  it("fires through the InputBus, pauses cleanly, and reloads after landing", async () => {
    const mounted = await mount();
    if (mounted.game.loop !== "shell") throw new Error("expected shell loop");
    mounted.pointer({ action: "down", x: 195, y: 250, pointerId: 1 });
    expect(mounted.state().shots).toBe(1);
    expect(mounted.state().flying).not.toBeNull();
    expect(mounted.state().loaded).toBeNull();

    const beforePauseY = mounted.state().flying!.y;
    mounted.game.pause("system");
    mounted.game.update(1000);
    expect(mounted.state().flying!.y).toBe(beforePauseY);
    mounted.game.resume();
    for (let tick = 0; tick < 100 && mounted.state().flying; tick += 1) {
      mounted.game.update(1000 / 60);
    }
    expect(mounted.state().flying).toBeNull();
    expect(mounted.state().loaded).not.toBeNull();
    expect(mounted.scores[0]).toBe(0);
  });

  it("uses Enter for the authored level transition and tears subscriptions down", async () => {
    const mounted = await mount();
    mounted.state().status = "transition";
    mounted.key({ action: "down", code: "Enter" });
    expect(mounted.state().status).toBe("playing");
    expect(mounted.state().level).toBe(2);
    mounted.game.destroy();
    mounted.game.destroy();
    expect(mounted.offPointer).toHaveBeenCalledOnce();
    expect(mounted.offKey).toHaveBeenCalledOnce();
    expect(mounted.ends).toEqual([]);
  });
});
