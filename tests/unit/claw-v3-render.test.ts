/**
 * Claw V3 presentation contract (Daidai delivery, 2026-07-25):
 *  - DEPTH MASKING: the middle plush rows are always in the scene; the
 *    claw draws in FRONT of them at the front aim depth and BEHIND them
 *    at the back aim depth (so a back-row grab hides its result).
 *  - NO shadow element under the claw.
 *  - The win timeline holds motionless over the chute before releasing,
 *    then plays the authored fall frames.
 *  - TRY AGAIN uses Daidai's sprite; SO CLOSE!/UNAVAILABLE stay as text.
 *
 * Sprites get DISTINCT srcs here so draw order is provable by src.
 */

import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import type { GameContext, RunContext } from "@/shell/contract";
import { createAudioBus } from "@/shell/audio";
import { createInputBus } from "@/shell/input";
import { clawDefinition } from "@/games/claw/module";
import type { Manifest } from "@/games/claw/engine/types";

const drawn: string[] = [];
interface DrawCall {
  src: string;
  x: number;
  y: number;
  w: number;
  h: number;
}
const calls: DrawCall[] = [];

function manifest(): Manifest {
  const rect = (src: string, x = 0, y = 0, w = 10, h = 10) => ({
    src,
    x,
    y,
    w,
    h,
  });
  return {
    scale: 1,
    design: { w: 100, h: 150 },
    back: rect("back"),
    midPlush: rect("mid"),
    frontPlush: rect("front"),
    frame: rect("frame"),
    trolley: rect("trolley"),
    clawOpen: rect("claw-open", 40, 10),
    clawClosed: rect("claw-closed", 40, 10),
    // Mirrors the real V3 relationship: the release claw's BOTTOM is
    // exactly where fall frame 0 starts, on a shared centre line.
    clawRelease: rect("claw-release", 40, 10, 20, 30),
    clawPlush: {
      D: rect("plush-D", 40, 10),
      A: rect("plush-A", 40, 10),
      E: rect("plush-E", 40, 10),
      B: rect("plush-B", 40, 10),
      K: rect("plush-K", 40, 10),
      A2: rect("plush-A2", 40, 10),
    },
    fallFrames: [
      rect("fall-0", 45, 40, 10, 12),
      rect("fall-1", 45, 52, 10, 12),
      rect("fall-2", 45, 64, 10, 12),
      rect("fall-3", 45, 76, 10, 12),
      rect("fall-4", 45, 88, 10, 12),
      rect("fall-5", 45, 100, 10, 12),
    ],
    winBoard: rect("win-board", 20, 20, 60, 20),
    tryAgain: rect("try-again", 20, 40, 60, 20),
    controls: {
      left: rect("ctl-left", 5, 130),
      right: rect("ctl-right", 85, 130),
      forward: rect("ctl-forward", 5, 110),
      backward: rect("ctl-backward", 85, 110),
      drop: rect("ctl-drop", 45, 130),
    },
  };
}

/** Canvas stub that records drawImage order by the image's src. */
function stubCanvas(): void {
  const gradient = { addColorStop: () => undefined };
  const make = (canvas: HTMLCanvasElement) =>
    new Proxy(
      {},
      {
        get(target, prop) {
          if (prop === "canvas") return canvas;
          if (prop === "createRadialGradient") return () => gradient;
          if (prop === "drawImage") {
            return (
              img: { src?: string },
              x?: number,
              y?: number,
              w?: number,
              h?: number,
            ) => {
              if (!img?.src) return;
              drawn.push(img.src);
              // 5-arg form is the engine's blit(img, x, y, w, h).
              if (typeof w === "number" && typeof h === "number") {
                calls.push({ src: img.src, x: x!, y: y!, w, h });
              }
            };
          }
          const value = (target as Record<PropertyKey, unknown>)[prop];
          return value !== undefined ? value : () => undefined;
        },
        set(target, prop, value) {
          (target as Record<PropertyKey, unknown>)[prop] = value;
          return true;
        },
      },
    ) as unknown as CanvasRenderingContext2D;
  vi.spyOn(HTMLCanvasElement.prototype, "getContext").mockImplementation(
    function (this: HTMLCanvasElement) {
      return make(this);
    } as never,
  );
}

interface EngineProbe {
  clawTZ: number;
  clawTX: number;
  phase: string;
  spriteState: string;
  overChute: boolean;
  winFallT: number;
  replay(): void;
  render(now: number): void;
  update(dt: number): void;
  beginOutcome(outcome: string): void;
  segs: { name: string }[];
  flashKind: string;
  flash(text: string, kind?: string): void;
}

describe("claw V3 presentation", () => {
  let cleanup: (() => void) | null = null;

  beforeEach(() => {
    drawn.length = 0;
    calls.length = 0;
    stubCanvas();
    // Image whose `src` setter records the value AND resolves onload.
    vi.stubGlobal(
      "Image",
      class {
        onload: (() => void) | null = null;
        naturalWidth = 10;
        naturalHeight = 10;
        #src = "";
        get src() {
          return this.#src;
        }
        set src(value: string) {
          // strip the asset base so the recorded name is the manifest src
          this.#src = value.split("/").pop() ?? value;
          setTimeout(() => this.onload?.(), 0);
        }
      },
    );
    vi.stubGlobal(
      "fetch",
      vi.fn(async (url: string) => {
        if (String(url).endsWith("manifest.json")) {
          return new Response(JSON.stringify(manifest()), { status: 200 });
        }
        throw new Error(`unexpected fetch: ${url}`);
      }),
    );
  });

  afterEach(() => {
    cleanup?.();
    cleanup = null;
    vi.unstubAllGlobals();
    vi.restoreAllMocks();
    document.body.replaceChildren();
  });

  async function mount() {
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
        designBox: { w: 100, h: 150 },
      },
      input,
      audio,
      t: (key) => key,
      report: { score: () => undefined, end: () => undefined },
    };
    const adapter = clawDefinition.create(ctx);
    await adapter.init(new AbortController().signal);
    await new Promise((r) => setTimeout(r, 5));
    const run: RunContext = {
      mode: "practice",
      attemptId: null,
      seed: "v3",
      random: Math.random,
      signal: new AbortController().signal,
    };
    adapter.start(run);
    const machine = (adapter as unknown as { machine: unknown })
      .machine as EngineProbe;
    cleanup = () => {
      adapter.destroy();
      input.destroy();
      audio.destroy();
      host.remove();
    };
    return machine;
  }

  it("FRONT aim depth: the claw draws IN FRONT of the middle plush rows (mid before claw)", async () => {
    const machine = await mount();
    machine.clawTZ = 0.8; // toward the glass
    drawn.length = 0;
    machine.render(1000);

    expect(drawn).toContain("mid"); // the rows are ALWAYS in the scene
    const mid = drawn.indexOf("mid");
    const claw = drawn.findIndex((s) => s.startsWith("claw-"));
    const front = drawn.indexOf("front");
    expect(claw).toBeGreaterThan(mid); // claw in front of the mid rows
    expect(front).toBeGreaterThan(claw); // front rows still occlude it
  });

  it("BACK aim depth: the claw sinks BEHIND the middle plush rows (mid after claw)", async () => {
    const machine = await mount();
    machine.clawTZ = 0.2; // away from the glass
    drawn.length = 0;
    machine.render(1000);

    const mid = drawn.indexOf("mid");
    const claw = drawn.findIndex((s) => s.startsWith("claw-"));
    expect(mid).toBeGreaterThan(claw); // hides whether the grab worked
    expect(drawn.indexOf("front")).toBeGreaterThan(mid);
  });

  it("the win timeline HOLDS over the chute between lowering and releasing", async () => {
    const machine = await mount();
    machine.beginOutcome("win");
    const names = machine.segs.map((s) => s.name);
    expect(names).toContain("holdOverChute");
    // Order against segments that ACTUALLY exist — comparing against the
    // removed "lower" made this vacuous (indexOf → -1 always passed).
    const toHole = names.indexOf("toHole");
    const hold = names.indexOf("holdOverChute");
    const release = names.indexOf("release");
    expect(toHole).toBeGreaterThanOrEqual(0);
    expect(hold).toBeGreaterThan(toHole);
    expect(release).toBeGreaterThan(hold);
    // The synthetic chute descent is intentionally gone in V3: the
    // authored release art sits at rest height over the chute.
    expect(names).not.toContain("lower");
  });

  it("the release claw renders AT its authored position, in bounds and aligned with fall frame 0 (review P1)", async () => {
    const m = manifest();
    const machine = await mount();
    machine.beginOutcome("win");
    machine.phase = "dropping"; // startDescent normally sets this
    // Run the timeline to the release segment (past rise/toHole/hold).
    for (let i = 0; i < 400; i++) {
      machine.update(40);
      if (machine.spriteState === "release") break;
    }
    expect(machine.spriteState).toBe("release");

    calls.length = 0;
    machine.render(1000);
    const release = calls.find((c) => c.src === "claw-release");
    expect(release, "release claw must be drawn").toBeDefined();

    // 1) On-canvas — the bug drew it at x ≈ -175.
    expect(release!.x).toBeGreaterThanOrEqual(0);
    expect(release!.x + release!.w).toBeLessThanOrEqual(m.design.w);

    // 2) EXACTLY the authored position (no synthetic offset applied).
    expect(release!.x).toBe(m.clawRelease.x);
    expect(release!.y).toBe(m.clawRelease.y);

    // 3) Continuous with the authored fall animation: the claw's bottom
    //    meets fall frame 0's top, and they share a centre line.
    const fall0 = m.fallFrames[0];
    expect(release!.y + release!.h).toBe(fall0.y);
    expect(
      Math.abs(release!.x + release!.w / 2 - (fall0.x + fall0.w / 2)),
    ).toBeLessThanOrEqual(2);
  });

  it("after a win REPLAY the chute pose is released: steering visibly moves the claw again (review P1)", async () => {
    const machine = await mount();
    machine.beginOutcome("win");
    machine.phase = "dropping";
    for (let i = 0; i < 600; i++) {
      machine.update(40);
      if (machine.phase === "won") break;
    }
    expect(machine.phase).toBe("won");
    expect(machine.overChute).toBe(true); // posed over the chute

    // Practice replay (board tap / auto-return) goes through toReady().
    machine.replay();
    expect(machine.phase).toBe("ready");
    expect(machine.overChute).toBe(false);
    expect(machine.winFallT).toBe(-1);

    // Steering must move the RENDERED claw, not just invisible state.
    calls.length = 0;
    machine.render(1000);
    const before = calls.find((c) => c.src.startsWith("claw-"))!;
    // Steer by a known delta from wherever the carry left the claw.
    machine.clawTX = machine.clawTX + 30;
    calls.length = 0;
    machine.render(1000);
    const after = calls.find((c) => c.src.startsWith("claw-"))!;
    // The rendered x must track clawTX 1:1 — under the chute pose it
    // would not move at all (the bug), since chuteOffset ignores clawTX.
    // (closeTo: the ready-state idle sway adds sub-pixel float residue)
    expect(after.x - before.x).toBeCloseTo(30, 6);
  });

  it("TRY AGAIN uses Daidai's sprite; SO CLOSE! stays canvas text", async () => {
    const machine = await mount();
    machine.flash("TRY AGAIN", "tryAgain");
    drawn.length = 0;
    machine.render(1000);
    expect(drawn).toContain("try-again");

    machine.flash("SO CLOSE!");
    drawn.length = 0;
    machine.render(1000);
    expect(drawn).not.toContain("try-again");
  });
});
