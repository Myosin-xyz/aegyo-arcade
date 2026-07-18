/**
 * REAL Freebie module lifecycle in jsdom (M2.5 review P1/P2): the exact
 * held-key → pause → discarded keyup → resume sequence, module-level
 * input-moves-the-game proof, restart-in-place, end-at-most-once, and
 * idempotent destroy. Image loading is stubbed; the module, logic, and
 * InputBus are the real production code.
 */

import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import type { GameContext, InputBus, RunContext } from "@/shell/contract";
import {
  createRecordingAudio,
  type RecordingAudio,
} from "../fixtures/recording-audio";
import { createInputBus } from "@/shell/input";
import { seededRandom } from "@/shell/rng";
import { freebieDefinition } from "@/games/freebie/module";
import {
  DESIGN_H,
  DESIGN_W,
  type FreebieInput,
  type FreebieState,
} from "@/games/freebie/logic";

class FakeImage {
  naturalWidth = 130;
  naturalHeight = 160;
  onload: (() => void) | null = null;
  onerror: ((e: unknown) => void) | null = null;
  set src(_value: string) {
    setTimeout(() => this.onload?.(), 0);
  }
}

/** Test-only window into the module's private run state. */
interface ModuleProbe {
  state: FreebieState | null;
  input: FreebieInput;
}

function run(mode: "practice", seed: string): RunContext {
  return {
    mode,
    attemptId: null,
    seed,
    random: seededRandom(seed),
    signal: new AbortController().signal,
  };
}

describe("freebie module — real lifecycle", () => {
  let host: HTMLDivElement;
  let canvas: HTMLCanvasElement;
  let bus: InputBus;
  let endReasons: string[];
  let audio: RecordingAudio;
  let ctx: GameContext;

  beforeEach(() => {
    vi.stubGlobal("Image", FakeImage);
    host = document.createElement("div");
    document.body.appendChild(host);
    canvas = document.createElement("canvas");
    host.appendChild(canvas);
    bus = createInputBus({ target: canvas, toDesign: (x, y) => ({ x, y }) });
    endReasons = [];
    audio = createRecordingAudio();
    ctx = {
      host,
      surface: {
        kind: "canvas",
        canvas,
        // render() is never called in these lifecycle tests.
        context2d: {} as CanvasRenderingContext2D,
        designBox: { w: DESIGN_W, h: DESIGN_H },
      },
      input: bus,
      audio,
      t: (key) => key,
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
    vi.unstubAllGlobals();
    document.body.replaceChildren();
  });

  function key(action: "keydown" | "keyup", code: string): void {
    window.dispatchEvent(new KeyboardEvent(action, { code, bubbles: true }));
  }

  it("held key → pause (bus disabled) → discarded keyup → resume: catcher does NOT keep gliding", async () => {
    const game = freebieDefinition.create(ctx);
    await game.init(new AbortController().signal);
    game.start(run("practice", "pause-seq"));
    const probe = game as unknown as ModuleProbe;
    const startX = probe.state!.catcher.x;

    // Module-level input proof: a held ArrowLeft MOVES the catcher.
    key("keydown", "ArrowLeft");
    if (game.loop !== "shell") throw new Error("freebie must be shell-loop");
    game.update(500);
    expect(probe.state!.catcher.x).toBeLessThan(startX);

    // The exact review sequence: host disables the bus, pauses, the
    // keyup lands while disabled (discarded), then resume.
    bus.setEnabled(false);
    game.pause("blur");
    expect(probe.input.left).toBe(false); // P1: flag cleared on pause
    key("keyup", "ArrowLeft"); // discarded — bus is disabled
    bus.setEnabled(true);
    game.resume();

    // Residual velocity decays via friction; the catcher must SETTLE,
    // not glide indefinitely as if the key were still held.
    game.update(2000);
    const settled = probe.state!.catcher.x;
    game.update(1000);
    expect(Math.abs(probe.state!.catcher.x - settled)).toBeLessThan(0.5);

    game.destroy();
  });

  it("restart-in-place resets the run; end fires at most once; destroy is idempotent", async () => {
    const game = freebieDefinition.create(ctx);
    await game.init(new AbortController().signal);
    if (game.loop !== "shell") throw new Error("freebie must be shell-loop");
    game.start(run("practice", "first"));
    const probe = game as unknown as ModuleProbe;
    game.update(1000);
    expect(probe.state!.time).toBeGreaterThan(0);

    // Restart on the same initialized instance → fresh state.
    game.start(run("practice", "second"));
    expect(probe.state!.score).toBe(0);
    expect(probe.state!.level).toBe(1);
    expect(probe.state!.time).toBe(0);
    expect(probe.state!.catcher.x).toBe(DESIGN_W / 2);

    // A real catch fires the catch SFX (M4 review P1: behavioral).
    probe.state!.freebies = [
      {
        tier: 0,
        x: probe.state!.catcher.x,
        y: 593.8, // inside the catch window
        vy: 0,
        size: 46,
        rot: 0,
        rotSpeed: 0,
        wobble: 0,
      },
    ];
    game.update(17);
    expect(audio.plays).toContain("catch");

    // Force the terminal path: last life, one freebie past the floor.
    probe.state!.lives = 1;
    probe.state!.queue = [];
    probe.state!.freebies = [
      {
        tier: 0,
        x: 60,
        y: DESIGN_H + 30,
        vy: 0,
        size: 46,
        rot: 0,
        rotSpeed: 0,
        wobble: 0,
      },
    ];
    game.update(50);
    expect(endReasons).toEqual(["lost"]);
    expect(audio.plays).toContain("lose");

    // Ended: further updates never re-report.
    game.update(1000);
    expect(endReasons).toEqual(["lost"]);

    // Destroy twice — idempotent; late input must not crash or mutate.
    game.destroy();
    game.destroy();
    key("keydown", "ArrowRight");
    expect(endReasons).toEqual(["lost"]);
  });
});
