/**
 * Claw V3 presentation contract (Daidai delivery, 2025-07-25; depth model
 * revised per Daidai 2026-07-27):
 *  - Z-ORDER: the background plush rows are the FURTHEST element — the
 *    claw ALWAYS draws in front of them, at either aim depth. (This
 *    supersedes the earlier occlusion reading where a back-row grab sank
 *    the claw behind them.)
 *  - PERSPECTIVE: pushing back moves the claw further up into the machine
 *    (doubled gantry shift) AND shrinks it toward the vanishing area.
 *  - NO shadow element under the claw.
 *  - The win timeline holds motionless over the chute before releasing,
 *    then plays the authored fall frames.
 *  - TRY AGAIN and SO CLOSE! use Daidai's sprites; UNAVAILABLE stays text.
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
    row1: rect("row1", 10, 100, 80, 12),
    row2: rect("row2", 10, 84, 80, 12),
    row3: rect("row3", 10, 68, 80, 12),
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
    soClose: rect("so-close", 20, 40, 60, 20),
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
  depthStation: 0 | 1 | 2;
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
  // Private geometry, probed for the descent/scale alignment regression.
  descentDepth(): number;
  gantryY(): number;
  depthScale(): number;
  pileY(): number;
  flash(text: string, kind?: string): void;
}

import { MOVE_LO_FRAC } from "@/games/claw/engine/engine";
import realManifest from "../../public/games/claw/manifest.json";

describe("claw — chute fence (Daidai exploit, 2026-07-27)", () => {
  it("the leftmost aim keeps a slip tumble CLEAR of the chute mouth (real cabinet)", () => {
    // Parking over the trap and dropping used to land the slip tumble
    // visually INSIDE the chute — a free win every time. The tumble is
    // centred on the claw at width 0.15·dW; its left edge at the
    // leftmost rail position must stay right of the mouth.
    const leftmostCenter = realManifest.design.w * MOVE_LO_FRAC;
    // The tumble ROTATES and squashes as it falls, so the conservative
    // extent is the half-DIAGONAL of its square draw box, not half-width.
    const tumbleHalfDiagonal =
      ((realManifest.design.w * 0.15) / 2) * Math.SQRT2;
    const mouthRight = Math.max(
      ...realManifest.fallFrames.map((f) => f.x + f.w),
    );
    expect(leftmostCenter - tumbleHalfDiagonal).toBeGreaterThan(mouthRight);
  });
});

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

  it("STATION 0 (rest): rows behind the claw, native scale, authored height", async () => {
    const machine = await mount();
    drawn.length = 0;
    calls.length = 0;
    machine.render(1000);

    // All three rows are ALWAYS in the scene, always BEHIND the claw
    // (Daidai's standing z-order rule — stations read from position and
    // scale, never occlusion).
    const claw = drawn.findIndex((s) => s.startsWith("claw-"));
    for (const row of ["row1", "row2", "row3"]) {
      expect(drawn).toContain(row);
      expect(claw).toBeGreaterThan(drawn.indexOf(row));
    }
    const clawCall = calls.find((c) => c.src.startsWith("claw-"))!;
    expect(clawCall.w).toBe(10); // rest = authored scale
    const trolleyCall = calls.find((c) => c.src === "trolley")!;
    expect(trolleyCall.w).toBe(10);
  });

  it("STATION 2 (two Up): whole assembly smaller and higher; rows still behind", async () => {
    const machine = await mount();
    drawn.length = 0;
    calls.length = 0;
    machine.render(1000);
    const frontClaw = calls.find((c) => c.src.startsWith("claw-"))!;
    const frontTrolley = calls.find((c) => c.src === "trolley")!;

    machine.depthStation = 2;
    machine.clawTZ = 0;
    drawn.length = 0;
    calls.length = 0;
    machine.render(1000);

    const claw = drawn.findIndex((s) => s.startsWith("claw-"));
    for (const row of ["row1", "row2", "row3"]) {
      expect(claw).toBeGreaterThan(drawn.indexOf(row));
    }
    // Perspective: CLAW and TROLLEY BOX shrink (0.82) and climb together
    // — the whole system reads as one machine moving away.
    const clawCall = calls.find((c) => c.src.startsWith("claw-"))!;
    expect(clawCall.w).toBeCloseTo(10 * 0.82, 5);
    expect(clawCall.y).toBeLessThan(frontClaw.y);
    const trolleyCall = calls.find((c) => c.src === "trolley")!;
    expect(trolleyCall.w).toBeCloseTo(10 * 0.82, 5);
    expect(trolleyCall.y).toBeLessThan(frontTrolley.y);
  });

  it("scale and height are MONOTONIC front → middle → back", async () => {
    const machine = await mount();
    const at = (station: 0 | 1 | 2) => {
      machine.depthStation = station;
      machine.clawTZ = 1 - station / 2;
      return { scale: machine.depthScale(), y: machine.gantryY() };
    };
    const s0 = at(0);
    const s1 = at(1);
    const s2 = at(2);
    expect(s0.scale).toBe(1);
    expect(s1.scale).toBeCloseTo(0.91, 5);
    expect(s2.scale).toBeCloseTo(0.82, 5);
    expect(s0.y).toBe(0); // rest = authored position
    expect(s1.y).toBeLessThan(s0.y);
    expect(s2.y).toBeLessThan(s1.y);
  });

  it("full descent lands the tips EXACTLY on each station's own plush row", async () => {
    // descentDepth() is derived, not tuned: tips (top-anchored, so top +
    // h·scale) land on pileY — the STATION's row rect — at every station
    // ("compensate the drop distance so the claw reaches the correct
    // plush row", Daidai).
    const machine = await mount();
    const m = manifest();
    for (const station of [0, 1, 2] as const) {
      machine.depthStation = station;
      machine.clawTZ = 1 - station / 2;
      const tips =
        m.clawOpen.y +
        machine.descentDepth() +
        machine.gantryY() +
        m.clawOpen.h * machine.depthScale();
      expect(tips, `station ${station}`).toBeCloseTo(machine.pileY(), 6);
    }
  });

  it("SO CLOSE! renders Daidai's BOARD sprite, not canvas text (2026-07-27)", async () => {
    const machine = await mount();
    machine.flash("SO CLOSE!", "soClose");
    drawn.length = 0;
    machine.render(1000);
    expect(drawn).toContain("so-close"); // the authored board blits
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

  it("a BACK-station win replays at the FRONT station — no station/render split (audit P1)", async () => {
    // The win carry eases clawTZ back to 1 for the chute while
    // depthStation kept the aimed row: replaying with them split left
    // the claw LOOKING front-parked but targeting row 3, Up clamped and
    // Down jumping to the middle. The old replay test started at
    // station 0, so it could never catch this.
    const machine = await mount();
    machine.depthStation = 2; // aim from the BACK station
    machine.clawTZ = 0;
    machine.beginOutcome("win");
    machine.phase = "dropping";
    for (let i = 0; i < 600; i++) {
      machine.update(40);
      if (machine.phase === "won") break;
    }
    expect(machine.phase).toBe("won");
    expect(machine.clawTZ).toBe(1); // the carry eased to the front...

    machine.replay();
    // ...and the STATION rejoins it: both reset to front, together.
    expect(machine.depthStation).toBe(0);
    expect(machine.clawTZ).toBe(1);
    expect(machine.depthScale()).toBe(1);
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

  it("TRY AGAIN and SO CLOSE! use Daidai's sprites; UNAVAILABLE stays canvas text", async () => {
    const machine = await mount();
    machine.flash("TRY AGAIN", "tryAgain");
    drawn.length = 0;
    machine.render(1000);
    expect(drawn).toContain("try-again");

    machine.flash("SO CLOSE!", "soClose");
    drawn.length = 0;
    machine.render(1000);
    expect(drawn).toContain("so-close");
    expect(drawn).not.toContain("try-again");

    machine.flash("UNAVAILABLE"); // no delivered art — canvas text
    drawn.length = 0;
    machine.render(1000);
    expect(drawn).not.toContain("so-close");
    expect(drawn).not.toContain("try-again");
  });
});
