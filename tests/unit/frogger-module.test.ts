/**
 * REAL Frogger module lifecycle in jsdom (M3, mirrors the M2.5 pattern):
 * module-level input-moves proof, pause rejects edge-triggered moves,
 * restart-in-place, end-at-most-once, idempotent destroy. Image loading
 * is stubbed; module, logic, and InputBus are production code.
 */

import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import type { GameContext, InputBus, RunContext } from "@/shell/contract";
import {
  createRecordingAudio,
  type RecordingAudio,
} from "../fixtures/recording-audio";
import { createInputBus } from "@/shell/input";
import { seededRandom } from "@/shell/rng";
import { froggerDefinition } from "@/games/frogger/module";
import {
  DESIGN_H,
  DESIGN_W,
  HERO_X,
  START_ROW,
  type FroggerState,
} from "@/games/frogger/logic";

class FakeImage {
  naturalWidth = 100;
  naturalHeight = 100;
  onload: (() => void) | null = null;
  onerror: ((e: unknown) => void) | null = null;
  set src(_value: string) {
    setTimeout(() => this.onload?.(), 0);
  }
}

interface ModuleProbe {
  state: FroggerState | null;
}

function practice(seed: string): RunContext {
  return {
    mode: "practice",
    attemptId: null,
    seed,
    random: seededRandom(seed),
    signal: new AbortController().signal,
  };
}

describe("frogger module — real lifecycle", () => {
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
        context2d: {} as CanvasRenderingContext2D, // render() not exercised
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

  function key(code: string): void {
    window.dispatchEvent(new KeyboardEvent("keydown", { code, bubbles: true }));
  }

  it("keyboard moves the hero; pause rejects moves; resume accepts again", async () => {
    const game = froggerDefinition.create(ctx);
    await game.init(new AbortController().signal);
    game.start(practice("frog-pause"));
    const probe = game as unknown as ModuleProbe;
    expect(probe.state!.row).toBe(START_ROW);

    key("ArrowUp");
    expect(probe.state!.row).toBe(START_ROW - 1); // input moved the game
    expect(audio.plays).toContain("hop"); // accepted move fires the SFX
    const hopsAfterUp = audio.plays.filter((n) => n === "hop").length;
    key("ArrowDown");
    expect(probe.state!.row).toBe(START_ROW);
    key("ArrowDown"); // REJECTED (already at the start row) — no sound
    expect(audio.plays.filter((n) => n === "hop").length).toBe(hopsAfterUp + 1);

    bus.setEnabled(false);
    game.pause("blur");
    key("ArrowUp"); // discarded by the disabled bus
    bus.setEnabled(true);
    key("ArrowUp"); // bus live again but the game is still paused
    expect(probe.state!.row).toBe(START_ROW);
    game.resume();
    key("ArrowUp");
    expect(probe.state!.row).toBe(START_ROW - 1);
    game.destroy();
  });

  it("restart resets; end fires at most once; destroy is idempotent", async () => {
    const game = froggerDefinition.create(ctx);
    await game.init(new AbortController().signal);
    if (game.loop !== "shell") throw new Error("frogger must be shell-loop");
    game.start(practice("frog-a"));
    const probe = game as unknown as ModuleProbe;
    key("ArrowUp");
    key("ArrowUp");
    game.update(500);
    expect(probe.state!.score).toBe(2);

    game.start(practice("frog-b"));
    expect(probe.state!.score).toBe(0);
    expect(probe.state!.row).toBe(START_ROW);
    expect(probe.state!.tick).toBe(0);

    // Terminal path: last life, hero in the guard lane, guard on top.
    probe.state!.lives = 1;
    probe.state!.row = 5;
    probe.state!.invuln = 0;
    probe.state!.lanes[4].xs = [HERO_X, HERO_X];
    game.update(50);
    // Terminal HOLD (audit P1): the fatal-hit wash must paint before
    // report.end stops the loop — the end lands ~300ms later, not now.
    expect(endReasons).toEqual([]);
    game.update(300);
    expect(endReasons).toEqual(["lost"]);
    expect(audio.plays).toContain("lose"); // terminal SFX fired
    expect(audio.registered).toContain("hit"); // event synths registered
    game.update(1000);
    expect(endReasons).toEqual(["lost"]); // never re-reports
    expect(audio.plays.filter((n) => n === "lose")).toHaveLength(1);

    game.destroy();
    game.destroy();
    key("ArrowUp"); // late input after destroy: no crash, no mutation
    expect(endReasons).toEqual(["lost"]);
  });
});
