/**
 * Bias Flap MODULE-level conformance — the real FlappyGame through the
 * frozen contract and a real InputBus. Covers what only the module can
 * get wrong: flap routing (tap vs the leave zone), the cash-out flow
 * ending the run with reason "quit", crash NOT ending the run, restart
 * on the same instance, end-at-most-once, and leak-free teardown.
 */

import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import type { GameContext, RunContext } from "@/shell/contract";
import { createRecordingAudio } from "../fixtures/recording-audio";
import { createInputBus } from "@/shell/input";
import { seededRandom } from "@/shell/rng";
import { LeakTracker } from "@/shell/conformance";
import { flappyDefinition } from "@/games/flappy/module";
import { leaveRect, quitConfirmRects } from "@/games/flappy/render";
import * as flappyLogic from "@/games/flappy/logic";

vi.mock("@/games/flappy/logic", { spy: true });

/** init() awaits 5 sprite loads; resolve on a microtask (no timers the
 * LeakTracker would flag). */
class FakeImage {
  naturalWidth = 24;
  naturalHeight = 24;
  onload: (() => void) | null = null;
  onerror: ((e: unknown) => void) | null = null;
  set src(_value: string) {
    queueMicrotask(() => this.onload?.());
  }
}

function stubCanvas2d(): void {
  vi.spyOn(HTMLCanvasElement.prototype, "getContext").mockImplementation(
    function (this: HTMLCanvasElement) {
      return new Proxy(
        {},
        {
          get: (target, prop) => {
            if (prop === "canvas") return this;
            const value = (target as Record<PropertyKey, unknown>)[prop];
            return value !== undefined ? value : () => undefined;
          },
          set: (target, prop, value) => {
            (target as Record<PropertyKey, unknown>)[prop] = value;
            return true;
          },
        },
      ) as unknown as CanvasRenderingContext2D;
    } as never,
  );
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

function mount() {
  const host = document.createElement("div");
  document.body.appendChild(host);
  const canvas = document.createElement("canvas");
  host.appendChild(canvas);
  const input = createInputBus({
    target: canvas,
    toDesign: (x, y) => ({ x, y }),
  });
  const audio = createRecordingAudio();
  const scores: number[] = [];
  const ends: string[] = [];
  const ctx: GameContext = {
    host,
    surface: {
      kind: "canvas",
      canvas,
      context2d: canvas.getContext("2d") as CanvasRenderingContext2D,
      designBox: { w: 360, h: 640 },
    },
    input,
    audio,
    t: (key) => key,
    report: {
      score: (n) => scores.push(n),
      end: (e) => ends.push(e?.reason ?? "<no-result>"),
    },
  };
  const game = flappyDefinition.create(ctx);
  const pointer = (type: string, x: number, y: number): void => {
    canvas.dispatchEvent(
      new PointerEvent(type, {
        clientX: x,
        clientY: y,
        pointerId: 1,
        bubbles: true,
      }),
    );
  };
  const teardown = () => {
    game.destroy();
    input.destroy();
    audio.destroy();
    host.remove();
  };
  return { game, audio, scores, ends, pointer, teardown };
}

const center = (r: { x: number; y: number; w: number; h: number }) => ({
  x: r.x + r.w / 2,
  y: r.y + r.h / 2,
});

beforeEach(() => {
  vi.stubGlobal("Image", FakeImage);
  stubCanvas2d();
});

afterEach(() => {
  vi.restoreAllMocks();
  document.body.replaceChildren();
});

describe("bias flap module — input routing", () => {
  it("tap = flap; ⏹ zone = confirm; confirm zones resolve keep/leave", async () => {
    const { game, ends, pointer, teardown } = mount();
    await game.init(new AbortController().signal);
    game.start(makeRun("routing"));

    const flapSpy = vi.mocked(flappyLogic.flap);
    flapSpy.mockClear();
    pointer("pointerdown", 60, 400); // free space
    expect(flapSpy).toHaveBeenCalledTimes(1);

    const leave = center(leaveRect());
    pointer("pointerdown", leave.x, leave.y);
    expect(flapSpy).toHaveBeenCalledTimes(1); // NOT a flap
    // Keep-flying returns to play, no end reported.
    const zones = quitConfirmRects();
    const keep = center(zones.keep);
    pointer("pointerdown", keep.x, keep.y);
    expect(ends).toEqual([]);
    // Still playable after keeping.
    pointer("pointerdown", 60, 400);
    expect(flapSpy).toHaveBeenCalledTimes(2);
    teardown();
  });

  it("cash-out ends the run ONCE with reason 'quit'; later input is inert", async () => {
    const { game, audio, ends, pointer, teardown } = mount();
    await game.init(new AbortController().signal);
    if (game.loop !== "shell") throw new Error("expected shell loop");
    game.start(makeRun("cashout"));

    pointer("pointerdown", 60, 400); // arm + flap
    game.update(50);
    const leave = center(leaveRect());
    pointer("pointerdown", leave.x, leave.y);
    const leaveZone = center(quitConfirmRects().leave);
    pointer("pointerdown", leaveZone.x, leaveZone.y);
    expect(ends).toEqual(["quit"]);
    expect(audio.plays).toContain("cashout");

    // Terminal: more taps and time change nothing, end fires once.
    pointer("pointerdown", 60, 400);
    pointer("pointerdown", leaveZone.x, leaveZone.y);
    for (let i = 0; i < 10; i++) game.update(100);
    expect(ends).toEqual(["quit"]);
    teardown();
  });

  it("a tap OUTSIDE the confirm zones neither exits nor resumes (no accidental cash-out)", async () => {
    const { game, ends, pointer, teardown } = mount();
    await game.init(new AbortController().signal);
    game.start(makeRun("outside"));
    const quitSpy = vi.mocked(flappyLogic.cashOut);
    const resumeSpy = vi.mocked(flappyLogic.keepFlying);
    const leave = center(leaveRect());
    pointer("pointerdown", leave.x, leave.y); // open confirm
    quitSpy.mockClear(); // spy counts persist across tests in this file
    resumeSpy.mockClear();
    pointer("pointerdown", 10, 10); // outside both zones
    expect(ends).toEqual([]);
    expect(quitSpy).not.toHaveBeenCalled();
    expect(resumeSpy).not.toHaveBeenCalled();
    teardown();
  });
});

describe("bias flap module — keyboard routes (review P2)", () => {
  const key = (code: string) =>
    window.dispatchEvent(new KeyboardEvent("keydown", { code, bubbles: true }));

  it("flap keys advance a level break (keyboard players are not stranded)", async () => {
    const { game, teardown } = mount();
    await game.init(new AbortController().signal);
    game.start(makeRun("kb-break"));
    const contSpy = vi.mocked(flappyLogic.continueFromLevelBreak);
    contSpy.mockClear();
    key("Space"); // waiting → flying (a flap), not a continue
    expect(contSpy).not.toHaveBeenCalled();
    // Force a level break and continue by keyboard.
    const probe = game as unknown as {
      state: { status: string };
    };
    probe.state.status = "levelBreak";
    key("Space");
    expect(contSpy).toHaveBeenCalledTimes(1);
    teardown();
  });

  it("Escape opens the confirm, Escape again keeps flying, Enter cashes out with 'quit'", async () => {
    const { game, ends, audio, teardown } = mount();
    await game.init(new AbortController().signal);
    game.start(makeRun("kb-cashout"));
    key("Space"); // arm
    key("Escape");
    const probe = game as unknown as { state: { status: string } };
    expect(probe.state.status).toBe("quitConfirm");
    key("Escape"); // = keep flying
    expect(probe.state.status).toBe("flying");
    key("Escape");
    key("Enter");
    expect(probe.state.status).toBe("cashedOut");
    expect(ends).toEqual(["quit"]);
    expect(audio.plays).toContain("cashout");
    // End fires once even if Enter is mashed.
    key("Enter");
    expect(ends).toEqual(["quit"]);
    teardown();
  });
});

describe("bias flap module — feedback reset (audit P1)", () => {
  it("Play Again inherits no stale flash/shake", async () => {
    const { game, teardown } = mount();
    await game.init(new AbortController().signal);
    game.start(makeRun("fx-1"));
    const probe = game as unknown as {
      hitFx: { flashMs: number; shakeMs: number };
    };
    probe.hitFx.flashMs = 250;
    probe.hitFx.shakeMs = 250;
    game.start(makeRun("fx-2"));
    expect(probe.hitFx.flashMs).toBe(0);
    expect(probe.hitFx.shakeMs).toBe(0);
    teardown();
  });
});

describe("bias flap module — lifecycle", () => {
  it("crash does NOT end the run; restart works; teardown is leak-free", async () => {
    const tracker = new LeakTracker();
    tracker.begin();
    const { game, audio, scores, ends, pointer, teardown } = mount();
    await game.init(new AbortController().signal);
    if (game.loop !== "shell") throw new Error("expected shell loop");

    game.start(makeRun("crash-not-end"));
    expect(scores.at(-1)).toBe(0);
    pointer("pointerdown", 60, 400); // arm
    // Let gravity slam the hero into the floor — repeatedly, across
    // several crash beats. The run must never end by crashing.
    for (let i = 0; i < 600; i++) {
      game.update(50);
      game.render(0);
    }
    expect(ends).toEqual([]);
    expect(audio.plays).toContain("crash");

    // Restart in place on the SAME instance.
    game.start(makeRun("second"));
    expect(scores.at(-1)).toBe(0);
    pointer("pointerdown", 60, 400);
    game.update(50);
    expect(ends).toEqual([]);

    teardown();
    const report = tracker.end();
    expect(report.clean, JSON.stringify(report)).toBe(true);
  });
});
