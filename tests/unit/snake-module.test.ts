/**
 * Snake MODULE-level conformance — the real SnakeGame driven through the
 * frozen contract and a real InputBus, not the pure core.
 *
 * Restored and re-pointed at Snake Freebies (M2.5 review P1): the port
 * deleted the original suite, leaving a keyboard-only e2e smoke as the
 * only runtime-contract evidence. Rule vectors in snake-rules.test.ts
 * cover the core; these cover what only the module can get wrong —
 * repeated start(), gesture decoding and its timing, arming, pointer
 * isolation, pause/cancel cleanup, end-at-most-once, and teardown.
 */

import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import type { GameContext, RunContext } from "@/shell/contract";
import { createRecordingAudio } from "../fixtures/recording-audio";
import { createInputBus } from "@/shell/input";
import { seededRandom } from "@/shell/rng";
import { LeakTracker } from "@/shell/conformance";
import { dpadRects, snakeDefinition } from "@/games/snake/module";
import { DESIGN_H } from "@/games/snake/render";
import * as snakeLogic from "@/games/snake/logic";
import * as snakeRender from "@/games/snake/render";

vi.mock("@/games/snake/logic", { spy: true });
vi.mock("@/games/snake/render", { spy: true });

/**
 * `init()` awaits 22 sprite loads, which never resolve in jsdom. Resolving
 * on a MICROtask (not setTimeout) keeps the LeakTracker's timer accounting
 * clean — the stub must not look like a pending timer the game left behind.
 */
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

/** A mounted game plus everything needed to drive and tear it down. */
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
      // `end` may legally be called with no result; record that distinctly
      // rather than letting it read as a normal reason.
      end: (e) => ends.push(e?.reason ?? "<no-result>"),
    },
  };
  const game = snakeDefinition.create(ctx);
  const pointer = (type: string, x: number, y: number, pointerId = 1): void => {
    canvas.dispatchEvent(
      new PointerEvent(type, {
        clientX: x,
        clientY: y,
        pointerId,
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
  return { game, canvas, audio, scores, ends, pointer, teardown };
}

const centerOf = (name: string) => {
  const r = dpadRects()[name];
  return { x: r.x + r.w / 2, y: r.y + r.h / 2 };
};

beforeEach(() => {
  vi.stubGlobal("Image", FakeImage);
  stubCanvas2d();
});

afterEach(() => {
  vi.restoreAllMocks();
  document.body.replaceChildren();
});

describe("snake module — input decoding", () => {
  it("a REJECTED first turn does not arm the run (M2.5 review P1)", async () => {
    const { game, ends, teardown } = mount();
    await game.init(new AbortController().signal);
    game.start(makeRun("arming"));
    if (game.loop !== "shell") throw new Error("expected a shell-loop game");

    // The snake faces right, so Left is a reversal the core refuses. It
    // must NOT unfreeze the simulation: arming here would send the snake
    // rightward on an input the player never asked for.
    window.dispatchEvent(
      new KeyboardEvent("keydown", { code: "ArrowLeft", bubbles: true }),
    );
    const before = vi.mocked(snakeLogic.step).mock.calls.length;
    for (let i = 0; i < 10; i++) game.update(200);
    expect(vi.mocked(snakeLogic.step).mock.calls.length).toBe(before);

    // A legal perpendicular turn does arm it.
    window.dispatchEvent(
      new KeyboardEvent("keydown", { code: "ArrowDown", bubbles: true }),
    );
    game.update(200);
    expect(vi.mocked(snakeLogic.step).mock.calls.length).toBeGreaterThan(
      before,
    );
    expect(ends).toEqual([]);
    teardown();
  });

  it("a swipe turns as soon as it crosses the threshold, not on release", async () => {
    const { game, pointer, teardown } = mount();
    await game.init(new AbortController().signal);
    game.start(makeRun("swipe-timing"));

    const spy = vi.mocked(snakeLogic.queueDirection);
    spy.mockClear();

    // Drag downward past SWIPE_MIN with the finger still down. At level
    // 3's 125 ms cadence, waiting for pointerup would cost several ticks.
    pointer("pointerdown", 40, 300);
    pointer("pointermove", 40, 310); // under threshold — nothing yet
    expect(spy).not.toHaveBeenCalled();
    pointer("pointermove", 40, 340); // crosses it
    expect(spy).toHaveBeenCalledTimes(1);
    expect(spy.mock.calls[0][1]).toEqual({ x: 0, y: 1 });

    // One drag yields ONE turn: continuing the same gesture (and lifting)
    // must not re-fire off the consumed origin.
    pointer("pointermove", 40, 380);
    pointer("pointerup", 40, 380);
    expect(spy).toHaveBeenCalledTimes(1);
    teardown();
  });

  it("a quick flick with no move past threshold still turns on release", async () => {
    const { game, pointer, teardown } = mount();
    await game.init(new AbortController().signal);
    game.start(makeRun("flick"));

    const spy = vi.mocked(snakeLogic.queueDirection);
    spy.mockClear();
    pointer("pointerdown", 200, 300);
    pointer("pointerup", 260, 300); // no intermediate move reported
    expect(spy).toHaveBeenCalledTimes(1);
    expect(spy.mock.calls[0][1]).toEqual({ x: 1, y: 0 });
    teardown();
  });

  it("a D-pad press turns on pointer DOWN and is not re-read as a swipe", async () => {
    const { game, pointer, teardown } = mount();
    await game.init(new AbortController().signal);
    game.start(makeRun("dpad"));

    const spy = vi.mocked(snakeLogic.queueDirection);
    spy.mockClear();
    const down = centerOf("down");
    pointer("pointerdown", down.x, down.y);
    expect(spy).toHaveBeenCalledTimes(1); // zero-latency: on down, not click
    expect(spy.mock.calls[0][1]).toEqual({ x: 0, y: 1 });

    // Lifting off the button must not decode as a swipe from its center.
    pointer("pointerup", down.x, down.y);
    expect(spy).toHaveBeenCalledTimes(1);
    teardown();
  });

  it("a cancelled gesture queues nothing and cannot leak into a later press", async () => {
    const { game, pointer, teardown } = mount();
    await game.init(new AbortController().signal);
    game.start(makeRun("cancel"));

    const spy = vi.mocked(snakeLogic.queueDirection);
    spy.mockClear();
    pointer("pointerdown", 300, 300);
    pointer("pointercancel", 300, 300);
    // A big travel after the cancel would decode as "left" if the origin
    // survived; the platform took the finger, so it was never a turn.
    pointer("pointerup", 100, 300);
    expect(spy).not.toHaveBeenCalled();
    teardown();
  });

  it("two fingers do not alias: a D-pad release cannot consume another's swipe", async () => {
    const { game, pointer, teardown } = mount();
    await game.init(new AbortController().signal);
    game.start(makeRun("multitouch"));

    const spy = vi.mocked(snakeLogic.queueDirection);
    spy.mockClear();

    // Finger 1 begins a swipe in free space; finger 2 taps the D-pad.
    pointer("pointerdown", 300, 200, 1);
    const up = centerOf("up");
    pointer("pointerdown", up.x, up.y, 2);
    expect(spy).toHaveBeenCalledTimes(1);
    expect(spy.mock.calls[0][1]).toEqual({ x: 0, y: -1 });

    // Finger 2 lifting must resolve NOTHING — with shared state it would
    // consume finger 1's origin and enqueue a spurious turn.
    pointer("pointerup", up.x, up.y, 2);
    expect(spy).toHaveBeenCalledTimes(1);

    // Finger 1's own gesture still works, keyed to its own origin.
    pointer("pointermove", 240, 200, 1);
    expect(spy).toHaveBeenCalledTimes(2);
    expect(spy.mock.calls[1][1]).toEqual({ x: -1, y: 0 });
    teardown();
  });

  it("pause() drops in-flight gestures and stops accepting input", async () => {
    const { game, pointer, teardown } = mount();
    await game.init(new AbortController().signal);
    game.start(makeRun("pause"));

    const spy = vi.mocked(snakeLogic.queueDirection);
    pointer("pointerdown", 200, 300);
    game.pause("hidden");
    spy.mockClear();
    pointer("pointermove", 200, 360);
    pointer("pointerup", 200, 360);
    expect(spy).not.toHaveBeenCalled();

    // Resuming must not resurrect the pre-pause origin.
    game.resume();
    pointer("pointerup", 200, 400);
    expect(spy).not.toHaveBeenCalled();
    teardown();
  });
});

describe("snake module — touch targets", () => {
  it("D-pad constants clear 44 CSS px at the canvas height 320×568 produced", () => {
    // The 320×568 worst case measured in review: the letterboxed canvas is
    // 298×531, so the scale is 531/640 — height-limited, NOT width. An
    // earlier 46 design px button became 38 CSS px here, with 15 px of
    // clearance under Down (inside a typical 34 px iOS inset).
    //
    // SCOPE: this pins the CONSTANTS against a captured canvas height, so
    // it cannot see a host-layout change that shrinks the real canvas
    // underneath them. tests/e2e/snake-touch-targets.spec.ts measures the
    // live bounding box at 320×568 and is what actually guards the thumb.
    const CAPTURED_CANVAS_H = 531;
    const scale = CAPTURED_CANVAS_H / DESIGN_H;
    const rects = dpadRects();
    for (const [name, r] of Object.entries(rects)) {
      expect(r.w * scale, `${name} width`).toBeGreaterThanOrEqual(44);
      expect(r.h * scale, `${name} height`).toBeGreaterThanOrEqual(44);
    }
    const bottomGap = (DESIGN_H - (rects.down.y + rects.down.h)) * scale;
    expect(bottomGap).toBeGreaterThanOrEqual(34);
  });

  it("D-pad stays inside the design box and clear of the arena", () => {
    const rects = dpadRects();
    for (const [name, r] of Object.entries(rects)) {
      expect(r.x, `${name} left`).toBeGreaterThanOrEqual(0);
      expect(r.x + r.w, `${name} right`).toBeLessThanOrEqual(360);
      expect(r.y + r.h, `${name} bottom`).toBeLessThanOrEqual(DESIGN_H);
    }
    // Arena occupies y ∈ [96, 408] at the fixed 13×13 grid.
    expect(rects.up.y).toBeGreaterThan(408);
  });
});

describe("snake module — terminal-loss hold (audit P1)", () => {
  it("a fatal loss holds ~300ms for the wash, then ends; Play Again inherits NO stale feedback", async () => {
    const { game, ends, teardown } = mount();
    await game.init(new AbortController().signal);
    if (game.loop !== "shell") throw new Error("expected shell loop");
    game.start(makeRun("hold"));

    const probe = game as unknown as {
      state: { status: string };
      hitFx: { flashMs: number; shakeMs: number };
    };
    // A death flash is live when the fatal transition lands.
    probe.hitFx.flashMs = 300;
    probe.state.status = "lost";
    game.update(50);
    expect(ends).toEqual([]); // held — the wash is painting
    game.update(300);
    expect(ends).toEqual(["lost"]); // released after the hold

    // Play Again: feedback must reset, not bleed into the new run.
    probe.hitFx.flashMs = 250;
    probe.hitFx.shakeMs = 250;
    game.start(makeRun("hold-2"));
    expect(probe.hitFx.flashMs).toBe(0);
    expect(probe.hitFx.shakeMs).toBe(0);
    teardown();
  });
});

describe("snake module — lifecycle", () => {
  it("wires deterministic gift and death callouts into the real renderer", async () => {
    const { game, pointer, teardown } = mount();
    await game.init(new AbortController().signal);
    game.start(makeRun("presentation-events"));
    if (game.loop !== "shell") throw new Error("expected a shell-loop game");

    const down = centerOf("down");
    pointer("pointerdown", down.x, down.y);
    // Establish the real score-0 baseline before simulating the first gift.
    game.update(0);

    vi.mocked(snakeLogic.step).mockImplementationOnce((state) => {
      state.score = 10;
      state.gifts = 1;
      return state.status;
    });
    game.update(200);
    game.render(0);
    expect(
      vi.mocked(snakeRender.renderSnake).mock.calls.at(-1)?.[5],
    ).toMatchObject({
      toast: "game.snake.toast.gift.0",
      toastOpacity: 1,
    });

    vi.mocked(snakeLogic.step).mockImplementationOnce((state) => {
      state.lives = 2;
      state.status = "dying";
      return state.status;
    });
    game.update(200);
    game.render(0);
    expect(
      vi.mocked(snakeRender.renderSnake).mock.calls.at(-1)?.[5],
    ).toMatchObject({
      toast: "game.snake.toast.ouch",
      toastOpacity: 1,
    });
    teardown();
  });

  it("repeated start() resets the run; end fires once; teardown is leak-free", async () => {
    const tracker = new LeakTracker();
    tracker.begin();
    const { game, audio, scores, ends, pointer, teardown } = mount();
    await game.init(new AbortController().signal);
    if (game.loop !== "shell") throw new Error("expected a shell-loop game");

    // Run 1: 3 lives, so drive into a wall repeatedly to exhaust them.
    game.start(makeRun("module-run-1"));
    expect(scores.at(-1)).toBe(0);

    // Frozen until armed.
    for (let i = 0; i < 5; i++) game.update(200);
    expect(ends).toEqual([]);

    window.dispatchEvent(
      new KeyboardEvent("keydown", { code: "ArrowUp", bubbles: true }),
    );
    for (let i = 0; i < 400 && ends.length === 0; i++) {
      game.update(120);
      game.render(0);
    }
    expect(ends).toEqual(["lost"]);
    expect(audio.plays).toContain("lose");
    expect(audio.registered).toContain("win");
    expect(audio.plays).not.toContain("win");

    // Further updates after the terminal state must not report end twice.
    for (let i = 0; i < 20; i++) game.update(200);
    expect(ends).toEqual(["lost"]);

    // Restart in place on the SAME instance.
    game.start(makeRun("module-run-2"));
    expect(scores.at(-1)).toBe(0);
    expect(ends).toEqual(["lost"]); // prior end not re-reported

    // D-pad routes through the real InputBus into the restarted run.
    const down = centerOf("down");
    pointer("pointerdown", down.x, down.y);
    game.update(200);
    game.render(0); // arena + HUD + D-pad draw without throwing
    game.update(200 * 3);
    expect(ends).toEqual(["lost"]); // still alive mid-board

    teardown();
    const report = tracker.end();
    expect(report.clean, JSON.stringify(report)).toBe(true);
  });
});
