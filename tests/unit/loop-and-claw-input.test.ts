/**
 * Regression tests for M0 review P1s: FixedLoop must never render or
 * reschedule after stop() (even mid-frame), and the claw's drop-light
 * timeout must not survive destroy().
 */

import { afterEach, describe, expect, it, vi } from "vitest";
import { FixedLoop } from "@/shell/loop";
import { LeakTracker } from "@/shell/conformance";
import { createInput } from "@/games/claw/engine/input";
import { REQUIRED_CONTROLS, REQUIRED_PLUSH } from "@/games/claw/engine/assets";
import type { Manifest } from "@/games/claw/engine/types";
import realManifest from "../../public/games/claw/manifest.json";

describe("FixedLoop stop semantics", () => {
  afterEach(() => {
    vi.unstubAllGlobals();
  });

  function stubRaf() {
    const queue = new Map<number, FrameRequestCallback>();
    let nextId = 1;
    vi.stubGlobal("requestAnimationFrame", (cb: FrameRequestCallback) => {
      const id = nextId++;
      queue.set(id, cb);
      return id;
    });
    vi.stubGlobal("cancelAnimationFrame", (id: number) => {
      queue.delete(id);
    });
    return {
      /** Fire all currently queued frames at the given timestamp. */
      tick(now: number) {
        const frames = [...queue.values()];
        queue.clear();
        for (const cb of frames) cb(now);
      },
      get pending() {
        return queue.size;
      },
    };
  }

  it("stop() from inside update() renders nothing and schedules nothing", () => {
    const raf = stubRaf();
    vi.spyOn(performance, "now").mockReturnValue(0); // align clocks with rAF
    let renders = 0;
    const loop: FixedLoop = new FixedLoop({
      update() {
        loop.stop(); // report.end() path: update ends the run
      },
      render() {
        renders += 1;
      },
    });
    loop.start();
    expect(raf.pending).toBe(1);
    raf.tick(0); // zero delta: no update yet, renders once, reschedules
    raf.tick(100); // ≥ one fixed step accumulated → update runs → stop()
    expect(renders).toBe(1); // never renders after stop
    expect(raf.pending).toBe(0); // and never rescheduled
    expect(loop.isRunning).toBe(false);
    vi.restoreAllMocks();
  });

  it("stop() then start() leaves exactly one frame chain", () => {
    const raf = stubRaf();
    const loop = new FixedLoop({ update() {}, render() {} });
    loop.start();
    raf.tick(0);
    loop.stop();
    loop.start();
    expect(raf.pending).toBe(1); // no stray second chain
  });
});

describe("claw input teardown (drop-light timer)", () => {
  function fakeManifest(): Manifest {
    const zero = { src: "x.webp", x: 9999, y: 9999, w: 1, h: 1 };
    return {
      scale: 1,
      design: { w: 100, h: 100 },
      back: zero,
      midPlush: zero,
      frontPlush: zero,
      frame: zero,
      trolley: zero,
      clawOpen: zero,
      clawClosed: zero,
      clawRelease: zero,
      clawPlush: {},
      winBoard: zero,
      fallFrames: [zero, zero, zero, zero, zero, zero], // exactly 6 required
      tryAgain: zero,
      controls: {
        left: { ...zero },
        right: { ...zero },
        forward: { ...zero },
        backward: { ...zero },
        drop: { src: "x.webp", x: 0, y: 0, w: 10, h: 10 },
      },
    };
  }

  it("overlapping padded zones resolve to the NEAREST button center (review P1) and axes hold independently (review P2)", () => {
    const canvas = document.createElement("canvas");
    document.body.appendChild(canvas);
    const dirCalls: number[] = [];
    const depthCalls: number[] = [];
    let dirUps = 0;
    let depthUps = 0;
    // REAL cabinet geometry (public/games/claw/manifest.json) — the
    // overlap corners only exist at the true d-pad layout.
    const manifest = {
      ...fakeManifest(),
      controls: {
        left: { src: "x.webp", x: 43, y: 1350, w: 71, h: 60 },
        right: { src: "x.webp", x: 202, y: 1350, w: 71, h: 60 },
        forward: { src: "x.webp", x: 123, y: 1280, w: 69, h: 60 },
        backward: { src: "x.webp", x: 123, y: 1418, w: 69, h: 60 },
        drop: { src: "x.webp", x: 726, y: 1331, w: 160, h: 133 },
      },
    };
    const input = createInput({
      canvas,
      manifest,
      toDesign: (x, y) => ({ x, y }),
      onDirDown: (d) => dirCalls.push(d),
      onDirUp: () => {
        dirUps += 1;
      },
      onDepthDown: (d) => depthCalls.push(d),
      onDepthUp: () => {
        depthUps += 1;
      },
      onDrop: () => undefined,
    });

    const tap = (x: number, y: number, pointerId: number) => {
      const down = new MouseEvent("pointerdown", {
        clientX: x,
        clientY: y,
        bubbles: true,
      });
      Object.defineProperty(down, "pointerId", { value: pointerId });
      canvas.dispatchEvent(down);
    };
    const lift = (pointerId: number) => {
      const up = new MouseEvent("pointerup", { bubbles: true });
      Object.defineProperty(up, "pointerId", { value: pointerId });
      window.dispatchEvent(up);
    };

    // (130,1330) is VISIBLY inside forward but inside left's padded
    // zone; first-match order routed it left before the fix.
    tap(130, 1330, 1);
    expect(depthCalls).toEqual([-1]);
    expect(dirCalls).toEqual([]);
    lift(1);
    expect(depthUps).toBe(1);
    // Lower mirror: visibly inside backward, inside left's pad.
    tap(130, 1430, 2);
    expect(depthCalls).toEqual([-1, 1]);
    expect(dirCalls).toEqual([]);
    lift(2);
    // Visibly inside left, inside forward's pad → still left.
    tap(100, 1360, 3);
    expect(dirCalls).toEqual([-1]);
    lift(3);
    // Visibly inside right, inside forward's pad → still right.
    tap(210, 1355, 4);
    expect(dirCalls).toEqual([-1, 1]);
    lift(4);
    expect(dirUps).toBe(2);
    expect(depthCalls).toEqual([-1, 1]); // corners never leaked to depth

    // Opposite POINTER holds on one axis: releasing one re-emits the
    // survivor instead of stopping it (review P2).
    dirCalls.length = 0;
    dirUps = 0;
    tap(78, 1380, 10); // hold left
    tap(237, 1380, 11); // hold right too — newest wins
    expect(dirCalls).toEqual([-1, 1]);
    lift(11); // release RIGHT — left is still physically held
    expect(dirCalls).toEqual([-1, 1, -1]);
    expect(dirUps).toBe(0);
    lift(10);
    expect(dirUps).toBe(1);

    // Opposite KEYBOARD holds on the depth axis behave the same way.
    depthCalls.length = 0;
    depthUps = 0;
    window.dispatchEvent(new KeyboardEvent("keydown", { key: "ArrowUp" }));
    window.dispatchEvent(new KeyboardEvent("keydown", { key: "ArrowDown" }));
    expect(depthCalls).toEqual([-1, 1]);
    window.dispatchEvent(new KeyboardEvent("keyup", { key: "ArrowDown" }));
    expect(depthCalls).toEqual([-1, 1, -1]);
    expect(depthUps).toBe(0);
    window.dispatchEvent(new KeyboardEvent("keyup", { key: "ArrowUp" }));
    expect(depthUps).toBe(1);

    input.destroy();
    canvas.remove();
  });

  // A d-pad control layout with the manifest's real geometry, so the
  // overlap-corner + axis vectors above can't silently pass against
  // stale copied rects if the art reflows (test-analyzer gap #3).
  function realControlManifest(): Manifest {
    return { ...fakeManifest(), controls: realManifest.controls };
  }

  function harness(manifest: Manifest) {
    const canvas = document.createElement("canvas");
    document.body.appendChild(canvas);
    const dir: number[] = [];
    const depth: number[] = [];
    let dirUps = 0;
    let depthUps = 0;
    const input = createInput({
      canvas,
      manifest,
      toDesign: (x, y) => ({ x, y }),
      onDirDown: (d) => dir.push(d),
      onDirUp: () => {
        dirUps += 1;
      },
      onDepthDown: (d) => depth.push(d),
      onDepthUp: () => {
        depthUps += 1;
      },
      onDrop: () => undefined,
    });
    const centerOf = (k: "left" | "right" | "forward" | "backward") => {
      const r = realManifest.controls[k];
      return [r.x + r.w / 2, r.y + r.h / 2] as const;
    };
    const tap = (x: number, y: number, id: number) => {
      const down = new MouseEvent("pointerdown", {
        clientX: x,
        clientY: y,
        bubbles: true,
      });
      Object.defineProperty(down, "pointerId", { value: id });
      canvas.dispatchEvent(down);
    };
    const lift = (id: number) => {
      const up = new MouseEvent("pointerup", { bubbles: true });
      Object.defineProperty(up, "pointerId", { value: id });
      window.dispatchEvent(up);
    };
    return {
      input,
      canvas,
      dir,
      depth,
      centerOf,
      tap,
      lift,
      get dirUps() {
        return dirUps;
      },
      get depthUps() {
        return depthUps;
      },
    };
  }

  it("the two axes hold SIMULTANEOUSLY: steer + depth glide at once, releasing one leaves the other live (test-analyzer gap #1)", () => {
    const h = harness(realControlManifest());
    const [lx, ly] = h.centerOf("left");
    h.tap(lx, ly, 1); // hold Left (pointer)
    window.dispatchEvent(new KeyboardEvent("keydown", { key: "ArrowUp" })); // + forward (key)
    expect(h.dir).toEqual([-1]); // X axis: left
    expect(h.depth).toEqual([-1]); // Z axis: forward — independent, both live
    expect(h.input.state.pressed.has("left")).toBe(true);
    expect(h.input.state.pressed.has("forward")).toBe(true);

    // Release the DEPTH key: X (left) must stay live and lit, no dir Up.
    window.dispatchEvent(new KeyboardEvent("keyup", { key: "ArrowUp" }));
    expect(h.depthUps).toBe(1);
    expect(h.dirUps).toBe(0);
    expect(h.dir).toEqual([-1]); // no spurious X re-emit
    expect(h.input.state.pressed.has("left")).toBe(true);
    h.lift(1);
    expect(h.dirUps).toBe(1);

    h.input.destroy();
    h.canvas.remove();
  });

  it("SAME-direction, DIFFERENT sources never collapse: pointer+key on one control, releasing either keeps it live and lit (review P2 round 2)", () => {
    const h = harness(realControlManifest());
    const [lx, ly] = h.centerOf("left");
    h.tap(lx, ly, 5); // Left via pointer
    window.dispatchEvent(new KeyboardEvent("keydown", { key: "ArrowLeft" })); // Left via key
    expect(h.dir).toEqual([-1]); // same effective dir — one emit, no re-emit
    // Release the KEY: the pointer still holds Left.
    window.dispatchEvent(new KeyboardEvent("keyup", { key: "ArrowLeft" }));
    expect(h.dirUps).toBe(0);
    expect(h.input.state.pressed.has("left")).toBe(true);
    h.lift(5);
    expect(h.dirUps).toBe(1);
    expect(h.input.state.pressed.has("left")).toBe(false);

    h.input.destroy();
    h.canvas.remove();
  });

  it("post-pause (setEnabled toggle) re-press of the SAME direction re-emits — the axis state resets on disable (test-analyzer gap #2)", () => {
    const h = harness(realControlManifest());
    window.dispatchEvent(new KeyboardEvent("keydown", { key: "ArrowDown" }));
    expect(h.depth).toEqual([1]);
    // Host pauses → setEnabled(false) drains holds and emits the Up.
    h.input.setEnabled(false);
    expect(h.depthUps).toBe(1);
    expect(h.input.state.pressed.has("backward")).toBe(false);
    // The stale keyup after disable is inert.
    window.dispatchEvent(new KeyboardEvent("keyup", { key: "ArrowDown" }));
    // Resume, then re-press the SAME direction: must re-emit (would be
    // dead if lastZ stayed 1 across the disable — the bug this pins).
    h.input.setEnabled(true);
    window.dispatchEvent(new KeyboardEvent("keydown", { key: "ArrowDown" }));
    expect(h.depth).toEqual([1, 1]);
    expect(h.input.state.pressed.has("backward")).toBe(true);

    h.input.destroy();
    h.canvas.remove();
  });

  it("the shipped manifest satisfies the fetchManifest contract (every required control + plush key present)", () => {
    for (const k of REQUIRED_CONTROLS) {
      expect(realManifest.controls, k).toHaveProperty(k);
    }
    for (const k of REQUIRED_PLUSH) {
      expect(realManifest.clawPlush, k).toHaveProperty(k);
    }
  });

  it("SAME-direction holds from different sources never collapse: releasing one keeps the other moving and lit (review P2 round 2)", () => {
    const canvas = document.createElement("canvas");
    document.body.appendChild(canvas);
    const dirCalls: number[] = [];
    let dirUps = 0;
    const manifest = {
      ...fakeManifest(),
      controls: {
        left: { src: "x.webp", x: 43, y: 1350, w: 71, h: 60 },
        right: { src: "x.webp", x: 202, y: 1350, w: 71, h: 60 },
        forward: { src: "x.webp", x: 123, y: 1280, w: 69, h: 60 },
        backward: { src: "x.webp", x: 123, y: 1418, w: 69, h: 60 },
        drop: { src: "x.webp", x: 726, y: 1331, w: 160, h: 133 },
      },
    };
    const input = createInput({
      canvas,
      manifest,
      toDesign: (x, y) => ({ x, y }),
      onDirDown: (d) => dirCalls.push(d),
      onDirUp: () => {
        dirUps += 1;
      },
      onDepthDown: () => undefined,
      onDepthUp: () => undefined,
      onDrop: () => undefined,
    });
    const tap = (x: number, y: number, pointerId: number) => {
      const down = new MouseEvent("pointerdown", {
        clientX: x,
        clientY: y,
        bubbles: true,
      });
      Object.defineProperty(down, "pointerId", { value: pointerId });
      canvas.dispatchEvent(down);
    };
    const lift = (pointerId: number) => {
      const up = new MouseEvent("pointerup", { bubbles: true });
      Object.defineProperty(up, "pointerId", { value: pointerId });
      window.dispatchEvent(up);
    };

    // Pointer on Left + ArrowLeft: releasing the KEY changes nothing.
    tap(78, 1380, 30);
    expect(dirCalls).toEqual([-1]);
    window.dispatchEvent(new KeyboardEvent("keydown", { key: "ArrowLeft" }));
    expect(dirCalls).toEqual([-1]); // same effective direction — no re-emit
    window.dispatchEvent(new KeyboardEvent("keyup", { key: "ArrowLeft" }));
    expect(dirUps).toBe(0); // the pointer still holds Left
    expect(input.state.pressed.has("left")).toBe(true); // stays lit
    lift(30);
    expect(dirUps).toBe(1);
    expect(input.state.pressed.has("left")).toBe(false);

    // TWO pointers on the same button: first release is a no-op.
    dirCalls.length = 0;
    dirUps = 0;
    tap(78, 1380, 31);
    tap(80, 1382, 32);
    expect(dirCalls).toEqual([-1]); // one hold state, one emission
    lift(31);
    expect(dirUps).toBe(0);
    expect(input.state.pressed.has("left")).toBe(true);
    lift(32);
    expect(dirUps).toBe(1);
    expect(input.state.pressed.has("left")).toBe(false);

    input.destroy();
    canvas.remove();
  });

  it("a tapped drop leaves no pending timer after destroy()", () => {
    const tracker = new LeakTracker();
    tracker.begin();

    const canvas = document.createElement("canvas");
    document.body.appendChild(canvas);
    let drops = 0;
    const input = createInput({
      canvas,
      manifest: fakeManifest(),
      toDesign: (x, y) => ({ x, y }),
      onDirDown: () => undefined,
      onDirUp: () => undefined,
      onDepthDown: () => undefined,
      onDepthUp: () => undefined,
      onDrop: () => {
        drops += 1;
      },
    });

    // Tap inside the drop zone (design coords = client coords here).
    canvas.dispatchEvent(
      new MouseEvent("pointerdown", { clientX: 5, clientY: 5, bubbles: true }),
    );
    expect(drops).toBe(1);
    expect(input.state.pressed.has("drop")).toBe(true);

    // Immediate navigation-away: destroy while the light timer is pending.
    input.destroy();
    canvas.remove();

    const report = tracker.end();
    expect(report.timeouts, JSON.stringify(report)).toBe(0);
    expect(report.clean, JSON.stringify(report)).toBe(true);
  });
});
