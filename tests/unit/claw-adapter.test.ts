/**
 * REAL claw adapter lifecycle in jsdom (M1 review B6): repeatable start()
 * on the same initialized instance, mid-run mute sync, outcome-resolution
 * after destroy, and idempotent destroy. Canvas 2D, Image, and fetch are
 * stubbed; the engine, adapter, and audio wiring are the real modules.
 */

import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import type { GameContext, RunContext } from "@/shell/contract";
import { createAudioBus } from "@/shell/audio";
import { createInputBus } from "@/shell/input";
import { clawDefinition } from "@/games/claw/module";
import { isAudioEnabled } from "@/games/claw/engine/audio";
import type { Manifest } from "@/games/claw/engine/types";

function fakeManifest(): Manifest {
  const rect = (x = 0, y = 0, w = 10, h = 10) => ({
    src: "sprite.webp",
    x,
    y,
    w,
    h,
  });
  return {
    scale: 1,
    design: { w: 100, h: 150 },
    back: rect(),
    frontPlush: rect(),
    frame: rect(),
    trolley: rect(),
    clawOpen: rect(40, 10),
    clawClosed: rect(40, 10),
    clawPlush: {
      D: rect(40, 10),
      A: rect(40, 10),
      E: rect(40, 10),
      B: rect(40, 10),
      K: rect(40, 10),
    },
    winBoard: rect(20, 20, 60, 20),
    controls: {
      left: rect(5, 130),
      right: rect(85, 130),
      forward: rect(5, 110),
      backward: rect(85, 110),
      drop: rect(45, 130),
    },
  };
}

function stubCanvas2d(): void {
  const gradient = { addColorStop: () => undefined };
  const makeCtx = (canvas: HTMLCanvasElement) =>
    new Proxy(
      {},
      {
        get(target, prop) {
          if (prop === "canvas") return canvas;
          if (prop === "createRadialGradient") return () => gradient;
          const value = (target as Record<PropertyKey, unknown>)[prop];
          if (value !== undefined) return value;
          return () => undefined;
        },
        set(target, prop, value) {
          (target as Record<PropertyKey, unknown>)[prop] = value;
          return true;
        },
      },
    ) as unknown as CanvasRenderingContext2D;
  vi.spyOn(HTMLCanvasElement.prototype, "getContext").mockImplementation(
    function (this: HTMLCanvasElement) {
      return makeCtx(this);
    } as never,
  );
}

class FakeImage {
  onload: (() => void) | null = null;
  onerror: ((e: unknown) => void) | null = null;
  set src(_value: string) {
    setTimeout(() => this.onload?.(), 0);
  }
}

function createClawContext() {
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
  return {
    ctx,
    cleanup: () => {
      input.destroy();
      audio.destroy();
      host.remove();
    },
  };
}

function practiceRun(): RunContext {
  return {
    mode: "practice",
    attemptId: null,
    seed: "claw-test",
    random: Math.random,
    signal: new AbortController().signal,
  };
}

beforeEach(() => {
  stubCanvas2d();
  vi.stubGlobal("Image", FakeImage);
  vi.stubGlobal(
    "fetch",
    vi.fn(async (url: string) => {
      if (String(url).endsWith("manifest.json")) {
        return new Response(JSON.stringify(fakeManifest()), { status: 200 });
      }
      throw new Error(`unexpected fetch: ${url}`);
    }),
  );
});

afterEach(() => {
  vi.unstubAllGlobals();
  vi.restoreAllMocks();
  document.body.replaceChildren();
});

describe("claw adapter — real engine lifecycle", () => {
  it("start() twice on the SAME initialized instance restarts in place", async () => {
    const { ctx, cleanup } = createClawContext();
    const adapter = clawDefinition.create(ctx);
    await adapter.init(new AbortController().signal);

    adapter.start(practiceRun());
    // Second start on the same instance (ended → running semantics for a
    // module-loop game): must reset in place, not crash or double-loop.
    expect(() => adapter.start(practiceRun())).not.toThrow();
    adapter.pause("system");
    adapter.resume();
    adapter.destroy();
    adapter.destroy(); // idempotent
    cleanup();
  });

  it("a malformed non-practice run FAILS CLOSED (never local randomness)", async () => {
    const { ctx, cleanup } = createClawContext();
    const adapter = clawDefinition.create(ctx);
    await adapter.init(new AbortController().signal);

    // Hostile JS caller: counted mode without an attempt id. The type
    // system forbids this; the runtime guard must reject it too.
    const malformed = {
      mode: "counted",
      attemptId: null,
      seed: "x",
      random: Math.random,
      signal: new AbortController().signal,
    } as unknown as RunContext;
    expect(() => adapter.start(malformed)).toThrow(/without attemptId/);

    const prizeMalformed = {
      ...malformed,
      mode: "prize",
    } as unknown as RunContext;
    expect(() => adapter.start(prizeMalformed)).toThrow(/without attemptId/);

    adapter.destroy();
    cleanup();
  });

  it("mute toggled MID-RUN syncs legacy claw audio through the bus", async () => {
    const { ctx, cleanup } = createClawContext();
    const adapter = clawDefinition.create(ctx);
    await adapter.init(new AbortController().signal);
    adapter.start(practiceRun());

    ctx.audio.setMuted(true);
    expect(isAudioEnabled()).toBe(false);
    ctx.audio.setMuted(false);
    expect(isAudioEnabled()).toBe(true);

    adapter.destroy();
    // After destroy the subscription is gone — toggles no longer reach it.
    ctx.audio.setMuted(true);
    expect(isAudioEnabled()).toBe(true);
    cleanup();
  });

  it("PAUSED claw ignores Space/Enter/arrows/taps; resume restores them (P1)", async () => {
    const { ctx, cleanup } = createClawContext();
    const adapter = clawDefinition.create(ctx);
    await adapter.init(new AbortController().signal);
    adapter.start(practiceRun());

    // Count outcome requests through the machine's provider seam.
    const machine = (adapter as unknown as { machine: Record<string, unknown> })
      .machine as {
      opts: { outcome: () => Promise<string> };
      input: { state: { pressed: Set<string> } };
      heldDir: number;
      phase: string;
    };
    let outcomeRequests = 0;
    machine.opts.outcome = () => {
      outcomeRequests += 1;
      return new Promise<string>(() => undefined); // never resolves
    };

    adapter.pause("system");

    // Keyboard while paused: drop keys and arrows must be inert.
    window.dispatchEvent(new KeyboardEvent("keydown", { key: " " }));
    window.dispatchEvent(new KeyboardEvent("keydown", { key: "Enter" }));
    window.dispatchEvent(new KeyboardEvent("keydown", { key: "ArrowLeft" }));
    expect(outcomeRequests).toBe(0);
    expect(machine.heldDir).toBe(0);
    expect(machine.input.state.pressed.size).toBe(0);
    expect(machine.phase).toBe("ready"); // nothing started a drop

    // Pointer while paused: tap the ACTUAL drop control center (review
    // P2 — (50,50) was outside the zone). The engine's toDesign needs a
    // real canvas rect (jsdom returns zeros), so mock it 1:1 with design.
    const canvas = (ctx.surface as { canvas: HTMLCanvasElement }).canvas;
    vi.spyOn(canvas, "getBoundingClientRect").mockReturnValue({
      left: 0,
      top: 0,
      width: 100,
      height: 150,
      right: 100,
      bottom: 150,
      x: 0,
      y: 0,
      toJSON: () => ({}),
    } as DOMRect);
    const dropCenter = { clientX: 50, clientY: 135 }; // drop rect 45,130,10,10
    canvas.dispatchEvent(
      new MouseEvent("pointerdown", { ...dropCenter, bubbles: true }),
    );
    expect(outcomeRequests).toBe(0); // inert while paused
    expect(machine.input.state.pressed.size).toBe(0);

    // Resume: the SAME tap now reaches the drop control.
    adapter.resume();
    canvas.dispatchEvent(
      new MouseEvent("pointerdown", { ...dropCenter, bubbles: true }),
    );
    expect(outcomeRequests).toBe(1); // proves the coordinates are live
    // M4 target model: the drop begins descending IMMEDIATELY and the
    // aim is locked — steering during a drop must be refused.
    window.dispatchEvent(new KeyboardEvent("keydown", { key: "ArrowLeft" }));
    expect(machine.heldDir).toBe(0);
    expect(machine.phase).toBe("dropping");

    adapter.destroy();
    cleanup();
  });

  it("paused WON screen ignores the replay tap; resume restores it (P2)", async () => {
    const { ctx, cleanup } = createClawContext();
    const adapter = clawDefinition.create(ctx);
    await adapter.init(new AbortController().signal);
    adapter.start(practiceRun());

    const machine = (adapter as unknown as { machine: { phase: string } })
      .machine;
    machine.phase = "won"; // simulate a completed drop celebration
    adapter.pause("system");

    const canvas = (ctx.surface as { canvas: HTMLCanvasElement }).canvas;
    canvas.dispatchEvent(
      new MouseEvent("pointerdown", {
        clientX: 10,
        clientY: 10,
        bubbles: true,
      }),
    );
    expect(machine.phase).toBe("won"); // replay guard held while paused

    adapter.resume();
    canvas.dispatchEvent(
      new MouseEvent("pointerdown", {
        clientX: 10,
        clientY: 10,
        bubbles: true,
      }),
    );
    expect(machine.phase).toBe("ready"); // replay ran after resume

    adapter.destroy();
    cleanup();
  });

  it("aim selects the plush DETERMINISTICALLY: column → same plush every time (M4 P1)", async () => {
    const { ctx, cleanup } = createClawContext();
    const adapter = clawDefinition.create(ctx);
    await adapter.init(new AbortController().signal);
    adapter.start(practiceRun());

    const machine = (adapter as unknown as { machine: Record<string, unknown> })
      .machine as {
      opts: { outcome: () => Promise<string> };
      onDrop: () => void;
      resetToReady: () => void;
      run: () => void;
      moveBounds: () => { lo: number; hi: number };
      clawTX: number;
      heldKey: string;
    };
    machine.opts.outcome = async () => "miss";
    const { lo, hi } = machine.moveBounds();

    const aimAt = (tx: number): string => {
      machine.resetToReady();
      machine.run();
      machine.clawTX = tx;
      machine.onDrop(); // heldKey locks at drop start
      return machine.heldKey;
    };

    expect(aimAt(lo)).toBe("D"); // leftmost column
    expect(aimAt(hi)).toBe("K"); // rightmost column
    expect(aimAt((lo + hi) / 2)).toBe("E"); // center column
    expect(aimAt(lo)).toBe("D"); // repeatable — no RNG in selection

    // FIVE EQUAL bins (M4 review P2): every boundary, both sides.
    const span = hi - lo;
    const at = (f: number) => aimAt(lo + span * f);
    expect(at(0.199)).toBe("D");
    expect(at(0.201)).toBe("A");
    expect(at(0.399)).toBe("A");
    expect(at(0.401)).toBe("E");
    expect(at(0.599)).toBe("E");
    expect(at(0.601)).toBe("B");
    expect(at(0.799)).toBe("B");
    expect(at(0.801)).toBe("K");
    expect(at(1)).toBe("K"); // right edge clamps into the last bin

    adapter.destroy();
    cleanup();
  });

  it("a SUPERSEDED drop's outcome never crosses generations; the adapter replays late-committed results (M4 review P1)", async () => {
    const { ctx, cleanup } = createClawContext();
    const adapter = clawDefinition.create(ctx);
    await adapter.init(new AbortController().signal);
    adapter.start(practiceRun());

    const machine = (adapter as unknown as { machine: Record<string, unknown> })
      .machine as {
      opts: { outcome: () => Promise<string> };
      onDrop: () => void;
      resetToReady: () => void;
      run: () => void;
      pendingOutcome: string | null;
      dropOutcome: string;
    };
    let resolveFirst!: (o: string) => void;
    machine.opts.outcome = () =>
      new Promise<string>((resolve) => {
        resolveFirst = resolve;
      });

    machine.onDrop(); // generation N, provider pending
    // Timeout/reset path: the drop is superseded before resolution.
    machine.resetToReady();
    machine.run();

    // A NEW drop begins (generation N+1) with its own pending provider.
    let resolveSecond!: (o: string) => void;
    machine.opts.outcome = () =>
      new Promise<string>((resolve) => {
        resolveSecond = resolve;
      });
    machine.onDrop();

    // The OLD drop resolves now — it must not leak into the new drop.
    resolveFirst("win");
    await new Promise((r) => setTimeout(r, 0));
    expect(machine.pendingOutcome).toBeNull();

    // The new drop's own outcome still lands normally.
    resolveSecond("miss");
    await new Promise((r) => setTimeout(r, 0));
    expect(machine.pendingOutcome).toBe("miss");

    adapter.destroy();
    cleanup();
  });

  it("an outcome resolving AFTER destroy never starts a drop", async () => {
    const { ctx, cleanup } = createClawContext();
    const adapter = clawDefinition.create(ctx);
    await adapter.init(new AbortController().signal);
    adapter.start(practiceRun());

    // Reach into the machine (test-only) and install a deferred provider.
    const machine = (adapter as unknown as { machine: Record<string, unknown> })
      .machine as {
      opts: { outcome: () => Promise<string> };
      onDrop: () => void;
      phase: string;
    };
    let resolveOutcome!: (o: string) => void;
    machine.opts.outcome = () =>
      new Promise<string>((resolve) => {
        resolveOutcome = resolve;
      });

    machine.onDrop(); // descent begins NOW (M4); provider still pending
    expect(machine.phase).toBe("dropping");
    adapter.destroy();
    resolveOutcome("win");
    await new Promise((r) => setTimeout(r, 0));

    // Destroyed machine must stay INERT: the late outcome may not drive
    // the drop to a win, restart the loop, or run outcome segments.
    const dead = machine as unknown as {
      phase: string;
      running: boolean;
      pendingOutcome: string | null;
    };
    expect(dead.phase).not.toBe("won");
    expect(dead.running).toBe(false);
    expect(dead.pendingOutcome).toBeNull(); // .then guard dropped it
    cleanup();
  });
});
