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
