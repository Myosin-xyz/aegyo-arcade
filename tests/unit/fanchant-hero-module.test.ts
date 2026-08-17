import { afterEach, describe, expect, it, vi } from "vitest";
import { fanchantHeroDefinition } from "@/games/fanchant-hero/module";
import type { FanchantState } from "@/games/fanchant-hero/logic";
import { BEAT_MS, OK_MS, type GoodieKey } from "@/games/fanchant-hero/logic";
import * as fanchantRender from "@/games/fanchant-hero/render";
import type { GameContext, RunContext } from "@/shell/contract";
import { seededRandom } from "@/shell/rng";

vi.mock("@/games/fanchant-hero/render", { spy: true });

function makeRun(seed: string): RunContext {
  return {
    mode: "practice",
    attemptId: null,
    seed,
    random: seededRandom(seed),
    signal: new AbortController().signal,
  };
}

function mount() {
  const save = vi.fn();
  const translate = vi.fn();
  const restore = vi.fn();
  const context2d = {
    save,
    translate,
    restore,
  } as unknown as CanvasRenderingContext2D;
  const ctx = {
    surface: {
      kind: "canvas",
      context2d,
    },
    audio: { play: vi.fn() },
    input: {},
    report: { score: vi.fn(), end: vi.fn() },
    t: (key: string) => key,
  } as unknown as GameContext;
  const game = fanchantHeroDefinition.create(ctx);
  if (game.loop !== "shell") throw new Error("expected a shell-loop game");
  game.start(makeRun("miss-shake"));

  const probe = game as unknown as {
    state: FanchantState;
    images: Record<GoodieKey, HTMLImageElement>;
    missFx: { flashMs: number; shakeMs: number };
  };
  probe.images = {} as Record<GoodieKey, HTMLImageElement>;

  return { game, probe, save, translate, restore };
}

afterEach(() => {
  vi.restoreAllMocks();
});

describe("Fanchant Hero miss feedback", () => {
  it("shakes the rendered canvas after a miss and resets on Play Again", () => {
    const { game, probe, save, translate, restore } = mount();
    vi.mocked(fanchantRender.renderFanchantHero).mockImplementation(() => {});

    const pending = probe.state.notes.find(
      (note) => note.status === "pending",
    )!;
    probe.state.elapsedMs = pending.beat * BEAT_MS + OK_MS;
    game.update(1);
    expect(probe.missFx.shakeMs).toBeGreaterThan(0);

    vi.spyOn(Math, "random").mockReturnValueOnce(1).mockReturnValueOnce(0);
    game.render(0);
    expect(save).toHaveBeenCalledOnce();
    expect(translate).toHaveBeenCalledWith(5, -5);
    expect(fanchantRender.renderFanchantHero).toHaveBeenCalledOnce();
    expect(restore).toHaveBeenCalledOnce();

    game.start(makeRun("miss-shake-retry"));
    expect(probe.missFx.shakeMs).toBe(0);
  });
});
