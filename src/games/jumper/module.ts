/** Comeback Climb — ShellLoopGame port of DaiDai's delivered build. */

import type {
  GameContext,
  GameDefinition,
  NormalizedPointer,
  RunContext,
  ShellLoopGame,
} from "@/shell/contract";
import { jumperMeta } from "./meta";
import {
  applyThumbImpulse,
  createJumperState,
  step,
  STEP_MS,
  type JumperInput,
  type JumperState,
  type Rng,
} from "./logic";
import { renderJumper, type JumperImages } from "./render";
import { arp, blip, sweep, thud } from "@/shell/sfx-presets";
import {
  createHitFeedback,
  drawHitFlash,
  shakeOffset,
  tickHitFeedback,
  triggerHitFeedback,
} from "@/shell/feedback";

const ASSETS_BASE = "/games/jumper/";
const TERMINAL_HOLD_MS = 300;

const ASSET_NAMES = [
  "cd",
  "drone",
  "heart_bonus",
  "heart_small",
  "hero",
  "micro",
  "note_cyan",
  "note_gold",
  "photocard",
  "photocard_cracked",
  "plat_cyan",
  "plat_pink",
  "speaker",
] as const satisfies readonly (keyof JumperImages)[];

function loadImage(
  src: string,
  signal: AbortSignal,
): Promise<HTMLImageElement> {
  return new Promise((resolve, reject) => {
    if (signal.aborted) {
      reject(new DOMException("jumper init aborted", "AbortError"));
      return;
    }
    const image = new Image();
    const onAbort = () =>
      reject(new DOMException("jumper init aborted", "AbortError"));
    signal.addEventListener("abort", onAbort, { once: true });
    image.onload = () => {
      signal.removeEventListener("abort", onAbort);
      resolve(image);
    };
    image.onerror = () => {
      signal.removeEventListener("abort", onAbort);
      reject(new Error(`jumper asset failed: ${src}`));
    };
    image.src = src;
  });
}

class JumperGame implements ShellLoopGame {
  readonly loop = "shell" as const;
  private state: JumperState | null = null;
  private rng: Rng | null = null;
  private images: JumperImages | null = null;
  private input: JumperInput = { left: false, right: false };
  private accumulator = 0;
  private hitFx = createHitFeedback();
  private terminalHoldMs = 0;
  private paused = false;
  private endedReported = false;
  private lastReportedScore = 0;
  private unsubscribers: (() => void)[] = [];

  constructor(private readonly ctx: GameContext) {}

  async init(signal: AbortSignal): Promise<void> {
    if (this.ctx.surface.kind !== "canvas") {
      throw new Error("jumper requires a canvas surface");
    }
    const loaded = await Promise.all(
      ASSET_NAMES.map((name) =>
        loadImage(`${ASSETS_BASE}${name}.webp`, signal),
      ),
    );
    this.images = Object.fromEntries(
      ASSET_NAMES.map((name, index) => [name, loaded[index]]),
    ) as unknown as JumperImages;
    this.ctx.audio.register("bounce", sweep(210, 430, 0.08, "triangle", 0.035));
    this.ctx.audio.register("speaker", arp([330, 523, 784], 0.055));
    this.ctx.audio.register("collect", blip(988, 0.06, "square", 0.04));
    this.ctx.audio.register("hit", thud(140, 0.13, 0.06));
    this.ctx.audio.register("zone", arp([523, 659, 784], 0.07));
    this.ctx.audio.register("win", arp([523, 659, 784, 1047, 1319], 0.07));
    this.ctx.audio.register("lose", sweep(460, 70, 0.3, "sawtooth", 0.045));
    this.unsubscribers.push(
      this.ctx.input.onPointer((pointer) => this.onPointer(pointer)),
      this.ctx.input.onKey((key) => {
        const down = key.action === "down";
        if (
          key.code === "ArrowLeft" ||
          key.code === "KeyA" ||
          key.code === "KeyQ"
        ) {
          this.input.left = down;
        }
        if (key.code === "ArrowRight" || key.code === "KeyD") {
          this.input.right = down;
        }
      }),
    );
  }

  start(run: RunContext): void {
    this.rng = run.random;
    this.state = createJumperState(run.random);
    this.input = { left: false, right: false };
    this.accumulator = 0;
    this.hitFx = createHitFeedback();
    this.terminalHoldMs = 0;
    this.paused = false;
    this.endedReported = false;
    this.lastReportedScore = 0;
    this.ctx.report.score(0);
  }

  pause(): void {
    this.paused = true;
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
    tickHitFeedback(this.hitFx, dtMs);

    if (this.terminalHoldMs > 0) {
      this.terminalHoldMs = Math.max(0, this.terminalHoldMs - dtMs);
      if (this.terminalHoldMs === 0) this.reportTerminal();
      return;
    }

    this.accumulator += dtMs;
    while (this.accumulator >= STEP_MS) {
      this.accumulator -= STEP_MS;
      const events = step(state, this.input, rng);
      if (events.bounce === "speaker") this.ctx.audio.play("speaker");
      else if (events.bounce) this.ctx.audio.play("bounce");
      if (events.collected) this.ctx.audio.play("collect");
      if (events.zoneChanged) this.ctx.audio.play("zone");
      if (events.hit) {
        this.ctx.audio.play("hit");
        triggerHitFeedback(this.hitFx);
      }
      if (state.score !== this.lastReportedScore) {
        this.lastReportedScore = state.score;
        this.ctx.report.score(state.score);
      }
      if (events.ended) {
        if (events.ended === "lost") {
          this.terminalHoldMs = TERMINAL_HOLD_MS;
          return;
        }
        this.reportTerminal();
        return;
      }
    }
  }

  render(): void {
    if (this.ctx.surface.kind !== "canvas" || !this.state || !this.images) {
      return;
    }
    const g = this.ctx.surface.context2d;
    const offset = shakeOffset(this.hitFx);
    g.save();
    g.translate(offset.x, offset.y);
    renderJumper(g, this.state, this.images, (key) => this.ctx.t(key));
    g.restore();
    drawHitFlash(g, this.hitFx, 360, 640);
  }

  destroy(): void {
    for (const unsubscribe of this.unsubscribers) unsubscribe();
    this.unsubscribers = [];
    this.state = null;
    this.images = null;
    this.input = { left: false, right: false };
  }

  private onPointer(pointer: NormalizedPointer): void {
    if (
      pointer.action !== "down" ||
      this.paused ||
      this.terminalHoldMs > 0 ||
      !this.state
    ) {
      return;
    }
    applyThumbImpulse(this.state, pointer.x);
  }

  private reportTerminal(): void {
    if (!this.state || this.endedReported) return;
    this.endedReported = true;
    const completed = this.state.status === "won";
    this.ctx.audio.play(completed ? "win" : "lose");
    this.ctx.report.end({ reason: completed ? "completed" : "lost" });
  }
}

export const jumperDefinition: GameDefinition = {
  apiVersion: 1,
  meta: jumperMeta,
  create(ctx: GameContext) {
    return new JumperGame(ctx);
  },
};
