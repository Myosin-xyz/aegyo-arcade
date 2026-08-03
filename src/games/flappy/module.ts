/**
 * Bias Flap — ShellLoopGame adapter (docs/games/bias-flap.md).
 *
 * The shell owns the loop and canvas; this module feeds real time into
 * the pure core and wires input through the InputBus. Tap anywhere (or
 * Space/ArrowUp/KeyW) flaps; the exit HUD zone opens the cash-out confirm;
 * level breaks advance on tap. Crash does NOT end the run — only victory
 * or a confirmed cash-out reports `end`, so unlimited retries and the
 * leave-and-save path both match the delivery.
 */

import type {
  GameContext,
  GameDefinition,
  NormalizedPointer,
  RunContext,
} from "@/shell/contract";
import { flappyMeta } from "./meta";
import {
  cashOut,
  continueFromLevelBreak,
  createFlappyState,
  flap,
  keepFlying,
  openQuitConfirm,
  step,
  type FlappyState,
  type Rng,
} from "./logic";
import {
  leaveRect,
  quitConfirmRects,
  renderFlappy,
  type FlappyImages,
  type Heart,
} from "./render";
import { arp, blip, sweep, thud } from "@/shell/sfx-presets";
import {
  createHitFeedback,
  drawHitFlash,
  shakeOffset,
  tickHitFeedback,
  triggerHitFeedback,
} from "@/shell/feedback";

const ASSETS_BASE = "/games/flappy/";
const CRASH_PHRASES = 3;
const TOAST_MS = 1000;

interface Rect {
  x: number;
  y: number;
  w: number;
  h: number;
}

const within = (p: { x: number; y: number }, r: Rect): boolean =>
  p.x >= r.x && p.x <= r.x + r.w && p.y >= r.y && p.y <= r.y + r.h;

function loadImage(
  src: string,
  signal: AbortSignal,
): Promise<HTMLImageElement> {
  return new Promise((resolve, reject) => {
    if (signal.aborted) {
      reject(new DOMException("flappy init aborted", "AbortError"));
      return;
    }
    const img = new Image();
    const onAbort = () =>
      reject(new DOMException("flappy init aborted", "AbortError"));
    signal.addEventListener("abort", onAbort, { once: true });
    img.onload = () => {
      signal.removeEventListener("abort", onAbort);
      resolve(img);
    };
    img.onerror = () => {
      signal.removeEventListener("abort", onAbort);
      reject(new Error(`flappy asset failed: ${src}`));
    };
    img.src = src;
  });
}

class FlappyGame {
  readonly loop = "shell" as const;
  private state: FlappyState | null = null;
  private rng: Rng | null = null;
  private images: FlappyImages | null = null;
  private paused = false;
  private endedReported = false;
  private lastScore = -1;
  private hearts: Heart[] = [];
  private toast: string | null = null;
  private toastMs = 0;
  private crashPhraseIndex = 0;
  private hitFx = createHitFeedback();
  private unsubscribers: (() => void)[] = [];

  constructor(private readonly ctx: GameContext) {}

  async init(signal: AbortSignal): Promise<void> {
    this.ctx.audio.register("flap", blip(660, 0.05, "triangle", 0.035));
    this.ctx.audio.register("gate", blip(880, 0.06, "triangle", 0.045));
    this.ctx.audio.register("crash", thud(110, 0.2, 0.05));
    this.ctx.audio.register("levelUp", arp([523, 659, 784, 1047], 0.07));
    this.ctx.audio.register("win", arp([659, 784, 988, 1319], 0.08));
    this.ctx.audio.register("cashout", sweep(700, 350, 0.2, "sine", 0.04));

    const [bg, hero, heart, stickUp, stickDown] = await Promise.all([
      loadImage(`${ASSETS_BASE}bg.webp`, signal),
      loadImage(`${ASSETS_BASE}hero.webp`, signal),
      loadImage(`${ASSETS_BASE}coeur.webp`, signal),
      loadImage(`${ASSETS_BASE}stick-up.webp`, signal),
      loadImage(`${ASSETS_BASE}stick-down.webp`, signal),
    ]);
    this.images = { bg, hero, heart, stickUp, stickDown };

    this.unsubscribers.push(
      this.ctx.input.onKey((k) => {
        if (k.action !== "down" || this.paused) return;
        const state = this.state;
        const rng = this.rng;
        if (!state || !rng) return;
        const flapKey =
          k.code === "Space" || k.code === "ArrowUp" || k.code === "KeyW";
        // Keyboard must reach EVERY state a pointer can (review P2: flap
        // keys alone stranded keyboard players at the first level break).
        if (state.status === "levelBreak") {
          if (flapKey || k.code === "Enter") {
            continueFromLevelBreak(state, rng);
          }
          return;
        }
        if (state.status === "quitConfirm") {
          if (k.code === "Escape") keepFlying(state);
          else if (k.code === "Enter") {
            cashOut(state);
            if (!this.endedReported) this.endRun("cashout", "quit");
          }
          return;
        }
        if (k.code === "Escape") {
          openQuitConfirm(state);
          return;
        }
        if (flapKey) this.doFlap();
      }),
      this.ctx.input.onPointer((p) => this.onPointer(p)),
    );
  }

  start(run: RunContext): void {
    this.rng = run.random;
    this.state = createFlappyState(run.random);
    this.endedReported = false;
    this.hitFx = createHitFeedback();
    this.lastScore = -1;
    this.hearts = [];
    this.toast = null;
    this.toastMs = 0;
    this.ctx.report.score(0);
  }

  pause(): void {
    this.paused = true;
  }

  resume(): void {
    this.paused = false;
  }

  update(dtMs: number): void {
    const state = this.state;
    const rng = this.rng;
    if (!state || !rng || this.paused) return;
    if (state.status === "won" || state.status === "cashedOut") return;

    const before = state.status;
    // step() RETURNS the new status; re-reading state.status keeps
    // TypeScript's pre-call narrowing and dead-ends the comparisons.
    const after = step(state, dtMs, rng);
    tickHitFeedback(this.hitFx, dtMs);

    if (state.score !== this.lastScore) {
      // Gains chirp; the crash ROLLBACK must not (it also reports, so
      // the counted submit always carries the rolled-back truth).
      if (state.score > this.lastScore && this.lastScore >= 0) {
        this.ctx.audio.play("gate");
      }
      this.lastScore = state.score;
      this.ctx.report.score(state.score);
    }

    if (before === "flying" && after === "crashed") {
      this.ctx.audio.play("crash");
      triggerHitFeedback(this.hitFx); // red wash + shake (Daidai)
      this.crashPhraseIndex = (this.crashPhraseIndex % CRASH_PHRASES) + 1;
      this.toast = this.ctx.t(`game.flappy.crash.${this.crashPhraseIndex}`);
      this.toastMs = TOAST_MS + 850;
    }
    if (before === "flying" && after === "levelBreak") {
      this.ctx.audio.play("levelUp");
    }

    if (this.toastMs > 0) {
      this.toastMs -= dtMs;
      if (this.toastMs <= 0) this.toast = null;
    }

    // Ambient heart trail while flying (delivery: 10% per frame) —
    // cosmetic, so plain Math.random, never the run's seeded stream.
    if (after === "flying" && Math.random() < 0.1 * (dtMs / (1000 / 60))) {
      this.spawnHeart();
    }
    for (const h of this.hearts) {
      const f = dtMs / (1000 / 60);
      h.x += h.vx * f;
      h.y += h.vy * f;
      h.a -= 0.016 * f;
    }
    this.hearts = this.hearts.filter((h) => h.a > 0);

    if (after === "won" && !this.endedReported) {
      this.endRun("win", "completed");
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
    renderFlappy(
      g,
      this.state,
      this.images,
      this.hearts,
      this.ctx.t,
      this.toast,
    );
    g.restore();
    drawHitFlash(g, this.hitFx, 360, 640);
  }

  destroy(): void {
    for (const unsubscribe of this.unsubscribers) unsubscribe();
    this.unsubscribers = [];
    this.state = null;
    this.images = null;
  }

  /**
   * Terminal exit — the LAST frame must be painted BEFORE report.end:
   * the host stops the shell loop inside end(), so a frame queued for
   * "after this update" never draws and the canvas would freeze on the
   * pre-terminal state (caught at the 320×568 walk: the ended screen
   * still showed the quit confirm).
   */
  private endRun(sound: string, reason: "completed" | "quit"): void {
    this.endedReported = true;
    this.ctx.audio.play(sound);
    this.render();
    this.ctx.report.end({ reason });
  }

  private doFlap(): void {
    const state = this.state;
    if (!state) return;
    if (flap(state)) {
      this.ctx.audio.play("flap");
      this.spawnHeart();
    }
  }

  private spawnHeart(): void {
    const state = this.state;
    if (!state) return;
    this.hearts.push({
      x: 108 - 48.6 * 0.25,
      y: state.heroY + 42.8 * 0.3,
      vx: -1.1 - Math.random() * 0.6,
      vy: 0.25 + Math.random() * 0.5,
      s: 360 * (0.035 + Math.random() * 0.02),
      a: 1,
    });
  }

  private onPointer(p: NormalizedPointer): void {
    const state = this.state;
    const rng = this.rng;
    if (!state || !rng || this.paused) return;
    if (p.action !== "down") return;

    if (state.status === "levelBreak") {
      continueFromLevelBreak(state, rng);
      return;
    }
    if (state.status === "quitConfirm") {
      const zones = quitConfirmRects();
      if (within(p, zones.keep)) {
        keepFlying(state);
      } else if (within(p, zones.leave)) {
        cashOut(state);
        if (!this.endedReported) this.endRun("cashout", "quit");
      }
      return; // taps outside the zones do nothing — no accidental exits
    }
    // The exit zone opens the confirm; anywhere else flaps.
    if (
      (state.status === "flying" || state.status === "waiting") &&
      within(p, leaveRect())
    ) {
      openQuitConfirm(state);
      return;
    }
    this.doFlap();
  }
}

export const flappyDefinition: GameDefinition = {
  apiVersion: 1,
  meta: flappyMeta,
  create(ctx: GameContext) {
    return new FlappyGame(ctx);
  },
};
