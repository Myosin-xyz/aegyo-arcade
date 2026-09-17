import type {
  GameContext,
  GameDefinition,
  NormalizedPointer,
  RunContext,
  ShellLoopGame,
} from "@/shell/contract";
import { arp, blip, sweep, thud } from "@/shell/sfx-presets";
import { CompetitionTraceCaptureV2 } from "@/competition/replay-v2";
import {
  attemptToss,
  createPerfectTossState,
  stepPerfectToss,
  type PerfectTossState,
  type Rng,
  type TossAttemptEvent,
  type TossResult,
} from "./logic";
import { perfectTossMeta } from "./meta";
import {
  renderPerfectToss,
  type PerfectTossAsset,
  type PerfectTossImages,
  type TossParticle,
  type TossToast,
} from "./render";

const ASSET_BASE = "/games/perfect-toss/";
const ASSET_NAMES: readonly PerfectTossAsset[] = [
  "boy_throw",
  "boy_catch",
  "boy_sad",
  "boy_happy",
  "girl_throw",
  "girl_catch",
  "girl_sad",
  "girl_happy",
  "lightstick",
];

function loadImage(
  src: string,
  signal: AbortSignal,
): Promise<HTMLImageElement> {
  return new Promise((resolve, reject) => {
    if (signal.aborted) {
      reject(new DOMException("perfect-toss init aborted", "AbortError"));
      return;
    }
    const image = new Image();
    const cleanup = () => signal.removeEventListener("abort", onAbort);
    const onAbort = () => {
      cleanup();
      reject(new DOMException("perfect-toss init aborted", "AbortError"));
    };
    signal.addEventListener("abort", onAbort, { once: true });
    image.onload = () => {
      cleanup();
      resolve(image);
    };
    image.onerror = () => {
      cleanup();
      reject(new Error(`perfect-toss asset failed: ${src}`));
    };
    image.src = src;
  });
}

class PerfectTossGame implements ShellLoopGame {
  readonly loop = "shell" as const;
  private state: PerfectTossState | null = null;
  private rng: Rng | null = null;
  private images: PerfectTossImages | null = null;
  private particles: TossParticle[] = [];
  private toast: TossToast | null = null;
  private shakeTicks = 0;
  private bestScore = 0;
  private paused = false;
  private endedReported = false;
  private competitionTrace: CompetitionTraceCaptureV2 | null = null;
  private unsubscribers: (() => void)[] = [];

  constructor(private readonly ctx: GameContext) {}

  async init(signal: AbortSignal): Promise<void> {
    if (this.ctx.surface.kind !== "canvas") {
      throw new Error("perfect-toss requires a canvas surface");
    }
    const loaded = await Promise.all(
      ASSET_NAMES.map(
        async (name) =>
          [name, await loadImage(`${ASSET_BASE}${name}.webp`, signal)] as const,
      ),
    );
    this.images = Object.fromEntries(loaded) as PerfectTossImages;

    this.ctx.audio.register("toss-good", blip(560, 0.08, "triangle", 0.04));
    this.ctx.audio.register("toss-perfect", arp([740, 988], 0.045, 0.09));
    this.ctx.audio.register("toss-bonus", arp([660, 880, 1180], 0.05, 0.09));
    this.ctx.audio.register("toss-miss", thud(105, 0.2, 0.06));
    this.ctx.audio.register(
      "toss-flight",
      sweep(260, 520, 0.16, "sine", 0.025),
    );
    this.unsubscribers.push(
      this.ctx.input.onPointer((pointer) => this.onPointer(pointer)),
      this.ctx.input.onKey((key) => {
        if (key.action === "down" && key.code === "Space") this.throw();
      }),
    );
  }

  start(run: RunContext): void {
    this.rng = run.random;
    this.state = createPerfectTossState(run.random, this.bestScore);
    this.particles = [];
    this.toast = null;
    this.shakeTicks = 0;
    this.paused = false;
    this.endedReported = false;
    this.competitionTrace = run.competition?.captureTrace
      ? new CompetitionTraceCaptureV2("perfect-toss", run.seed)
      : null;
    this.ctx.report.score(0);
  }

  pause(): void {
    if (!this.paused) this.competitionTrace?.record("pause");
    this.paused = true;
  }

  resume(): void {
    if (this.paused) this.competitionTrace?.record("resume");
    this.paused = false;
  }

  update(_dtMs: number): void {
    if (this.paused || !this.state || this.endedReported) return;
    const event = stepPerfectToss(this.state);
    this.competitionTrace?.advanceTick();
    this.updateEffects();
    if (event?.kind === "landed") this.burstFor(event.result);
    if (event?.kind === "ended") this.endRun();
  }

  render(): void {
    if (this.ctx.surface.kind !== "canvas" || !this.state || !this.images) {
      return;
    }
    renderPerfectToss(
      this.ctx.surface.context2d,
      this.state,
      this.images,
      {
        particles: this.particles,
        toast: this.toast,
        shakeTicks: this.shakeTicks,
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
    this.competitionTrace = null;
    this.particles = [];
    this.toast = null;
  }

  private onPointer(pointer: NormalizedPointer): void {
    if (pointer.action === "down") this.throw();
  }

  private throw(): void {
    if (!this.state || !this.rng || this.paused || this.endedReported) return;
    const event = attemptToss(this.state, this.rng);
    if (!event) return;
    this.competitionTrace?.record("perfect-toss:throw");
    this.ctx.audio.play("toss-flight");
    this.presentAttempt(event);
    if (event.result !== "miss") this.ctx.report.score(event.catches);
  }

  private presentAttempt(event: TossAttemptEvent): void {
    if (event.result === "miss") {
      this.ctx.audio.play("toss-miss");
      this.shakeTicks = 24;
      this.toast = {
        text: this.ctx.t("game.perfect-toss.toast.miss"),
        color: "#ff5a7a",
        ticksRemaining: 45,
      };
      return;
    }
    if (event.bonusHit) {
      this.ctx.audio.play("toss-bonus");
      this.toast = {
        text: this.ctx.t(
          event.result === "perfect"
            ? "game.perfect-toss.toast.bonusPerfect"
            : "game.perfect-toss.toast.bonusGood",
          { points: event.points },
        ),
        color: "#5affa0",
        ticksRemaining: 45,
      };
      return;
    }
    if (event.result === "perfect") {
      this.ctx.audio.play("toss-perfect");
      this.toast = {
        text: this.ctx.t("game.perfect-toss.toast.perfect"),
        color: "#ffd24f",
        ticksRemaining: 45,
      };
      return;
    }
    this.ctx.audio.play("toss-good");
    this.toast = {
      text: this.ctx.t("game.perfect-toss.toast.good"),
      color: "#4ff0ff",
      ticksRemaining: 45,
    };
  }

  private burstFor(result: TossResult): void {
    const count = result === "perfect" ? 20 : 12;
    const color =
      result === "perfect"
        ? "#ffd24f"
        : result === "good"
          ? "#4ff0ff"
          : "#ff5a7a";
    const x = result === "miss" ? 310 : 294;
    const y = result === "miss" ? 420 : 345;
    for (let index = 0; index < count; index += 1) {
      this.particles.push({
        x,
        y,
        vx: (Math.random() - 0.5) * (result === "perfect" ? 4.8 : 3.2),
        vy: -1 - Math.random() * (result === "perfect" ? 4.5 : 3),
        color,
        size: 2 + Math.random() * 3,
        lifeTicks: 42,
      });
    }
  }

  private updateEffects(): void {
    if (this.shakeTicks > 0) this.shakeTicks -= 1;
    if (this.toast) {
      this.toast.ticksRemaining -= 1;
      if (this.toast.ticksRemaining <= 0) this.toast = null;
    }
    for (const particle of this.particles) {
      particle.x += particle.vx;
      particle.y += particle.vy;
      particle.vy += 0.25;
      particle.lifeTicks -= 1;
    }
    this.particles = this.particles.filter(
      (particle) => particle.lifeTicks > 0,
    );
  }

  private endRun(): void {
    if (!this.state || this.endedReported) return;
    this.endedReported = true;
    this.bestScore = Math.max(this.bestScore, this.state.score);
    this.state.bestScore = this.bestScore;
    this.render();
    this.ctx.report.end({
      reason: "lost",
      competitionTrace: this.competitionTrace?.finish("lost", "over"),
    });
  }
}

export const perfectTossDefinition: GameDefinition = {
  apiVersion: 1,
  meta: perfectTossMeta,
  create(ctx: GameContext) {
    return new PerfectTossGame(ctx);
  },
};
