/**
 * Freebie Frenzy — ShellLoopGame adapter (docs/games/freebie.md, M2.5).
 *
 * The shell owns the loop and canvas; this module accumulates to fixed
 * 60Hz steps over the pure logic core, feeds keyboard + drag input
 * through the InputBus, and reports score/end through the contract.
 * Counted completion is the portal default (generic-submit) — the
 * delivery's Supabase submission stack is deleted, not ported.
 */

import type {
  GameContext,
  GameDefinition,
  NormalizedPointer,
  RunContext,
  ShellLoopGame,
} from "@/shell/contract";
import { freebieMeta } from "./meta";
import {
  MISS_FLASH_SEC,
  STEP_MS,
  continueFromRecap,
  createFreebieState,
  step,
  type FreebieInput,
  type FreebieState,
  type Rng,
} from "./logic";
import { renderFreebie, type FreebieImages } from "./render";
import { arp, blip, sweep, thud } from "@/shell/sfx-presets";

const ASSETS_BASE = "/games/freebie/";
const TIER_COUNT = 6;

function loadImage(
  src: string,
  signal: AbortSignal,
): Promise<HTMLImageElement> {
  return new Promise((resolve, reject) => {
    if (signal.aborted) {
      reject(new DOMException("freebie init aborted", "AbortError"));
      return;
    }
    const img = new Image();
    const onAbort = () =>
      reject(new DOMException("freebie init aborted", "AbortError"));
    signal.addEventListener("abort", onAbort, { once: true });
    img.onload = () => {
      signal.removeEventListener("abort", onAbort);
      resolve(img);
    };
    img.onerror = () => {
      signal.removeEventListener("abort", onAbort);
      reject(new Error(`freebie asset failed: ${src}`));
    };
    img.src = src;
  });
}

class FreebieGame implements ShellLoopGame {
  readonly loop = "shell" as const;
  private state: FreebieState | null = null;
  private rng: Rng | null = null;
  private images: FreebieImages | null = null;
  private accumulator = 0;
  private paused = false;
  private endedReported = false;
  /** A fatal miss holds the run open for the red flash before game-over
   * (the delivery delayed game-over ~300ms for this — review P1). While
   * > 0 the sim is frozen and only the flash decays; end fires at 0. */
  private lostDelayMs = 0;
  private lastReportedScore = 0;
  private input: FreebieInput = { left: false, right: false, dragX: null };
  private dragging = false;
  private unsubscribers: (() => void)[] = [];

  constructor(private readonly ctx: GameContext) {}

  async init(signal: AbortSignal): Promise<void> {
    if (this.ctx.surface.kind !== "canvas") {
      throw new Error("freebie requires a canvas surface");
    }
    const [bg, hero, ...tiers] = await Promise.all([
      loadImage(`${ASSETS_BASE}bg.webp`, signal),
      loadImage(`${ASSETS_BASE}hero.webp`, signal),
      ...Array.from({ length: TIER_COUNT }, (_, i) =>
        loadImage(`${ASSETS_BASE}tier${i}.webp`, signal),
      ),
    ]);
    this.images = { bg, hero, tiers };
    this.ctx.audio.register("catch", blip(740, 0.06, "square", 0.045));
    this.ctx.audio.register("jackpot", arp([659, 831, 988, 1319], 0.06));
    this.ctx.audio.register("miss", thud(140, 0.13, 0.06));
    this.ctx.audio.register("clear", arp([523, 659, 784], 0.08));
    this.ctx.audio.register("win", arp([523, 659, 784, 1047, 1319], 0.07));
    this.ctx.audio.register("lose", sweep(440, 75, 0.32, "sawtooth", 0.045));
    this.unsubscribers.push(
      this.ctx.input.onPointer((p) => this.onPointer(p)),
      this.ctx.input.onKey((k) => {
        const down = k.action === "down";
        if (k.code === "ArrowLeft" || k.code === "KeyA") this.input.left = down;
        if (k.code === "ArrowRight" || k.code === "KeyD")
          this.input.right = down;
        if (down) this.maybeContinue();
      }),
    );
  }

  start(run: RunContext): void {
    this.rng = run.random;
    this.state = createFreebieState(run.random);
    this.accumulator = 0;
    this.endedReported = false;
    this.lostDelayMs = 0;
    this.lastReportedScore = 0;
    this.clearTransientInput(); // no gesture survives a restart
    this.input.left = false;
    this.input.right = false;
    this.ctx.report.score(0);
  }

  pause(): void {
    this.paused = true;
    // No gesture OR held key survives a pause: the host disables the
    // InputBus before pausing, so a keyup during the pause is silently
    // discarded — a stale `left/right = true` would glide the catcher
    // forever after resume (M2.5 review P1).
    this.clearTransientInput();
    this.input.left = false;
    this.input.right = false;
  }

  resume(): void {
    this.paused = false;
  }

  update(dtMs: number): void {
    const state = this.state;
    const rng = this.rng;
    if (!state || !rng || this.paused || this.endedReported) return;

    // Terminal-loss hold: keep the run open (loop alive, render painting)
    // so the red miss flash shows before game-over. The sim is frozen
    // (status is "lost"), so decay the flash here; report end once the
    // window elapses (review P1).
    if (this.lostDelayMs > 0) {
      this.lostDelayMs -= dtMs;
      state.missFlash = Math.max(0, state.missFlash - dtMs / 1000);
      if (this.lostDelayMs <= 0) {
        this.endedReported = true;
        this.ctx.report.end({ reason: "lost" });
      }
      return;
    }

    this.accumulator += dtMs;
    while (this.accumulator >= STEP_MS) {
      this.accumulator -= STEP_MS;
      const livesBefore = state.lives;
      const statusBefore = state.status;
      const jackpotBefore = state.callout?.kind === "jackpot";
      step(state, this.input, rng);
      if (state.score !== this.lastReportedScore) {
        // Level-clear bonus also lands here — the recap jingle covers it.
        if (state.status === "playing") {
          this.ctx.audio.play(
            !jackpotBefore && state.callout?.kind === "jackpot"
              ? "jackpot"
              : "catch",
          );
        }
        this.lastReportedScore = state.score;
        this.ctx.report.score(state.score);
      }
      if (state.lives < livesBefore && state.status === "playing") {
        this.ctx.audio.play("miss");
      }
      if (statusBefore === "playing" && state.status === "recap") {
        this.ctx.audio.play("clear");
      }
      if (state.status === "won") {
        this.endedReported = true;
        this.ctx.audio.play("win");
        this.ctx.report.end({ reason: "completed" });
        return;
      }
      if (state.status === "lost") {
        // Defer the end: arm the flash hold and play the jingle, but keep
        // the loop alive so the red flash paints (review P1). End fires
        // from the lostDelayMs branch above once the window elapses.
        this.lostDelayMs = MISS_FLASH_SEC * 1000;
        this.ctx.audio.play("lose");
        return;
      }
    }
  }

  render(): void {
    if (this.ctx.surface.kind !== "canvas" || !this.state || !this.images) {
      return;
    }
    renderFreebie(
      this.ctx.surface.context2d,
      this.state,
      this.images,
      (key, params) => this.ctx.t(key, params),
    );
  }

  destroy(): void {
    for (const unsubscribe of this.unsubscribers) unsubscribe();
    this.unsubscribers = [];
    this.state = null;
    this.images = null;
  }

  private onPointer(p: NormalizedPointer): void {
    if (p.action === "down") {
      this.maybeContinue();
      this.dragging = true;
      this.input.dragX = p.x;
    } else if (p.action === "move") {
      if (this.dragging) this.input.dragX = p.x;
    } else {
      this.clearTransientInput();
    }
  }

  /** Any press advances a level-recap overlay (in-run, not an end). */
  private maybeContinue(): void {
    const state = this.state;
    const rng = this.rng;
    if (!state || !rng || this.paused) return;
    continueFromRecap(state, rng);
  }

  private clearTransientInput(): void {
    this.dragging = false;
    this.input.dragX = null;
  }
}

export const freebieDefinition: GameDefinition = {
  apiVersion: 1,
  meta: freebieMeta,
  create(ctx: GameContext) {
    return new FreebieGame(ctx);
  },
};
