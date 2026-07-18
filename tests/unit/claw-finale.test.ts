/**
 * Counted-claw terminal boundary (M2 review P1): after the server outcome
 * commits, the result presentation must COMPLETE with gameplay input dead,
 * then the module frame chain stops, then report.end fires — and restart
 * resumes exactly one chain. Forced win / drop / miss, real engine +
 * adapter, manual rAF + clock so presentation timing is provable.
 */

import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import type { GameContext, RunContext } from "@/shell/contract";
import { createAudioBus } from "@/shell/audio";
import { createInputBus } from "@/shell/input";
import { clawDefinition } from "@/games/claw/module";
import type { Manifest, Outcome } from "@/games/claw/engine/types";

const WIN_HOLD_MS = 4200; // engine's win-board hold (presentation, win)
const FLASH_MS = 1300; // engine's miss/drop toast (presentation, loss)
const STEP_MS = 40; // per-frame advance, under the 50ms clamp

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
    clawPlush: { D: rect(40, 10) },
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

/** Peek at engine internals the assertions need (test-only). */
interface EngineProbe {
  phase: string;
  flashT: number;
  heldDir: number;
  clawTX: number;
  onDrop(): void;
}

function flushAsync(rounds = 4): Promise<void> {
  let p = Promise.resolve();
  for (let i = 0; i < rounds; i++) {
    p = p.then(() => new Promise<void>((r) => setTimeout(r, 0)));
  }
  return p;
}

describe("claw counted finale — terminal boundary per forced outcome", () => {
  let clock: number;
  let rafQueue: Map<number, FrameRequestCallback>;
  let rafId: number;
  let playsCalls: number;
  let forcedOutcome: Outcome;
  let cleanupDom: (() => void) | null;

  beforeEach(() => {
    clock = 10_000;
    rafId = 0;
    rafQueue = new Map();
    playsCalls = 0;
    forcedOutcome = "miss";
    cleanupDom = null;
    stubCanvas2d();
    vi.stubGlobal("Image", FakeImage);
    vi.stubGlobal("requestAnimationFrame", (cb: FrameRequestCallback) => {
      rafQueue.set(++rafId, cb);
      return rafId;
    });
    vi.stubGlobal("cancelAnimationFrame", (id: number) => {
      rafQueue.delete(id);
    });
    vi.spyOn(performance, "now").mockImplementation(() => clock);
    vi.stubGlobal(
      "fetch",
      vi.fn(async (url: string | URL | Request) => {
        const href = String(url);
        if (href.endsWith("manifest.json")) {
          return new Response(JSON.stringify(fakeManifest()), { status: 200 });
        }
        if (href.includes("/api/session")) {
          return new Response("{}", { status: 200 });
        }
        if (href.includes("/api/claw/plays")) {
          playsCalls++;
          return new Response(
            JSON.stringify({ outcome: forcedOutcome, ordinal: 1 }),
            { status: 200 },
          );
        }
        throw new Error(`unexpected fetch: ${href}`);
      }),
    );
  });

  afterEach(() => {
    cleanupDom?.();
    vi.unstubAllGlobals();
    vi.restoreAllMocks();
    document.body.replaceChildren();
  });

  /** Advance the clock one frame and fire every queued rAF callback. */
  function step(): void {
    clock += STEP_MS;
    const due = [...rafQueue.entries()];
    rafQueue.clear();
    for (const [, cb] of due) cb(clock);
  }

  async function stepUntil(
    predicate: () => boolean,
    maxFrames = 1200,
  ): Promise<void> {
    for (let i = 0; i < maxFrames; i++) {
      if (predicate()) return;
      step();
      await flushAsync(1);
    }
    throw new Error("stepUntil: condition never became true");
  }

  async function setup(outcome: Outcome) {
    forcedOutcome = outcome;
    const host = document.createElement("div");
    document.body.appendChild(host);
    const canvas = document.createElement("canvas");
    host.appendChild(canvas);
    const input = createInputBus({
      target: canvas,
      toDesign: (x, y) => ({ x, y }),
    });
    const audio = createAudioBus();
    const endCalls: string[] = [];
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
      report: {
        score: () => undefined,
        end: (payload) => {
          endCalls.push(payload?.reason ?? "missing-reason");
        },
      },
    };
    cleanupDom = () => {
      input.destroy();
      audio.destroy();
      host.remove();
    };
    const adapter = clawDefinition.create(ctx);
    await adapter.init(new AbortController().signal);
    await flushAsync();
    const machine = (adapter as unknown as { machine: unknown })
      .machine as EngineProbe;
    const countedRun: RunContext = {
      mode: "counted",
      attemptId: "finale-attempt-1",
      seed: "claw-finale",
      random: Math.random,
      signal: new AbortController().signal,
    };
    adapter.start(countedRun);
    return { adapter, machine, canvas, endCalls };
  }

  function pressKey(key: string): void {
    // The legacy claw adapter maps by e.key — set both for realism.
    window.dispatchEvent(
      new KeyboardEvent("keydown", { key, code: key, bubbles: true }),
    );
  }

  for (const outcome of ["win", "drop", "miss"] as Outcome[]) {
    it(`${outcome}: presentation completes input-dead, chain stops, end fires once, restart resumes one chain`, async () => {
      const { adapter, machine, canvas, endCalls } = await setup(outcome);
      expect(rafQueue.size).toBe(1); // counted run started one chain

      // Trigger the drop; the provider resolves against the stubbed server.
      step();
      machine.onDrop();
      await flushAsync();
      await stepUntil(() => machine.phase === "dropping");
      expect(playsCalls).toBe(1);

      // Presentation start: win board or loss flash, per forced outcome.
      const presenting = () =>
        outcome === "win"
          ? machine.phase === "won"
          : machine.phase === "ready" && machine.flashT > 0;
      await stepUntil(presenting);
      const presentationStart = clock;
      expect(endCalls).toHaveLength(0); // end must NOT fire at drop-complete

      // Gameplay input is dead during the presentation.
      const clawXBefore = machine.clawTX;
      pressKey("ArrowLeft");
      canvas.dispatchEvent(
        new MouseEvent("pointerdown", { clientX: 50, clientY: 75 }),
      );
      step();
      await flushAsync(1);
      expect(machine.heldDir).toBe(0);
      expect(machine.clawTX).toBe(clawXBefore);
      if (outcome === "win") expect(machine.phase).toBe("won"); // no tap-replay

      // The presentation runs to completion, THEN end fires — exactly once.
      await stepUntil(() => endCalls.length > 0);
      expect(endCalls).toEqual(["completed"]);
      const minHold = outcome === "win" ? WIN_HOLD_MS : FLASH_MS;
      expect(clock - presentationStart).toBeGreaterThanOrEqual(minHold);

      // Terminal state: no frame chain remains, ended input is inert.
      expect(rafQueue.size).toBe(0);
      pressKey(" ");
      machine.onDrop();
      canvas.dispatchEvent(
        new MouseEvent("pointerdown", { clientX: 50, clientY: 75 }),
      );
      await flushAsync();
      expect(playsCalls).toBe(1); // no second outcome attempt
      expect(endCalls).toHaveLength(1);
      expect(rafQueue.size).toBe(0);

      // Restart (play again → practice) resumes EXACTLY one frame chain.
      adapter.start({
        mode: "practice",
        attemptId: null,
        seed: "after-finale",
        random: Math.random,
        signal: new AbortController().signal,
      });
      expect(rafQueue.size).toBe(1);
      step();
      expect(rafQueue.size).toBe(1); // still a single chain per frame
      expect(machine.phase).toBe("ready");
      // Input is live again after the reset.
      pressKey("ArrowLeft");
      step();
      expect(machine.heldDir).toBe(-1);
      adapter.destroy();
    });
  }
});
