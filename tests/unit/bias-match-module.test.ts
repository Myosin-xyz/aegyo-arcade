import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { biasMatchDefinition } from "@/games/bias-match/module";
import { LEVELS, type BiasMatchState } from "@/games/bias-match/logic";
import type { GameContext, RunContext } from "@/shell/contract";
import { seededRandom } from "@/shell/rng";

class LoadedImage {
  onload: (() => void) | null = null;
  onerror: (() => void) | null = null;
  private value = "";

  set src(value: string) {
    this.value = value;
    queueMicrotask(() => this.onload?.());
  }

  get src() {
    return this.value;
  }
}

function makeRun(seed: string): RunContext {
  return {
    mode: "practice",
    attemptId: null,
    seed,
    random: seededRandom(seed),
    signal: new AbortController().signal,
  };
}

describe("Bias Match DOM module", () => {
  beforeEach(() => {
    vi.stubGlobal("Image", LoadedImage);
  });

  afterEach(() => {
    vi.unstubAllGlobals();
    document.body.replaceChildren();
  });

  async function mount() {
    const host = document.createElement("div");
    const root = document.createElement("div");
    host.appendChild(root);
    document.body.appendChild(host);
    const scores: number[] = [];
    const ends: string[] = [];
    const ctx = {
      host,
      surface: { kind: "dom", root },
      input: {},
      audio: { register: vi.fn(), play: vi.fn() },
      t: (key: string, vars?: Record<string, string | number>) =>
        vars ? `${key}:${JSON.stringify(vars)}` : key,
      report: {
        score: (score: number) => scores.push(score),
        end: (result?: { reason?: string }) =>
          ends.push(result?.reason ?? "missing"),
      },
    } as unknown as GameContext;
    const game = biasMatchDefinition.create(ctx);
    await game.init(new AbortController().signal);
    game.start(makeRun("bias-match-module"));
    return { game, root, scores, ends };
  }

  it("uses real buttons, gates the peek/pause, and reports a match", async () => {
    const { game, root, scores } = await mount();
    if (game.loop !== "shell") throw new Error("expected shell loop");
    const state = (game as unknown as { state: BiasMatchState }).state;
    const buttons = [
      ...root.querySelectorAll<HTMLButtonElement>("button[data-card-index]"),
    ];
    expect(buttons).toHaveLength(6);
    expect(buttons.every((button) => button.disabled)).toBe(true);
    expect(root.querySelector('[role="status"]')).not.toBeNull();

    game.update(LEVELS[0].peekMs);
    expect(buttons.every((button) => !button.disabled)).toBe(true);
    game.pause("system");
    expect(buttons.every((button) => button.disabled)).toBe(true);
    game.resume();

    const firstIndex = 0;
    const secondIndex = state.cards.findIndex(
      (card, index) =>
        index !== firstIndex && card.face === state.cards[0].face,
    );
    buttons[firstIndex].click();
    buttons[secondIndex].click();
    game.update(320);
    expect(state.cards[firstIndex].status).toBe("matched");
    expect(scores.at(-1)).toBeGreaterThan(0);
    expect(
      (game as unknown as { refs: { score: HTMLElement } }).refs.score
        .textContent,
    ).toBe(String(state.score));
    game.destroy();
    expect(root.children).toHaveLength(0);
  });

  it("five real mismatches end once, and Play Again starts a clean run", async () => {
    const { game, root, scores, ends } = await mount();
    if (game.loop !== "shell") throw new Error("expected shell loop");
    const state = (game as unknown as { state: BiasMatchState }).state;
    game.update(LEVELS[0].peekMs);
    const firstIndex = 0;
    const secondIndex = state.cards.findIndex(
      (card) => card.face !== state.cards[firstIndex].face,
    );
    for (let miss = 0; miss < 5; miss += 1) {
      root
        .querySelector<HTMLButtonElement>(
          `button[data-card-index="${firstIndex}"]`,
        )!
        .click();
      root
        .querySelector<HTMLButtonElement>(
          `button[data-card-index="${secondIndex}"]`,
        )!
        .click();
      game.update(750);
    }
    expect(ends).toEqual(["lost"]);
    expect(state.lives).toBe(0);
    expect(
      (game as unknown as { toastRemainingMs: number }).toastRemainingMs,
    ).toBe(0);

    game.update(5000);
    expect(ends).toEqual(["lost"]);
    game.start(makeRun("bias-match-module-retry"));
    expect(scores.at(-1)).toBe(0);
    expect((game as unknown as { state: BiasMatchState }).state.level).toBe(1);
    expect(root.querySelector('p[role="status"]')?.textContent).toBe("");
    game.destroy();
  });

  it("clears all five boards through real card buttons and reaches the win", async () => {
    const { game, root, ends } = await mount();
    if (game.loop !== "shell") throw new Error("expected shell loop");

    for (let level = 1; level <= LEVELS.length; level += 1) {
      const state = (game as unknown as { state: BiasMatchState }).state;
      game.update(LEVELS[level - 1].peekMs);
      const pairStarts = new Map<number, number>();
      const pairs: [number, number][] = [];
      state.cards.forEach((card, index) => {
        const first = pairStarts.get(card.face);
        if (first === undefined) pairStarts.set(card.face, index);
        else pairs.push([first, index]);
      });
      for (const [first, second] of pairs) {
        root
          .querySelector<HTMLButtonElement>(
            `button[data-card-index="${first}"]`,
          )!
          .click();
        root
          .querySelector<HTMLButtonElement>(
            `button[data-card-index="${second}"]`,
          )!
          .click();
        game.update(320);
      }
      if (level < LEVELS.length) {
        expect(state.phase).toBe("transition");
        root.querySelector<HTMLButtonElement>("button[data-continue]")!.click();
      }
    }

    expect(ends).toEqual(["completed"]);
    expect((game as unknown as { state: BiasMatchState }).state.phase).toBe(
      "won",
    );
    expect(root.textContent).toContain("game.bias-match.winTitle");
    game.destroy();
  });
});
