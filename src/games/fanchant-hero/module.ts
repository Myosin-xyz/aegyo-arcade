import type {
  GameContext,
  GameDefinition,
  NormalizedPointer,
  RunContext,
  ShellLoopGame,
} from "@/shell/contract";
import { arp, blip, thud } from "@/shell/sfx-presets";
import {
  GOODIE_KEYS,
  createFanchantState,
  stepFanchant,
  tapFanchantLane,
  type FanchantState,
} from "./logic";
import { fanchantHeroMeta } from "./meta";
import {
  fieldX,
  laneAtX,
  laneWidth,
  renderFanchantHero,
  type FanchantParticle,
  type GoodieImages,
  type JudgementToast,
} from "./render";

const ASSET_BASE = "/games/fanchant-hero/";
const MELODY = [
  440, 494, 554, 659, 554, 494, 440, 330, 440, 440, 554, 659, 740, 659, 554,
  494, 659, 659, 740, 880, 740, 659, 554, 659, 554, 494, 440, 494, 554, 659,
  494, 440,
] as const;

const KEY_LANES: Record<string, number> = {
  KeyD: 0,
  KeyF: 1,
  KeyJ: 2,
  KeyK: 3,
};

function loadImage(
  src: string,
  signal: AbortSignal,
): Promise<HTMLImageElement> {
  return new Promise((resolve, reject) => {
    if (signal.aborted) {
      reject(new DOMException("fanchant-hero init aborted", "AbortError"));
      return;
    }
    const image = new Image();
    const onAbort = () =>
      reject(new DOMException("fanchant-hero init aborted", "AbortError"));
    signal.addEventListener("abort", onAbort, { once: true });
    image.onload = () => {
      signal.removeEventListener("abort", onAbort);
      resolve(image);
    };
    image.onerror = () => {
      signal.removeEventListener("abort", onAbort);
      reject(new Error(`fanchant-hero asset failed: ${src}`));
    };
    image.src = src;
  });
}

class FanchantHeroGame implements ShellLoopGame {
  readonly loop = "shell" as const;
  private state: FanchantState | null = null;
  private images: GoodieImages | null = null;
  private particles: FanchantParticle[] = [];
  private laneFlash = [0, 0, 0, 0];
  private judgement: JudgementToast | null = null;
  private melodyIndex = 0;
  private paused = false;
  private endedReported = false;
  private lastReportedScore = -1;
  private unsubscribers: (() => void)[] = [];

  constructor(private readonly ctx: GameContext) {}

  async init(signal: AbortSignal): Promise<void> {
    if (this.ctx.surface.kind !== "canvas") {
      throw new Error("fanchant-hero requires a canvas surface");
    }
    const loaded = await Promise.all(
      GOODIE_KEYS.map((key) => loadImage(`${ASSET_BASE}${key}.webp`, signal)),
    );
    this.images = Object.fromEntries(
      GOODIE_KEYS.map((key, index) => [key, loaded[index]]),
    ) as GoodieImages;

    this.ctx.audio.register("fanchant-beat", thud(135, 0.12, 0.035));
    this.ctx.audio.register("fanchant-miss", thud(100, 0.14, 0.045));
    this.ctx.audio.register(
      "fanchant-finish",
      arp([523, 659, 784, 1047], 0.07),
    );
    MELODY.forEach((frequency, index) => {
      this.ctx.audio.register(
        `fanchant-melody-${index}`,
        blip(frequency, 0.14, "square", 0.035),
      );
      this.ctx.audio.register(
        `fanchant-harmony-${index}`,
        blip(frequency * 1.5, 0.1, "triangle", 0.02),
      );
    });

    this.unsubscribers.push(
      this.ctx.input.onPointer((pointer) => this.onPointer(pointer)),
      this.ctx.input.onKey((key) => {
        if (key.action !== "down") return;
        const lane = KEY_LANES[key.code];
        if (lane !== undefined) this.tapLane(lane);
      }),
    );
  }

  start(run: RunContext): void {
    this.state = createFanchantState(run.random);
    this.particles = [];
    this.laneFlash = [0, 0, 0, 0];
    this.judgement = null;
    this.melodyIndex = 0;
    this.paused = false;
    this.endedReported = false;
    this.lastReportedScore = 0;
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
    if (!state || this.paused || this.endedReported) return;
    const events = stepFanchant(state, dtMs);
    for (const beat of events.beats) {
      if (beat % 2 === 0) this.ctx.audio.play("fanchant-beat");
    }
    if (events.missed > 0) {
      this.ctx.audio.play("fanchant-miss");
      this.judgement = { kind: "missed", color: "#ff5a7a", life: 450 };
    }

    const decay = Math.pow(0.85, dtMs / (1000 / 60));
    this.laneFlash = this.laneFlash.map((flash) => flash * decay);
    this.updateParticles(dtMs);
    if (this.judgement) {
      this.judgement.life -= dtMs;
      if (this.judgement.life <= 0) this.judgement = null;
    }
    if (state.score !== this.lastReportedScore) {
      this.lastReportedScore = state.score;
      this.ctx.report.score(state.score);
    }
    if (events.ended) this.endRun();
  }

  render(): void {
    if (this.ctx.surface.kind !== "canvas" || !this.state || !this.images) {
      return;
    }
    renderFanchantHero(
      this.ctx.surface.context2d,
      this.state,
      this.images,
      this.laneFlash,
      this.particles,
      this.judgement,
      this.ctx.t,
    );
  }

  destroy(): void {
    for (const unsubscribe of this.unsubscribers) unsubscribe();
    this.unsubscribers = [];
    this.state = null;
    this.images = null;
    this.particles = [];
    this.judgement = null;
  }

  private onPointer(pointer: NormalizedPointer): void {
    if (pointer.action !== "down") return;
    const lane = laneAtX(pointer.x);
    if (lane !== null) this.tapLane(lane);
  }

  private tapLane(lane: number): void {
    const state = this.state;
    if (!state || this.paused || this.endedReported) return;
    this.laneFlash[lane] = 1;
    const hit = tapFanchantLane(state, lane);
    if (!hit) return;

    const colors = {
      perfect: "#ffd24f",
      good: "#4ff0ff",
      ok: "#c9a0ff",
    } as const;
    this.judgement = {
      kind: hit.judgement,
      color: colors[hit.judgement],
      life: 450,
    };
    const noteIndex = this.melodyIndex % MELODY.length;
    this.ctx.audio.play(`fanchant-melody-${noteIndex}`);
    if (hit.judgement === "perfect") {
      this.ctx.audio.play(`fanchant-harmony-${noteIndex}`);
    }
    this.melodyIndex += 1;
    this.burstLane(lane, colors[hit.judgement]);
    if (state.score !== this.lastReportedScore) {
      this.lastReportedScore = state.score;
      this.ctx.report.score(state.score);
    }
  }

  private burstLane(lane: number, color: string): void {
    const x = fieldX() + lane * laneWidth() + laneWidth() / 2;
    const y = 640 * 0.8;
    for (let i = 0; i < 12; i += 1) {
      this.particles.push({
        type: "spark",
        x,
        y,
        vx: (Math.random() - 0.5) * 360,
        vy: -60 - Math.random() * 300,
        color,
        size: 2 + Math.random() * 3,
        life: 650,
      });
    }
    for (let i = 0; i < 3; i += 1) {
      this.particles.push({
        type: "heart",
        x: x + (Math.random() - 0.5) * 20,
        y: y - 8,
        vx: (Math.random() - 0.5) * 120,
        vy: -120 - Math.random() * 120,
        life: 650,
      });
    }
  }

  private updateParticles(dtMs: number): void {
    const dt = dtMs / 1000;
    for (const particle of this.particles) {
      particle.x += particle.vx * dt;
      particle.y += particle.vy * dt;
      particle.vy += 720 * dt;
      particle.life -= dtMs;
    }
    this.particles = this.particles.filter((particle) => particle.life > 0);
  }

  private endRun(): void {
    if (!this.state || this.endedReported) return;
    this.endedReported = true;
    this.ctx.audio.play("fanchant-finish");
    this.render();
    this.ctx.report.end({ reason: "completed" });
  }
}

export const fanchantHeroDefinition: GameDefinition = {
  apiVersion: 1,
  meta: fanchantHeroMeta,
  create(ctx: GameContext) {
    return new FanchantHeroGame(ctx);
  },
};
