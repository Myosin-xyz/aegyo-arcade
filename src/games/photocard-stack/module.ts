import type {
  GameContext,
  GameDefinition,
  NormalizedPointer,
  RunContext,
  ShellLoopGame,
} from "@/shell/contract";
import { arp, blip, sweep, thud } from "@/shell/sfx-presets";
import {
  createPhotocardStackState,
  dropPhotocard,
  heightOf,
  stepPhotocardStack,
  type FallingCard,
  type PhotocardStackState,
  type Rng,
} from "./logic";
import { photocardStackMeta } from "./meta";
import {
  renderPhotocardStack,
  type PhotocardImages,
  type StackParticle,
  type StackToast,
} from "./render";

const ASSET_BASE = "/games/photocard-stack/";
const ASSET_COUNT = 11;

function loadImage(
  src: string,
  signal: AbortSignal,
): Promise<HTMLImageElement> {
  return new Promise((resolve, reject) => {
    if (signal.aborted) {
      reject(new DOMException("photocard-stack init aborted", "AbortError"));
      return;
    }
    const image = new Image();
    const onAbort = () =>
      reject(new DOMException("photocard-stack init aborted", "AbortError"));
    signal.addEventListener("abort", onAbort, { once: true });
    image.onload = () => {
      signal.removeEventListener("abort", onAbort);
      resolve(image);
    };
    image.onerror = () => {
      signal.removeEventListener("abort", onAbort);
      reject(new Error(`photocard-stack asset failed: ${src}`));
    };
    image.src = src;
  });
}

class PhotocardStackGame implements ShellLoopGame {
  readonly loop = "shell" as const;
  private state: PhotocardStackState | null = null;
  private rng: Rng | null = null;
  private images: PhotocardImages | null = null;
  private particles: StackParticle[] = [];
  private toast: StackToast | null = null;
  private bestHeight = 0;
  private paused = false;
  private endedReported = false;
  private unsubscribers: (() => void)[] = [];

  constructor(private readonly ctx: GameContext) {}

  async init(signal: AbortSignal): Promise<void> {
    if (this.ctx.surface.kind !== "canvas") {
      throw new Error("photocard-stack requires a canvas surface");
    }
    const normal = await Promise.all(
      Array.from({ length: ASSET_COUNT }, (_, index) =>
        loadImage(
          `${ASSET_BASE}normal_${String(index).padStart(2, "0")}.webp`,
          signal,
        ),
      ),
    );
    const holo = await Promise.all(
      Array.from({ length: ASSET_COUNT }, (_, index) =>
        loadImage(
          `${ASSET_BASE}holo_${String(index).padStart(2, "0")}.webp`,
          signal,
        ),
      ),
    );
    this.images = { normal, holo };
    this.ctx.audio.register("stack-drop", blip(540, 0.055, "triangle", 0.035));
    this.ctx.audio.register("stack-perfect", arp([740, 988], 0.045, 0.08));
    this.ctx.audio.register("stack-holo", arp([660, 880, 1180], 0.05, 0.09));
    this.ctx.audio.register("stack-rank", arp([523, 659, 784, 1047], 0.055));
    this.ctx.audio.register(
      "stack-trim",
      sweep(260, 120, 0.12, "triangle", 0.035),
    );
    this.ctx.audio.register("stack-topple", thud(95, 0.24, 0.06));
    this.unsubscribers.push(
      this.ctx.input.onPointer((pointer) => this.onPointer(pointer)),
      this.ctx.input.onKey((key) => {
        if (key.action === "down" && key.code === "Space") this.drop();
      }),
    );
  }

  start(run: RunContext): void {
    this.rng = run.random;
    this.state = createPhotocardStackState(run.random, this.bestHeight);
    this.particles = [];
    this.toast = null;
    this.paused = false;
    this.endedReported = false;
    this.ctx.report.score(0);
  }

  pause(): void {
    this.paused = true;
  }

  resume(): void {
    this.paused = false;
  }

  update(dtMs: number): void {
    if (this.paused || !this.state || this.endedReported) return;
    stepPhotocardStack(this.state, dtMs);
    this.updateParticles(dtMs);
    if (this.toast) {
      this.toast.life -= dtMs;
      if (this.toast.life <= 0) this.toast = null;
    }
  }

  render(): void {
    if (this.ctx.surface.kind !== "canvas" || !this.state || !this.images) {
      return;
    }
    renderPhotocardStack(
      this.ctx.surface.context2d,
      this.state,
      this.images,
      this.particles,
      this.toast,
      this.ctx.t,
    );
  }

  destroy(): void {
    for (const unsubscribe of this.unsubscribers) unsubscribe();
    this.unsubscribers = [];
    this.state = null;
    this.rng = null;
    this.images = null;
    this.particles = [];
    this.toast = null;
  }

  private onPointer(pointer: NormalizedPointer): void {
    if (pointer.action === "down") this.drop();
  }

  private drop(): void {
    const state = this.state;
    const rng = this.rng;
    if (!state || !rng || this.paused || this.endedReported) return;
    const event = dropPhotocard(state, rng);
    if (!event) return;
    if (event.falling) this.spawnFalling(event.falling);

    if (event.kind === "miss" || event.kind === "toppled") {
      this.ctx.audio.play("stack-topple");
      if (event.scoreChanged) this.ctx.report.score(state.score);
      this.bestHeight = state.bestHeight;
      this.endRun();
      return;
    }

    if (event.falling) this.ctx.audio.play("stack-trim");
    else this.ctx.audio.play("stack-drop");
    this.ctx.report.score(state.score);

    const top = state.stack[state.stack.length - 1];
    if (event.rankIndex !== null) {
      this.ctx.audio.play("stack-rank");
      this.toast = {
        text: this.ctx.t(`game.photocard-stack.rank.${event.rankIndex}`),
        color: "#4ff0ff",
        life: 700,
      };
      this.burst(180, top.y, "#4ff0ff", 20);
    } else if (event.holo) {
      this.ctx.audio.play("stack-holo");
      this.toast = {
        text: this.ctx.t("game.photocard-stack.toast.holo"),
        color: "#4ff0ff",
        life: 700,
      };
      this.burst(top.x + top.w / 2, top.y, "#4ff0ff", 22);
    } else if (event.perfect) {
      this.ctx.audio.play("stack-perfect");
      this.toast = {
        text:
          event.combo > 1
            ? this.ctx.t("game.photocard-stack.toast.perfectCombo", {
                count: event.combo,
              })
            : this.ctx.t("game.photocard-stack.toast.perfect"),
        color: "#ffd24f",
        life: 650,
      };
      this.burst(top.x + top.w / 2, top.y, "#ffd24f", 14);
    }
  }

  private spawnFalling(card: FallingCard): void {
    this.particles.push({
      type: "card",
      card: { ...card },
      vx: card.direction * (90 + Math.random() * 60),
      vy: -60,
      rotation: 0,
      rotationSpeed: card.direction * 3,
      life: 1400,
    });
  }

  private burst(x: number, y: number, color: string, count: number): void {
    for (let i = 0; i < count; i += 1) {
      this.particles.push({
        type: "spark",
        x,
        y,
        vx: (Math.random() - 0.5) * 300,
        vy: -60 - Math.random() * 240,
        color,
        size: 2 + Math.random() * 3,
        life: 650,
      });
    }
  }

  private updateParticles(dtMs: number): void {
    const dt = dtMs / 1000;
    for (const particle of this.particles) {
      if (particle.type === "card") {
        particle.card.x += particle.vx * dt;
        particle.card.y += particle.vy * dt;
        particle.vy += 900 * dt;
        particle.rotation += particle.rotationSpeed * dt;
      } else {
        particle.x += particle.vx * dt;
        particle.y += particle.vy * dt;
        particle.vy += 720 * dt;
      }
      particle.life -= dtMs;
    }
    this.particles = this.particles.filter((particle) => particle.life > 0);
  }

  private endRun(): void {
    if (!this.state || this.endedReported) return;
    this.endedReported = true;
    this.bestHeight = Math.max(this.bestHeight, heightOf(this.state));
    this.render();
    this.ctx.report.end({ reason: "lost" });
  }
}

export const photocardStackDefinition: GameDefinition = {
  apiVersion: 1,
  meta: photocardStackMeta,
  create(ctx: GameContext) {
    return new PhotocardStackGame(ctx);
  },
};
