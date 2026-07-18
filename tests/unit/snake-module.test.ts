/**
 * Snake MODULE-level lifecycle (M2 review P2): repeated start() on the
 * same initialized instance, D-pad input routing, and leak-free teardown —
 * the real SnakeGame through the contract, not just pure state.
 */

import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import type { GameContext, RunContext } from "@/shell/contract";
import { createAudioBus } from "@/shell/audio";
import { createInputBus } from "@/shell/input";
import { seededRandom } from "@/shell/rng";
import { LeakTracker } from "@/shell/conformance";
import { snakeDefinition } from "@/games/snake/module";
import { CONTROL_ZONES } from "@/games/snake/controls";
import * as snakeLogic from "@/games/snake/logic";

vi.mock("@/games/snake/logic", { spy: true });

function stubCanvas2d(): void {
  const gradient = { addColorStop: () => undefined };
  vi.spyOn(HTMLCanvasElement.prototype, "getContext").mockImplementation(
    function (this: HTMLCanvasElement) {
      return new Proxy(
        {},
        {
          get: (target, prop) => {
            if (prop === "canvas") return this;
            if (prop === "createRadialGradient") return () => gradient;
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

beforeEach(() => {
  stubCanvas2d();
});

afterEach(() => {
  vi.restoreAllMocks();
  document.body.replaceChildren();
});

describe("snake module lifecycle", () => {
  it("stale swipe after cancel cannot overwrite a D-pad direction (P2 regression)", async () => {
    const host = document.createElement("div");
    document.body.appendChild(host);
    const canvas = document.createElement("canvas");
    host.appendChild(canvas);
    const input = createInputBus({
      target: canvas,
      toDesign: (x, y) => ({ x, y }),
    });
    const audio = createAudioBus();
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
      report: { score: () => undefined, end: () => undefined },
    };
    const game = snakeDefinition.create(ctx);
    await game.init(new AbortController().signal);
    game.start(makeRun("stale-gesture"));

    const spy = vi.mocked(snakeLogic.queueDirection);
    spy.mockClear();

    const dispatch = (type: string, x: number, y: number) =>
      canvas.dispatchEvent(
        new MouseEvent(type, { clientX: x, clientY: y, bubbles: true }),
      );

    // 1. Swipe begins in free space (origin far from the D-pad)...
    dispatch("pointerdown", 300, 620);
    // 2. ...and is CANCELLED by the platform.
    dispatch("pointercancel", 300, 620);
    // 3. D-pad "down" press, then finger lifts on the button. If the
    //    cancelled swipe origin survived, this up would decode as a
    //    "left"/"up" swipe and overwrite the queued direction.
    const down = CONTROL_ZONES.find((z) => z.dir === "down")!;
    dispatch("pointerdown", down.x + down.w / 2, down.y + down.h / 2);
    dispatch("pointerup", down.x + down.w / 2, down.y + down.h / 2);

    expect(spy).toHaveBeenCalledTimes(1);
    expect(spy).toHaveBeenCalledWith(expect.anything(), "down");

    // 4. A cancelled swipe with no D-pad press queues nothing at all.
    spy.mockClear();
    dispatch("pointerdown", 300, 620);
    dispatch("pointercancel", 300, 620);
    dispatch("pointerup", 100, 620); // would be a big "left" swipe if stale
    expect(spy).not.toHaveBeenCalled();

    game.destroy();
    input.destroy();
    audio.destroy();
    host.remove();
  });

  it("repeated start() resets the run; input + teardown are leak-free", async () => {
    const tracker = new LeakTracker();
    tracker.begin();

    const host = document.createElement("div");
    document.body.appendChild(host);
    const canvas = document.createElement("canvas");
    host.appendChild(canvas);
    const input = createInputBus({
      target: canvas,
      toDesign: (x, y) => ({ x, y }),
    });
    const audio = createAudioBus();
    const scores: number[] = [];
    let ends = 0;
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
        end: () => {
          ends += 1;
        },
      },
    };

    const game = snakeDefinition.create(ctx);
    await game.init(new AbortController().signal);

    // Run 1: drive to the wall (head x=9, grid 20 → 10 steps to exit).
    game.start(makeRun("module-run-1"));
    expect(scores.at(-1)).toBe(0);
    if (game.loop === "shell") {
      for (let i = 0; i < 15; i++) game.update(140);
    }
    expect(ends).toBe(1);

    // Restart in place on the SAME instance (ended → running).
    game.start(makeRun("module-run-2"));
    expect(scores.at(-1)).toBe(0); // score reset reported

    // D-pad tap routes through the InputBus into the game.
    const down = CONTROL_ZONES.find((z) => z.dir === "down")!;
    canvas.dispatchEvent(
      new MouseEvent("pointerdown", {
        clientX: down.x + down.w / 2,
        clientY: down.y + down.h / 2,
        bubbles: true,
      }),
    );
    if (game.loop === "shell") {
      game.update(140); // apply the queued turn
      game.render(0); // renders board + controls without throwing
      game.update(140 * 3);
    }
    expect(ends).toBe(1); // still alive after turning down mid-board

    game.destroy();
    input.destroy();
    audio.destroy();
    host.remove();
    const report = tracker.end();
    expect(report.clean, JSON.stringify(report)).toBe(true);
  });
});
