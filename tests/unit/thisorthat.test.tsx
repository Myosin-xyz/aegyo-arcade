/**
 * Fan Day: This or That — prototype acceptance vectors (M4.5,
 * docs/games/this-or-that.md): selection tallies, tie priority,
 * deterministic results, double-tap single-advance, pause disabling
 * both input paths, restart clearing every choice, and leak-free
 * teardown. Logic vectors are pure; module vectors run the REAL DOM
 * module with a real InputBus.
 */

import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import type { GameContext, InputBus, RunContext } from "@/shell/contract";
import { createInputBus } from "@/shell/input";
import { t } from "@/i18n/t";
import { seededRandom } from "@/shell/rng";
import { createRecordingAudio } from "../fixtures/recording-audio";
import { thisorthatDefinition } from "@/games/thisorthat/module";
import { CHOICE_LOCK_MS } from "@/games/thisorthat/module";
import {
  TOTAL_ROUNDS,
  choose,
  createTotState,
  resultVibe,
  tallyVibes,
  type TotSide,
} from "@/games/thisorthat/logic";
import { TOT_ROUNDS, VIBE_PRIORITY } from "@/games/thisorthat/content";

describe("thisorthat — logic vectors", () => {
  it("content shape: 9 rounds, every option carries 1–2 vibe tags", () => {
    expect(TOT_ROUNDS).toHaveLength(9);
    for (const round of TOT_ROUNDS) {
      for (const option of [round.a, round.b]) {
        expect(option.tags.length).toBeGreaterThanOrEqual(1);
        expect(option.tags.length).toBeLessThanOrEqual(2);
      }
    }
  });

  it("selection tallies count every chosen option's tags", () => {
    const allA = Array<TotSide>(TOTAL_ROUNDS).fill(0);
    const tally = tallyVibes(allA);
    const expected = TOT_ROUNDS.flatMap((round) => [...round.a.tags]);
    const total = Object.values(tally).reduce((sum, n) => sum + n, 0);
    expect(total).toBe(expected.length);
  });

  it("identical choices ALWAYS produce the identical result", () => {
    const picks: TotSide[] = [0, 1, 0, 1, 0, 1, 0, 1, 0];
    expect(resultVibe(picks)).toBe(resultVibe([...picks]));
  });

  it("ties resolve by fixed VIBE_PRIORITY order", () => {
    // No choices at all → all-zero tally → the first priority wins.
    expect(resultVibe([])).toBe(VIBE_PRIORITY[0]);
  });

  it("EXHAUSTIVE: all 512 choice vectors — every vibe reachable, distribution snapshot (M4.5 review P2)", () => {
    const wins: Record<string, number> = {
      cozy: 0,
      creative: 0,
      adventurous: 0,
      energetic: 0,
      social: 0,
    };
    for (let mask = 0; mask < 1 << TOTAL_ROUNDS; mask++) {
      const picks = Array.from(
        { length: TOTAL_ROUNDS },
        (_, i) => ((mask >> i) & 1) as TotSide,
      );
      wins[resultVibe(picks)] += 1;
    }
    for (const vibe of VIBE_PRIORITY) {
      expect(wins[vibe], vibe).toBeGreaterThan(0); // reachable
    }
    // Snapshot of the tuned distribution (13.9%–25.0% spread). A tag or
    // priority change that reskews the quiz shows up here on purpose.
    expect(wins).toEqual({
      cozy: 96,
      creative: 99,
      adventurous: 128,
      energetic: 71,
      social: 118,
    });
  });

  it("choose() fills 9 rounds then flips to result and refuses further input", () => {
    const state = createTotState();
    for (let i = 0; i < TOTAL_ROUNDS; i++) {
      expect(state.status).toBe("playing");
      expect(choose(state, 1)).toBe(true);
    }
    expect(state.status).toBe("result");
    expect(state.choices).toHaveLength(TOTAL_ROUNDS);
    expect(choose(state, 0)).toBe(false);
    expect(state.choices).toHaveLength(TOTAL_ROUNDS);
  });
});

describe("thisorthat — module (real DOM + InputBus)", () => {
  let host: HTMLDivElement;
  let root: HTMLDivElement;
  let bus: InputBus;
  let ctx: GameContext;
  let clock: number;
  let endReasons: string[];

  function practiceRun(): RunContext {
    return {
      mode: "practice",
      attemptId: null,
      seed: "tot",
      random: seededRandom("tot"),
      signal: new AbortController().signal,
    };
  }

  beforeEach(() => {
    clock = 100_000;
    endReasons = [];
    vi.spyOn(performance, "now").mockImplementation(() => clock);
    host = document.createElement("div");
    document.body.appendChild(host);
    root = document.createElement("div");
    host.appendChild(root);
    bus = createInputBus({
      target: root,
      capturePointer: false,
      toDesign: (x, y) => ({ x, y }),
    });
    ctx = {
      host,
      surface: { kind: "dom", root },
      input: bus,
      audio: createRecordingAudio(),
      t,
      report: {
        score: () => undefined,
        end: (payload) => {
          endReasons.push(payload?.reason ?? "missing-reason");
        },
      },
    };
  });

  afterEach(() => {
    bus.destroy();
    host.remove();
    vi.restoreAllMocks();
    document.body.replaceChildren();
  });

  function card(side: 0 | 1): HTMLButtonElement {
    return root.querySelector(
      `[data-testid="tot-card-${side}"]`,
    ) as HTMLButtonElement;
  }
  const progress = () =>
    root.querySelector('[data-testid="tot-progress"]')!.textContent;
  const result = () =>
    root.querySelector('[data-testid="tot-result"]') as HTMLElement;

  function mounted() {
    const game = thisorthatDefinition.create(ctx);
    game.init(new AbortController().signal);
    game.start(practiceRun());
    return game;
  }

  it("a tap advances exactly once — double taps cannot skip a round", () => {
    const game = mounted();
    expect(progress()).toBe("1 / 9");
    card(0).click();
    card(0).click(); // same-instant double tap
    expect(progress()).toBe("2 / 9"); // advanced ONCE
    clock += CHOICE_LOCK_MS + 10;
    card(1).click();
    expect(progress()).toBe("3 / 9");
    game.destroy();
  });

  it("a first choice at performance.now() ≈ 0 is accepted (M4.5 review P3: 0 is a valid time, not a sentinel)", () => {
    clock = 10; // page younger than the 300ms lock window
    const game = mounted();
    card(0).click();
    expect(progress()).toBe("2 / 9");
    game.destroy();
  });

  it("pause disables cards AND keyboard; resume restores both", () => {
    const game = mounted();
    game.pause("blur");
    expect(card(0).disabled).toBe(true);
    card(0).click();
    window.dispatchEvent(
      new KeyboardEvent("keydown", { code: "ArrowLeft", bubbles: true }),
    );
    expect(progress()).toBe("1 / 9"); // nothing advanced
    game.resume();
    expect(card(0).disabled).toBe(false);
    clock += CHOICE_LOCK_MS + 10;
    window.dispatchEvent(
      new KeyboardEvent("keydown", { code: "ArrowRight", bubbles: true }),
    );
    expect(progress()).toBe("2 / 9"); // keyboard works alongside touch
    game.destroy();
  });

  it("nine picks reach the result, report end('completed') EXACTLY ONCE, and a host restart clears every choice", () => {
    const game = mounted();
    for (let i = 0; i < TOTAL_ROUNDS; i++) {
      clock += CHOICE_LOCK_MS + 10;
      card((i % 2) as 0 | 1).click();
    }
    expect(result().style.display).not.toBe("none");
    expect(result().querySelectorAll("li")).toHaveLength(TOTAL_ROUNDS);
    expect(progress()).toBe("9 / 9");
    // Frozen lifecycle: terminal reported once (M4.5 review P1).
    expect(endReasons).toEqual(["completed"]);
    clock += CHOICE_LOCK_MS + 10;
    card(0).click(); // cards are hidden/result state — refuses input
    expect(endReasons).toEqual(["completed"]);

    // A11y (M4.5 review P2): the live status is the CONCISE summary —
    // the full result container is an ordinary element.
    expect(result().getAttribute("role")).toBeNull();
    const summary = root.querySelector('[data-testid="tot-summary"]')!;
    expect(summary.getAttribute("role")).toBe("status");
    expect(summary.querySelector("button")).toBeNull();
    const expectedVibe = resultVibe(
      Array.from({ length: TOTAL_ROUNDS }, (_, i) => (i % 2) as TotSide),
    );
    expect(summary.textContent).toContain(
      t(`game.thisorthat.vibe.${expectedVibe}.name`),
    ); // concise: title + vibe name — not the recap

    // Host-owned restart = a fresh start(run) call (fresh RunContext).
    game.start(practiceRun());
    expect(result().style.display).toBe("none");
    expect(progress()).toBe("1 / 9");
    card(0).click(); // lastChoiceAt reset with the run
    expect(progress()).toBe("2 / 9");
    game.destroy();
  });

  it("destroy leaves no DOM behind and late input is inert", () => {
    const game = mounted();
    game.destroy();
    expect(root.childNodes).toHaveLength(0);
    expect(() =>
      window.dispatchEvent(
        new KeyboardEvent("keydown", { code: "ArrowLeft", bubbles: true }),
      ),
    ).not.toThrow();
    game.destroy(); // idempotent
    expect(root.childNodes).toHaveLength(0);
  });
});
