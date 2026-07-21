/**
 * Regression tests for M0 review P1s: FixedLoop must never render or
 * reschedule after stop() (even mid-frame), and the claw's drop-light
 * timeout must not survive destroy().
 */

import { afterEach, describe, expect, it, vi } from "vitest";
import { FixedLoop } from "@/shell/loop";
import { LeakTracker } from "@/shell/conformance";
import { createInput } from "@/games/claw/engine/input";
import type { Manifest } from "@/games/claw/engine/types";

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
      frontPlush: zero,
      frame: zero,
      trolley: zero,
      clawOpen: zero,
      clawClosed: zero,
      clawPlush: {},
      winBoard: zero,
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
