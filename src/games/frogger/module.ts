/**
 * Cross to the Concert — ShellLoopGame adapter (docs/games/frogger.md, M3).
 *
 * Fixed 60Hz steps over the pure logic core. Input is EDGE-TRIGGERED
 * (instant snap moves, delivery parity — no held state, so nothing can
 * survive a pause): ArrowUp/Space = forward, ArrowDown = back, plus tap
 * zones on the delivered control strip (left half BACK, right half
 * FORWARD). Counted completion is the portal default (generic-submit);
 * score envelope 0–30 per the booked ranking decision (5 levels since
 * 2026-07-27).
 */

import type {
  GameContext,
  GameDefinition,
  NormalizedPointer,
  RunContext,
  ShellLoopGame,
} from "@/shell/contract";
import { froggerMeta } from "./meta";
import {
  GAME_H,
  GAME_W,
  STEP_MS,
  createFroggerState,
  move,
  step,
  type FroggerState,
  type Rng,
} from "./logic";
import { renderFrogger, type FroggerImages } from "./render";
import { arp, blip, sweep, thud } from "@/shell/sfx-presets";
import {
  createHitFeedback,
  drawHitFlash,
  shakeOffset,
  tickHitFeedback,
  triggerHitFeedback,
} from "@/shell/feedback";

const ASSETS_BASE = "/games/frogger/";

function loadImage(
  src: string,
  signal: AbortSignal,
): Promise<HTMLImageElement> {
  return new Promise((resolve, reject) => {
    if (signal.aborted) {
      reject(new DOMException("frogger init aborted", "AbortError"));
      return;
    }
    const img = new Image();
    const onAbort = () =>
      reject(new DOMException("frogger init aborted", "AbortError"));
    signal.addEventListener("abort", onAbort, { once: true });
    img.onload = () => {
      signal.removeEventListener("abort", onAbort);
      resolve(img);
    };
    img.onerror = () => {
      signal.removeEventListener("abort", onAbort);
      reject(new Error(`frogger asset failed: ${src}`));
    };
    img.src = src;
  });
}

class FroggerGame implements ShellLoopGame {
  readonly loop = "shell" as const;
  private state: FroggerState | null = null;
  private rng: Rng | null = null;
  private images: FroggerImages | null = null;
  private accumulator = 0;
  private hitFx = createHitFeedback();
  /** Terminal-loss hold: the flash must PAINT before report.end stops
   * the loop (audit P1 — the flappy endRun lesson, loss-side). */
  private endHoldMs = 0;
  private paused = false;
  private endedReported = false;
  private lastReportedScore = 0;
  private unsubscribers: (() => void)[] = [];

  constructor(private readonly ctx: GameContext) {}

  async init(signal: AbortSignal): Promise<void> {
    if (this.ctx.surface.kind !== "canvas") {
      throw new Error("frogger requires a canvas surface");
    }
    const names = [
      "bg",
      "controls",
      "hero",
      "checkpoint",
      "denied",
      "congrats",
      "bollards",
      "golf",
      "merch",
      "scalper",
      "kfood",
      "guard",
    ] as const;
    const loaded = await Promise.all(
      names.map((name) => loadImage(`${ASSETS_BASE}${name}.webp`, signal)),
    );
    const [bg, controls, hero, checkpoint, denied, congrats, bollards] = loaded;
    this.images = {
      bg,
      controls,
      hero,
      checkpoint,
      denied,
      congrats,
      bollards,
      lanes: {
        golf: loaded[7],
        merch: loaded[8],
        scalper: loaded[9],
        kfood: loaded[10],
        guard: loaded[11],
      },
    };
    this.ctx.audio.register("hop", blip(620, 0.05, "square", 0.04));
    this.ctx.audio.register("hit", thud(150, 0.16, 0.06));
    this.ctx.audio.register("level", arp([523, 784], 0.09));
    this.ctx.audio.register("win", arp([523, 659, 784, 1047, 1319], 0.07));
    this.ctx.audio.register("lose", sweep(420, 70, 0.32, "sawtooth", 0.045));
    this.unsubscribers.push(
      this.ctx.input.onPointer((p) => this.onPointer(p)),
      this.ctx.input.onKey((k) => {
        if (k.action !== "down") return;
        if (k.code === "ArrowUp" || k.code === "Space") this.tryMove(-1);
        if (k.code === "ArrowDown") this.tryMove(1);
      }),
    );
  }

  start(run: RunContext): void {
    this.rng = run.random;
    this.state = createFroggerState(run.random);
    this.accumulator = 0;
    this.endedReported = false;
    this.hitFx = createHitFeedback();
    this.endHoldMs = 0;
    this.lastReportedScore = 0;
    this.ctx.report.score(0);
  }

  pause(): void {
    // Moves are edge-triggered — no held state exists to clear, and
    // tryMove() rejects input while paused.
    this.paused = true;
  }

  resume(): void {
    this.paused = false;
  }

  update(dtMs: number): void {
    const state = this.state;
    const rng = this.rng;
    if (!state || !rng || this.paused || this.endedReported) return;
    tickHitFeedback(this.hitFx, dtMs);
    this.accumulator += dtMs;
    while (this.accumulator >= STEP_MS) {
      this.accumulator -= STEP_MS;
      const livesBefore = state.lives;
      const levelBefore = state.level;
      step(state, rng);
      if (state.lives < livesBefore && state.status !== "playing") {
        triggerHitFeedback(this.hitFx); // the fatal 3rd hit flashes too
      }
      if (state.lives < livesBefore && state.status === "playing") {
        this.ctx.audio.play("hit");
        triggerHitFeedback(this.hitFx);
      }
      if (state.level > levelBefore) this.ctx.audio.play("level");
      if (state.score !== this.lastReportedScore) {
        this.lastReportedScore = state.score;
        this.ctx.report.score(state.score);
      }
      const status = state.status;
      if (status === "won" || status === "lost") {
        if (!this.endedReported) {
          if (
            status === "lost" &&
            this.endHoldMs === 0 &&
            this.hitFx.flashMs > 0
          ) {
            this.endHoldMs = 300; // let the fatal-hit wash paint first
          }
          if (this.endHoldMs > 0) {
            this.endHoldMs = Math.max(0, this.endHoldMs - dtMs);
            if (this.endHoldMs > 0) return;
          }
          this.endedReported = true;
          this.ctx.audio.play(status === "won" ? "win" : "lose");
          this.ctx.report.end({
            reason: status === "won" ? "completed" : "lost",
          });
        }
        return;
      }
    }
  }

  render(): void {
    if (this.ctx.surface.kind !== "canvas" || !this.state || !this.images) {
      return;
    }
    const g = this.ctx.surface.context2d;
    const off = shakeOffset(this.hitFx);
    g.save();
    g.translate(off.x, off.y);
    renderFrogger(g, this.state, this.images, (key, params) =>
      this.ctx.t(key, params),
    );
    g.restore();
    drawHitFlash(g, this.hitFx, 360, 552);
  }

  destroy(): void {
    for (const unsubscribe of this.unsubscribers) unsubscribe();
    this.unsubscribers = [];
    this.state = null;
    this.images = null;
  }

  private onPointer(p: NormalizedPointer): void {
    if (p.action !== "down") return;
    // Delivered control strip below the playfield: left half BACK,
    // right half FORWARD.
    if (p.y < GAME_H) return;
    this.tryMove(p.x < GAME_W / 2 ? 1 : -1);
  }

  private tryMove(delta: -1 | 1): void {
    const state = this.state;
    if (!state || this.paused || this.endedReported) return;
    const rowBefore = state.row;
    move(state, delta);
    if (state.row !== rowBefore) this.ctx.audio.play("hop");
  }
}

export const froggerDefinition: GameDefinition = {
  apiVersion: 1,
  meta: froggerMeta,
  create(ctx: GameContext) {
    return new FroggerGame(ctx);
  },
};
