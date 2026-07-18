/**
 * Hangman MODULE-level test — the dom-surface contract compatibility
 * check (ADR 0001): real buttons, delegated click, keyboard via InputBus,
 * aria-live status, pause gating on BOTH input paths, repeated start,
 * and leak-free teardown with zero mounted DOM after destroy.
 */

import { afterEach, describe, expect, it } from "vitest";
import type { GameContext, RunContext } from "@/shell/contract";
import { createAudioBus } from "@/shell/audio";
import { createInputBus } from "@/shell/input";
import { seededRandom } from "@/shell/rng";
import { LeakTracker } from "@/shell/conformance";
import { hangmanDefinition } from "@/games/hangman/module";

function makeRun(seed: string): RunContext {
  return {
    mode: "practice",
    attemptId: null,
    seed,
    random: seededRandom(seed),
    signal: new AbortController().signal,
  };
}

function createDomContext() {
  const host = document.createElement("div");
  document.body.appendChild(host);
  const root = document.createElement("div");
  host.appendChild(root);
  const input = createInputBus({
    target: root,
    toDesign: (x, y) => ({ x, y }),
  });
  const audio = createAudioBus();
  const ends: string[] = [];
  const scores: number[] = [];
  const ctx: GameContext = {
    host,
    surface: { kind: "dom", root },
    input,
    audio,
    t: (key, vars) => (vars ? `${key}:${JSON.stringify(vars)}` : key), // echo translator
    report: {
      score: (n) => scores.push(n),
      end: (r) => ends.push(r?.reason ?? "?"),
    },
  };
  return {
    ctx,
    root,
    input,
    ends,
    scores,
    cleanup: () => {
      input.destroy();
      audio.destroy();
      host.remove();
    },
  };
}

function clickLetter(root: HTMLElement, letter: string): void {
  const button = root.querySelector(
    `button[data-letter="${letter}"]`,
  ) as HTMLButtonElement;
  button.dispatchEvent(new MouseEvent("click", { bubbles: true }));
}

afterEach(() => {
  document.body.replaceChildren();
});

describe("hangman dom module", () => {
  it("renders real buttons, disables guessed letters, updates aria-live", async () => {
    const { ctx, root, cleanup } = createDomContext();
    const game = hangmanDefinition.create(ctx);
    await game.init(new AbortController().signal);
    game.start(makeRun("hangman-module-1"));

    const buttons = root.querySelectorAll("button[data-letter]");
    expect(buttons).toHaveLength(26);
    const status = root.querySelector('[role="status"]') as HTMLElement;
    expect(status.getAttribute("aria-live")).toBe("polite");

    const term = (game as unknown as { state: { term: string } }).state.term;
    const inWord = term[0];
    clickLetter(root, inWord);
    expect(status.textContent).toContain("correct");
    expect(
      (
        root.querySelector(
          `button[data-letter="${inWord}"]`,
        ) as HTMLButtonElement
      ).disabled,
    ).toBe(true);

    const notInWord = "ABCDEFGHIJKLMNOPQRSTUVWXYZ"
      .split("")
      .find((l) => !term.includes(l))!;
    clickLetter(root, notInWord);
    expect(status.textContent).toContain("wrong");

    game.destroy();
    cleanup();
  });

  it("PAUSE gates both the delegated click and the keyboard path", async () => {
    const { ctx, root, input, cleanup } = createDomContext();
    const game = hangmanDefinition.create(ctx);
    await game.init(new AbortController().signal);
    game.start(makeRun("hangman-module-2"));
    const state = (game as unknown as { state: { guessed: Set<string> } })
      .state;

    game.pause("system");
    input.setEnabled(false); // host does this in production

    // Every button is disabled AND the delegated handler refuses.
    const anyButton = root.querySelector(
      'button[data-letter="A"]',
    ) as HTMLButtonElement;
    expect(anyButton.disabled).toBe(true);
    anyButton.dispatchEvent(new MouseEvent("click", { bubbles: true }));
    // Physical keyboard while paused (bus disabled).
    window.dispatchEvent(new KeyboardEvent("keydown", { code: "KeyA" }));
    expect(state.guessed.size).toBe(0);

    input.setEnabled(true);
    game.resume();
    window.dispatchEvent(new KeyboardEvent("keydown", { code: "KeyA" }));
    expect(state.guessed.has("A")).toBe(true);

    game.destroy();
    cleanup();
  });

  it("solves via keyboard, reports score+end once, restarts, tears down clean", async () => {
    const tracker = new LeakTracker();
    tracker.begin();

    const { ctx, root, ends, scores, cleanup } = createDomContext();
    const game = hangmanDefinition.create(ctx);
    await game.init(new AbortController().signal);
    game.start(makeRun("hangman-module-3"));
    const term = (game as unknown as { state: { term: string } }).state.term;

    for (const letter of new Set(term.split(""))) {
      window.dispatchEvent(
        new KeyboardEvent("keydown", { code: `Key${letter}` }),
      );
    }
    expect(ends).toEqual(["completed"]);
    expect(scores.at(-1)).toBe(6); // clean solve = max lives
    // Extra input after the end is inert.
    clickLetter(root, "A");
    expect(ends).toEqual(["completed"]);

    // Restart in place on the SAME instance (dom-surface repeatable start).
    game.start(makeRun("hangman-module-3b"));
    expect(scores.at(-1)).toBe(0);
    expect(
      (root.querySelector('button[data-letter="A"]') as HTMLButtonElement)
        .disabled,
    ).toBe(false);

    game.destroy();
    // Zero mounted DOM after destroy (§6.1.3 conformance requirement).
    expect(root.children).toHaveLength(0);
    cleanup();
    const report = tracker.end();
    expect(report.clean, JSON.stringify(report)).toBe(true);
  });
});
