import type {
  GameContext,
  GameDefinition,
  NormalizedPointer,
  RunContext,
  ShellLoopGame,
} from "@/shell/contract";
import { arp, blip, sweep, thud } from "@/shell/sfx-presets";
import {
  COLOR_KEYS,
  continueAegyoPop,
  createAegyoPopState,
  nudgeAim,
  setAimFromPoint,
  shootAegyoPop,
  stepAegyoPop,
  type AegyoPopEvent,
  type AegyoPopState,
  type Rng,
} from "./logic";
import { aegyoPopMeta } from "./meta";
import {
  COLOR_HEX,
  renderAegyoPop,
  type OrbImages,
  type PopParticle,
  type PopToast,
} from "./render";

const ASSET_BASE = "/games/aegyo-pop/";
const TOUCH_AIM_THRESHOLD = 8;

function loadImage(
  source: string,
  signal: AbortSignal,
): Promise<HTMLImageElement> {
  return new Promise((resolve, reject) => {
    if (signal.aborted) {
      reject(new DOMException("aegyo-pop init aborted", "AbortError"));
      return;
    }
    const image = new Image();
    const onAbort = () =>
      reject(new DOMException("aegyo-pop init aborted", "AbortError"));
    signal.addEventListener("abort", onAbort, { once: true });
    image.onload = () => {
      signal.removeEventListener("abort", onAbort);
      resolve(image);
    };
    image.onerror = () => {
      signal.removeEventListener("abort", onAbort);
      reject(new Error(`aegyo-pop asset failed: ${source}`));
    };
    image.src = source;
  });
}

class AegyoPopGame implements ShellLoopGame {
  readonly loop = "shell" as const;
  private state: AegyoPopState | null = null;
  private rng: Rng | null = null;
  private images: OrbImages | null = null;
  private particles: PopParticle[] = [];
  private toast: PopToast | null = null;
  private arcadeFont = '"Arial Black", "Trebuchet MS", system-ui, sans-serif';
  private presentationClock = 0;
  private paused = false;
  private endedReported = false;
  private lastReportedScore = -1;
  private reducedMotion = false;
  private unsubscribers: (() => void)[] = [];
  private activeAim: {
    pointerId: number;
    pointerType: string;
    startX: number;
    startY: number;
    dragged: boolean;
  } | null = null;

  constructor(private readonly ctx: GameContext) {}

  async init(signal: AbortSignal): Promise<void> {
    if (this.ctx.surface.kind !== "canvas") {
      throw new Error("aegyo-pop requires a canvas surface");
    }
    const loaded = await Promise.all(
      COLOR_KEYS.map((key) => loadImage(`${ASSET_BASE}${key}.webp`, signal)),
    );
    this.images = Object.fromEntries(
      COLOR_KEYS.map((key, index) => [key, loaded[index]]),
    ) as OrbImages;

    if (typeof getComputedStyle === "function") {
      const root = getComputedStyle(document.documentElement)
        .getPropertyValue("--font-arcade")
        .trim();
      if (root) this.arcadeFont = `${root}, ui-monospace, monospace`;
    }
    this.reducedMotion =
      typeof matchMedia === "function" &&
      matchMedia("(prefers-reduced-motion: reduce)").matches;

    this.ctx.audio.register("pop-shoot", blip(440, 0.055, "square", 0.03));
    this.ctx.audio.register("pop-match", arp([660, 880], 0.035, 0.07));
    this.ctx.audio.register("pop-bomb", arp([520, 740, 980], 0.04, 0.09));
    this.ctx.audio.register(
      "pop-drop",
      sweep(360, 130, 0.16, "triangle", 0.04),
    );
    this.ctx.audio.register("pop-danger", thud(105, 0.2, 0.055));
    this.ctx.audio.register("pop-level", arp([523, 659, 784, 1047], 0.055));
    this.ctx.audio.register("pop-win", arp([523, 659, 784, 1047, 1319], 0.06));
    this.ctx.audio.register(
      "pop-lose",
      sweep(220, 70, 0.28, "sawtooth", 0.045),
    );

    this.unsubscribers.push(
      this.ctx.input.onPointer((pointer) => this.onPointer(pointer)),
      this.ctx.input.onKey((key) => {
        if (key.action !== "down") return;
        if (key.code === "ArrowLeft" && this.state) nudgeAim(this.state, -0.08);
        else if (key.code === "ArrowRight" && this.state)
          nudgeAim(this.state, 0.08);
        else if (key.code === "Space") this.shoot();
        else if (key.code === "Enter") this.continueLevel();
      }),
    );
  }

  start(run: RunContext): void {
    if (
      run.mode !== "practice" &&
      (typeof run.attemptId !== "string" || run.attemptId.length === 0)
    ) {
      throw new Error(`${run.mode} run without attemptId`);
    }
    if (run.signal.aborted) throw new Error("aegyo-pop run already aborted");
    this.rng = run.random;
    this.state = createAegyoPopState(run.random);
    this.particles = [];
    this.toast = null;
    this.presentationClock = 0;
    this.paused = false;
    this.endedReported = false;
    this.lastReportedScore = 0;
    this.activeAim = null;
    this.ctx.report.score(0);
  }

  pause(): void {
    this.paused = true;
    this.activeAim = null;
  }

  resume(): void {
    this.paused = false;
  }

  update(dtMs: number): void {
    const state = this.state;
    const rng = this.rng;
    if (!state || !rng || this.paused || this.endedReported) return;
    this.presentationClock += dtMs;
    this.updatePresentation(dtMs);
    this.processEvents(stepAegyoPop(state, dtMs, rng));
  }

  render(): void {
    if (this.ctx.surface.kind !== "canvas" || !this.state || !this.images) {
      return;
    }
    renderAegyoPop(
      this.ctx.surface.context2d,
      this.state,
      this.images,
      {
        nowMs: this.presentationClock,
        arcadeFont: this.arcadeFont,
        particles: this.particles,
        toast: this.toast,
      },
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
    this.activeAim = null;
  }

  private onPointer(pointer: NormalizedPointer): void {
    const state = this.state;
    if (!state || this.paused || this.endedReported) return;
    if (state.status === "transition") {
      if (pointer.action === "down") this.continueLevel();
      return;
    }
    if (state.status !== "playing") return;

    if (pointer.action === "down") {
      // One pointer owns the full aim gesture. A second finger (including a
      // tap on decorative/empty canvas space) cannot release the shot early.
      if (this.activeAim) return;
      this.activeAim = {
        pointerId: pointer.pointerId,
        pointerType: pointer.pointerType ?? "mouse",
        startX: pointer.x,
        startY: pointer.y,
        dragged: false,
      };
      setAimFromPoint(state, pointer.x, pointer.y);
      return;
    }

    const aim = this.activeAim;
    if (!aim || aim.pointerId !== pointer.pointerId) return;
    if (pointer.action === "cancel") {
      this.activeAim = null;
      return;
    }
    if (pointer.action === "move") {
      if (
        Math.hypot(pointer.x - aim.startX, pointer.y - aim.startY) >=
        TOUCH_AIM_THRESHOLD
      ) {
        aim.dragged = true;
      }
      setAimFromPoint(state, pointer.x, pointer.y);
      return;
    }
    if (pointer.action === "up") {
      this.activeAim = null;
      setAimFromPoint(state, pointer.x, pointer.y);
      // Touch uses one unambiguous contract: drag, then lift. A stationary
      // tap is deliberately inert. Mouse/pen clicks stay convenient.
      if (aim.pointerType === "touch" && !aim.dragged) return;
      this.shoot();
    }
  }

  private shoot(): void {
    const state = this.state;
    const rng = this.rng;
    if (!state || !rng || this.paused || this.endedReported) return;
    this.processEvents(shootAegyoPop(state, rng));
  }

  private continueLevel(): void {
    const state = this.state;
    const rng = this.rng;
    if (!state || !rng || this.paused || this.endedReported) return;
    if (continueAegyoPop(state, rng)) {
      this.toast = null;
      this.particles = [];
      this.ctx.audio.play("pop-level");
    }
  }

  private processEvents(events: readonly AegyoPopEvent[]): void {
    let terminal: "completed" | "lost" | null = null;
    for (const event of events) {
      switch (event.kind) {
        case "shot":
          this.ctx.audio.play("pop-shoot");
          break;
        case "impact":
          this.burst(
            event.x,
            event.y,
            COLOR_HEX[event.color],
            event.fall,
            event.big,
          );
          break;
        case "pop":
          this.ctx.audio.play(event.bombExtra > 0 ? "pop-bomb" : "pop-match");
          if (event.bombExtra > 0) {
            this.setToast(
              this.ctx.t("game.aegyo-pop.toast.bomb", {
                count: event.bombExtra,
              }),
              "#ffd24f",
            );
          } else if (event.combo >= 2) {
            this.setToast(
              this.ctx.t("game.aegyo-pop.toast.combo", {
                combo: event.combo,
                score: event.gained,
              }),
              "#ffd24f",
            );
          } else {
            this.setToast(
              this.ctx.t(
                event.groupSize >= 6
                  ? "game.aegyo-pop.toast.chain"
                  : "game.aegyo-pop.toast.pop",
              ),
              "#ffd24f",
            );
          }
          break;
        case "drop":
          this.ctx.audio.play("pop-drop");
          this.setToast(
            this.ctx.t("game.aegyo-pop.toast.dropped", { count: event.count }),
            "#4ff0ff",
          );
          break;
        case "rescue":
          this.ctx.audio.play("pop-bomb");
          RAINBOW_FX.forEach((color) =>
            this.burst(event.x, event.y, color, false, true),
          );
          this.setToast(
            this.ctx.t("game.aegyo-pop.toast.rescued", {
              score: event.bonus,
            }),
            "#ff4fd8",
          );
          break;
        case "last-wave":
          this.setToast(this.ctx.t("game.aegyo-pop.toast.lastWave"), "#ffd24f");
          break;
        case "danger":
          this.ctx.audio.play("pop-danger");
          this.setToast(
            this.ctx.t("game.aegyo-pop.toast.danger"),
            "#ff5a7a",
            1550,
          );
          break;
        case "level-clear":
          this.ctx.audio.play("pop-level");
          this.setToast(
            this.ctx.t("game.aegyo-pop.toast.levelClear"),
            "#ffd24f",
          );
          break;
        case "lost":
          terminal = "lost";
          break;
        case "won":
          terminal = "completed";
          break;
      }
    }
    this.reportScoreIfChanged();
    if (terminal) this.endRun(terminal);
  }

  private reportScoreIfChanged(): void {
    if (!this.state || this.state.score === this.lastReportedScore) return;
    this.lastReportedScore = this.state.score;
    this.ctx.report.score(this.state.score);
  }

  private setToast(text: string, color: string, duration = 850): void {
    this.toast = { text, color, lifeMs: duration, totalMs: duration };
  }

  private burst(
    x: number,
    y: number,
    color: string,
    fall: boolean,
    big: boolean,
  ): void {
    if (this.reducedMotion) return;
    const count = big ? 22 : 14;
    for (let index = 0; index < count; index += 1) {
      const lifeMs = 620 + Math.random() * 260;
      this.particles.push({
        x,
        y,
        vx: (Math.random() - 0.5) * (fall ? 150 : big ? 520 : 360),
        vy: fall
          ? 70 + Math.random() * 100
          : -80 - Math.random() * (big ? 460 : 320),
        gravity: fall ? 760 : 620,
        color,
        size: (big ? 4 : 3) + Math.random() * 3,
        lifeMs,
        totalMs: lifeMs,
      });
    }
  }

  private updatePresentation(dtMs: number): void {
    const dt = dtMs / 1000;
    for (const particle of this.particles) {
      particle.x += particle.vx * dt;
      particle.y += particle.vy * dt;
      particle.vy += particle.gravity * dt;
      particle.lifeMs -= dtMs;
    }
    this.particles = this.particles.filter((particle) => particle.lifeMs > 0);
    if (this.toast) {
      this.toast.lifeMs -= dtMs;
      if (this.toast.lifeMs <= 0) this.toast = null;
    }
  }

  private endRun(reason: "completed" | "lost"): void {
    if (this.endedReported) return;
    this.endedReported = true;
    this.ctx.audio.play(reason === "completed" ? "pop-win" : "pop-lose");
    this.render();
    this.ctx.report.end({ reason });
  }
}

const RAINBOW_FX = ["#ff4fd8", "#ffd24f", "#5affa0", "#4ff0ff", "#b06bff"];

export const aegyoPopDefinition: GameDefinition = {
  apiVersion: 1,
  meta: aegyoPopMeta,
  create(ctx: GameContext) {
    return new AegyoPopGame(ctx);
  },
};
