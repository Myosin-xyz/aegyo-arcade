/** Real Comeback Climb module: touch zones, pause cleanup, terminal hold. */

import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import type { GameContext, InputBus, RunContext } from "@/shell/contract";
import { createInputBus } from "@/shell/input";
import { seededRandom } from "@/shell/rng";
import { createRecordingAudio } from "../fixtures/recording-audio";
import { jumperDefinition } from "@/games/jumper/module";
import {
  HORIZONTAL_MAX,
  type JumperInput,
  type JumperState,
} from "@/games/jumper/logic";

class FakeImage {
  naturalWidth = 120;
  naturalHeight = 120;
  onload: (() => void) | null = null;
  onerror: ((error: unknown) => void) | null = null;
  set src(_value: string) {
    queueMicrotask(() => this.onload?.());
  }
}

interface ModuleProbe {
  state: JumperState | null;
  input: JumperInput;
  terminalHoldMs: number;
}

function practiceRun(seed: string): RunContext {
  return {
    mode: "practice",
    attemptId: null,
    seed,
    random: seededRandom(seed),
    signal: new AbortController().signal,
  };
}

describe("Comeback Climb module", () => {
  let host: HTMLDivElement;
  let canvas: HTMLCanvasElement;
  let bus: InputBus;
  let ctx: GameContext;
  let ends: string[];

  beforeEach(() => {
    vi.stubGlobal("Image", FakeImage);
    host = document.createElement("div");
    canvas = document.createElement("canvas");
    host.appendChild(canvas);
    document.body.appendChild(host);
    bus = createInputBus({ target: canvas, toDesign: (x, y) => ({ x, y }) });
    ends = [];
    ctx = {
      host,
      surface: {
        kind: "canvas",
        canvas,
        context2d: {} as CanvasRenderingContext2D,
        designBox: { w: 360, h: 640 },
      },
      input: bus,
      audio: createRecordingAudio(),
      t: (key) => key,
      report: {
        score: () => undefined,
        end: (result) => ends.push(result?.reason ?? "missing"),
      },
    };
  });

  afterEach(() => {
    bus.destroy();
    host.remove();
    vi.unstubAllGlobals();
    document.body.replaceChildren();
  });

  function pointer(x: number): void {
    canvas.dispatchEvent(
      new PointerEvent("pointerdown", {
        clientX: x,
        clientY: 320,
        pointerId: 1,
        bubbles: true,
      }),
    );
  }

  function key(type: "keydown" | "keyup", code: string): void {
    window.dispatchEvent(new KeyboardEvent(type, { code, bubbles: true }));
  }

  it("routes invisible inner/outer thumb zones to small/large impulses", async () => {
    const game = jumperDefinition.create(ctx);
    await game.init(new AbortController().signal);
    game.start(practiceRun("thumb-zones"));
    const probe = game as unknown as ModuleProbe;

    pointer(160); // inner-left quarter
    expect(probe.state!.hero.vx).toBeCloseTo(-HORIZONTAL_MAX * 0.42);
    game.start(practiceRun("thumb-zones-reset"));
    pointer(20); // outer-left quarter
    expect(probe.state!.hero.vx).toBeCloseTo(-HORIZONTAL_MAX * 0.9);
    game.start(practiceRun("thumb-zones-right"));
    pointer(340); // outer-right quarter
    expect(probe.state!.hero.vx).toBeCloseTo(HORIZONTAL_MAX * 0.9);
    game.destroy();
  });

  it("clears held keyboard input across pause and restart", async () => {
    const game = jumperDefinition.create(ctx);
    await game.init(new AbortController().signal);
    game.start(practiceRun("pause"));
    const probe = game as unknown as ModuleProbe;
    key("keydown", "ArrowRight");
    expect(probe.input.right).toBe(true);
    bus.setEnabled(false);
    game.pause("blur");
    expect(probe.input.right).toBe(false);
    key("keyup", "ArrowRight"); // discarded while disabled
    bus.setEnabled(true);
    game.resume();
    expect(probe.input.right).toBe(false);
    game.start(practiceRun("restart"));
    expect(probe.input).toEqual({ left: false, right: false });
    game.destroy();
  });

  it("holds a fatal fall for the red feedback, then ends exactly once", async () => {
    const game = jumperDefinition.create(ctx);
    await game.init(new AbortController().signal);
    game.start(practiceRun("terminal"));
    const probe = game as unknown as ModuleProbe;
    probe.state!.lives = 1;
    probe.state!.platforms = [];
    probe.state!.drones = [];
    probe.state!.pickups = [];
    probe.state!.notes = [];
    probe.state!.generatedY = 2000;
    probe.state!.cameraY = 0;
    probe.state!.hero.y = -50;
    probe.state!.hero.vy = 0;

    if (game.loop !== "shell") throw new Error("jumper must be shell-loop");
    game.update(17);
    expect(probe.state!.status).toBe("lost");
    expect(probe.terminalHoldMs).toBe(300);
    expect(ends).toEqual([]);
    game.update(150);
    expect(ends).toEqual([]);
    game.update(151);
    expect(ends).toEqual(["lost"]);
    game.update(1000);
    expect(ends).toEqual(["lost"]);
    game.destroy();
    game.destroy();
  });
});
