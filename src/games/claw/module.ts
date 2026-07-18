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
import {
  ClawPlayRefusedError,
  randomOutcome,
  type OutcomeProvider,
} from "./engine/outcome";
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
  /** Outcome that resolved AFTER the engine gave up waiting (M4 review
   * P1): the attempt is committed server-side, so the next drop must
   * play THIS result instead of opening a new operation. */
  private lateOutcome: import("./engine/types").Outcome | null = null;

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
        // The outcome the engine just played is no longer "late" — it
        // was presented; nothing to replay on a future drop.
        this.lateOutcome = null;
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
    this.lateOutcome = null;
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
        if (this.lateOutcome !== null) {
          // A previous drop's outcome landed after its dwell timed out —
          // committed server-side, so replay it rather than re-request.
          const outcome = this.lateOutcome;
          this.lateOutcome = null;
          return outcome;
        }
        try {
          const outcome = await server();
          // 200 from /api/claw/plays = the attempt is COMMITTED
          // server-side.
          this.attemptConsumed = true;
          this.lateOutcome = outcome; // engine consumption clears it below
          return outcome;
        } catch (error) {
          if (error instanceof ClawPlayRefusedError && !this.endedReported) {
            // Terminal refusal (invalid_attempt / daily_slot_used /
            // cap_reached / promotion inactive): no Drop press can ever
            // succeed — end the run honestly instead of looping TRY
            // AGAIN (M4 review P2). Route through the audited counted
            // finale (M2 P1 terminal boundary): input dies NOW, the
            // UNAVAILABLE flash completes, the frame chain stops, and
            // only THEN is "quit" reported — reporting from this catch
            // would leave the module's private rAF loop and window keys
            // alive behind the host's ended overlay. reason "quit" also
            // keeps the host from rendering a false "saved" receipt.
            this.machine?.beginCountedFinale(() => {
              if (this.endedReported) return;
              this.endedReported = true;
              this.ctx.report.end({ reason: "quit" });
            });
          }
          throw error;
        }
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
