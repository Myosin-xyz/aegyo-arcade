/**
 * Hostile conformance fixture (TECH_SPEC §6.1.2): a configurable game that
 * misbehaves on purpose — slow init, abort disrespect, init failure, global
 * listener/timer leaks, double-end. The conformance suite uses it both to
 * prove the contract handles bad citizens and to prove the LeakTracker
 * actually catches what a bad citizen leaves behind.
 */

import type {
  GameContext,
  GameDefinition,
  GameMeta,
  RunContext,
  ShellLoopGame,
} from "@/shell/contract";

export interface HostileOptions {
  /** Milliseconds init takes before resolving. */
  initDelayMs?: number;
  /** Throw from init after the delay. */
  failInit?: boolean;
  /** Fail only the first N inits (retry then succeeds). */
  failInitTimes?: number;
  /** Honor the abort signal during slow init (default true). */
  respectAbort?: boolean;
  /** Install a window listener during init and never remove it. */
  leakListener?: boolean;
  /** Start an interval during init and never clear it. */
  leakTimer?: boolean;
  /** Call report.end() twice at the end of the run. */
  endTwice?: boolean;
  /** Call report.end() SYNCHRONOUSLY from start() (M0 review edge). */
  endOnStart?: boolean;
  /** Throw from start() (host must fail closed — M1 review note). */
  throwOnStart?: boolean;
  /** End the run after this many update ticks (default 5). */
  endAfterTicks?: number;
}

export const hostileMeta: GameMeta = {
  id: "hostile-fixture",
  titleKey: "fixture.hostile.title",
  taglineKey: "fixture.hostile.tagline",
  surface: "dom",
  designBox: { w: 360, h: 640 },
  capabilities: { counted: false, prize: false },
};

export interface HostileProbe {
  initCalls: number;
  startCalls: number;
  pauseCalls: number;
  resumeCalls: number;
  destroyCalls: number;
  updateTicks: number;
  renders: number;
  /** Pointer + key events DELIVERED through the InputBus. */
  inputEvents: number;
  /** The most recent RunContext passed to start() (seed assertions). */
  lastRun: RunContext | null;
}

export function createHostileDefinition(options: HostileOptions = {}): {
  definition: GameDefinition;
  probe: HostileProbe;
} {
  const probe: HostileProbe = {
    initCalls: 0,
    startCalls: 0,
    pauseCalls: 0,
    resumeCalls: 0,
    destroyCalls: 0,
    updateTicks: 0,
    renders: 0,
    inputEvents: 0,
    lastRun: null,
  };

  class HostileGame implements ShellLoopGame {
    readonly loop = "shell" as const;
    private destroyed = false;
    private paused = false;
    private runTicks = 0;
    private ended = false;
    private pendingInitTimer: number | null = null;
    private leakInterval: number | null = null;

    constructor(private readonly ctx: GameContext) {}

    private inputUnsubscribers: (() => void)[] = [];

    async init(signal: AbortSignal): Promise<void> {
      probe.initCalls += 1;
      this.inputUnsubscribers.push(
        this.ctx.input.onPointer(() => {
          probe.inputEvents += 1;
        }),
        this.ctx.input.onKey(() => {
          probe.inputEvents += 1;
        }),
      );
      if (options.leakListener) {
        // Deliberately global and never removed.
        window.addEventListener("resize", () => undefined);
      }
      if (options.leakTimer) {
        this.leakInterval = window.setInterval(() => undefined, 1000);
      }
      if (options.initDelayMs) {
        await new Promise<void>((resolve, reject) => {
          this.pendingInitTimer = window.setTimeout(() => {
            this.pendingInitTimer = null;
            resolve();
          }, options.initDelayMs);
          if (options.respectAbort !== false) {
            signal.addEventListener(
              "abort",
              () => {
                if (this.pendingInitTimer !== null) {
                  clearTimeout(this.pendingInitTimer);
                  this.pendingInitTimer = null;
                }
                reject(new DOMException("aborted", "AbortError"));
              },
              { once: true },
            );
          }
        });
      }
      if (options.failInit) throw new Error("hostile init failure");
      if (
        options.failInitTimes !== undefined &&
        probe.initCalls <= options.failInitTimes
      ) {
        throw new Error("hostile init failure (transient)");
      }
    }

    start(run: RunContext): void {
      probe.startCalls += 1;
      probe.lastRun = run;
      if (options.throwOnStart) throw new Error("hostile start rejection");
      this.runTicks = 0;
      this.ended = false;
      if (options.endOnStart) {
        this.ended = true;
        this.ctx.report.end({ reason: "completed" });
      }
    }

    pause(): void {
      probe.pauseCalls += 1;
      this.paused = true;
    }

    resume(): void {
      probe.resumeCalls += 1;
      this.paused = false;
    }

    update(_dtMs: number): void {
      if (this.destroyed || this.paused || this.ended) return;
      probe.updateTicks += 1;
      this.runTicks += 1;
      const limit = options.endAfterTicks ?? 5;
      if (this.runTicks >= limit) {
        this.ended = true;
        this.ctx.report.score(this.runTicks);
        this.ctx.report.end({ reason: "completed" });
        if (options.endTwice) this.ctx.report.end({ reason: "completed" });
      }
    }

    render(_alpha: number): void {
      probe.renders += 1;
      if (this.ctx.surface.kind === "dom") {
        this.ctx.surface.root.textContent = `ticks:${this.runTicks}`;
      }
    }

    destroy(): void {
      probe.destroyCalls += 1;
      if (this.destroyed) return;
      this.destroyed = true;
      for (const unsubscribe of this.inputUnsubscribers) unsubscribe();
      this.inputUnsubscribers = [];
      if (this.pendingInitTimer !== null) {
        clearTimeout(this.pendingInitTimer);
        this.pendingInitTimer = null;
      }
      // NOTE: leakInterval/leakListener are deliberately NOT cleaned up when
      // the leak options are on — that's the point of the fixture.
      if (!options.leakTimer && this.leakInterval !== null) {
        clearInterval(this.leakInterval);
      }
    }
  }

  return {
    definition: {
      apiVersion: 1,
      meta: hostileMeta,
      create(ctx: GameContext) {
        return new HostileGame(ctx);
      },
    },
    probe,
  };
}
