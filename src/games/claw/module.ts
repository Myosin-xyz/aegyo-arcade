/**
 * Aegyo Claw — GameDefinition adapter (TECH_SPEC §7.1).
 *
 * `loop: "module"` escape hatch: the claw keeps its own rAF loop, renderer,
 * input zones, and synth audio. The adapter maps the contract lifecycle onto
 * the refactored engine (load/run split, pause/resume, reset, idempotent
 * destroy).
 *
 * Outcome policy (§9.4; M1 review B1): the RUN MODE decides, not an env
 * flag. Practice runs draw locally and never touch the server or create DB
 * rows. Counted runs (issued by the M2 slot machinery) call the idempotent
 * server endpoint, consuming their attempt. Gameplay is identical either
 * way; only counted results persist.
 */

import type {
  GameContext,
  GameDefinition,
  ModuleLoopGame,
  RunContext,
} from "@/shell/contract";
import { clawMeta } from "./meta";
import { ClawMachine } from "./engine/engine";
import { randomOutcome, type OutcomeProvider } from "./engine/outcome";
import { serverOutcome } from "./server-outcome";
import { setAudioEnabled } from "./engine/audio";

const ASSETS_BASE = "/games/claw/";

class ClawAdapter implements ModuleLoopGame {
  readonly loop = "module" as const;
  private machine: ClawMachine | null = null;
  private started = false;
  private provider: OutcomeProvider = randomOutcome();
  private unsubscribeMute: (() => void) | null = null;
  private countedRun = false;
  private attemptConsumed = false;
  private endedReported = false;

  constructor(private readonly ctx: GameContext) {}

  async init(signal: AbortSignal): Promise<void> {
    if (this.ctx.surface.kind !== "canvas") {
      throw new Error("claw requires a canvas surface");
    }
    const machine = new ClawMachine({
      canvas: this.ctx.surface.canvas,
      stage: this.ctx.host,
      assetsBase: ASSETS_BASE,
      // Delegates so each run can swap practice/counted providers (B1).
      outcome: () => this.provider(),
      // Counted claw runs are GAME-OWNED (registry strategy). Terminal
      // order (M2 review P1): commit → presentation with input dead →
      // frame chain stops → report.end. Restart resumes exactly one chain.
      onDropComplete: () => {
        if (!this.countedRun || !this.attemptConsumed || this.endedReported) {
          return;
        }
        this.machine?.beginCountedFinale(() => {
          if (this.endedReported) return;
          this.endedReported = true;
          this.ctx.report.end({ reason: "completed" });
        });
      },
    });
    this.machine = machine;
    // Keep legacy module audio in sync with the bus at ALL times — init,
    // mid-run toggles, and resume (M1 review B6).
    setAudioEnabled(!this.ctx.audio.muted);
    this.unsubscribeMute = this.ctx.audio.onMutedChange((muted) =>
      setAudioEnabled(!muted),
    );
    const onAbort = () => machine.destroy();
    signal.addEventListener("abort", onAbort, { once: true });
    try {
      await machine.load();
      if (signal.aborted) {
        throw new DOMException("claw init aborted", "AbortError");
      }
    } finally {
      signal.removeEventListener("abort", onAbort);
    }
  }

  start(run: RunContext): void {
    const machine = this.machine;
    if (!machine) return;
    this.countedRun = run.mode !== "practice";
    this.attemptConsumed = false;
    this.endedReported = false;
    if (run.mode === "practice") {
      this.provider = randomOutcome();
    } else {
      // Non-practice MUST be server-authoritative. A malformed context
      // (no attempt id) fails CLOSED — never silently behaves like
      // practice (M1 review P1). The type system forbids it; this guard
      // catches hostile/JS callers.
      const attemptId: unknown = run.attemptId;
      if (typeof attemptId !== "string" || attemptId.length === 0) {
        throw new Error(`${run.mode} run without attemptId`);
      }
      const server = serverOutcome(attemptId, run.signal);
      this.provider = async () => {
        const outcome = await server();
        // 200 from /api/claw/plays = the attempt is COMMITTED server-side.
        this.attemptConsumed = true;
        return outcome;
      };
    }
    if (this.started) {
      // Restart in place: back to the attract state, loop already running.
      machine.resetToReady();
      machine.run();
      return;
    }
    this.started = true;
    machine.run();
  }

  pause(): void {
    this.machine?.pause();
  }

  resume(): void {
    this.machine?.resume();
  }

  destroy(): void {
    this.unsubscribeMute?.();
    this.unsubscribeMute = null;
    this.machine?.destroy();
    this.machine = null;
  }
}

export const clawDefinition: GameDefinition = {
  apiVersion: 1,
  meta: clawMeta,
  create(ctx: GameContext) {
    return new ClawAdapter(ctx);
  },
};
