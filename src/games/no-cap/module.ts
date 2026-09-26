import type {
  GameContext,
  GameDefinition,
  NormalizedPointer,
  RunContext,
  ShellLoopGame,
} from "@/shell/contract";
import { CompetitionTraceCaptureV4 } from "@/competition/replay-v4";
import {
  createNoCapState,
  DESIGN_H,
  DESIGN_W,
  FAKE_KEYS,
  REAL_KEYS,
  stepNoCap,
  swipeNoCap,
  type NoCapState,
  type Rng,
} from "./logic";
import { noCapMeta } from "./meta";
import {
  renderNoCap,
  type NoCapDebris,
  type NoCapEffects,
  type NoCapImages,
} from "./render";

const ASSET_BASE = "/games/no-cap/";
const IMAGE_NAMES = [
  ...FAKE_KEYS.map((key) => `fake_${key}`),
  ...REAL_KEYS.map((key) => `real_${key}`),
  "scalper_stand",
  "scalper_throw",
];
const SFX = [
  "swipe_whoosh",
  "fake_pop",
  "bonus_silver_sparkle",
  "bonus_gold_jackpot",
  "penalty_buzzer_crack",
  "combo_stinger",
  "timer_tick_loop",
  "countdown_beep",
  "gameover_gong",
] as const;

async function loadImage(
  name: string,
  signal: AbortSignal,
): Promise<HTMLImageElement> {
  return new Promise((resolve, reject) => {
    if (signal.aborted)
      return reject(new DOMException("No Cap init aborted", "AbortError"));
    const image = new Image();
    const onAbort = () => {
      image.src = "";
      reject(new DOMException("No Cap init aborted", "AbortError"));
    };
    signal.addEventListener("abort", onAbort, { once: true });
    const done = () => signal.removeEventListener("abort", onAbort);
    image.onload = () => {
      done();
      resolve(image);
    };
    image.onerror = () => {
      done();
      reject(new Error(`No Cap asset failed: ${name}`));
    };
    const folder = name.startsWith("scalper_")
      ? "scalper"
      : name.startsWith("fake_")
        ? "fake"
        : "real";
    image.src = `${ASSET_BASE}${folder}/${name}.png`;
  });
}

function emptyEffects(): NoCapEffects {
  return { particles: [], debris: [], trail: [], toast: null, shakeTicks: 0 };
}

class NoCapGame implements ShellLoopGame {
  readonly loop = "shell" as const;
  private state: NoCapState | null = null;
  private rng: Rng | null = null;
  private images: NoCapImages | null = null;
  private effects = emptyEffects();
  private sounds: Record<string, HTMLAudioElement> = {};
  private activeSounds = new Set<HTMLAudioElement>();
  private tickSound: HTMLAudioElement | null = null;
  private muted = false;
  private paused = false;
  private endedReported = false;
  private bestScore = 0;
  private pointerId: number | null = null;
  private pendingMove: { x: number; y: number } | null = null;
  private trace: CompetitionTraceCaptureV4 | null = null;
  private unsubscribers: (() => void)[] = [];

  constructor(private readonly ctx: GameContext) {}

  async init(signal: AbortSignal): Promise<void> {
    if (this.ctx.surface.kind !== "canvas")
      throw new Error("No Cap requires canvas");
    const loaded = await Promise.all(
      IMAGE_NAMES.map(
        async (name) => [name, await loadImage(name, signal)] as const,
      ),
    );
    this.images = Object.fromEntries(loaded);
    for (const name of SFX) {
      const audio = new Audio(`${ASSET_BASE}sfx/${name}.mp3`);
      audio.preload = "none";
      this.sounds[name] = audio;
    }
    this.muted = this.ctx.audio.muted;
    this.unsubscribers.push(
      this.ctx.input.onPointer((pointer) => this.onPointer(pointer)),
      this.ctx.audio.onMutedChange((muted) => {
        this.muted = muted;
        for (const sound of this.activeSounds) sound.muted = muted;
        if (this.tickSound) this.tickSound.muted = muted;
      }),
    );
  }

  start(run: RunContext): void {
    this.stopSounds();
    this.rng = run.random;
    this.state = createNoCapState(this.bestScore);
    this.effects = emptyEffects();
    this.pointerId = null;
    this.pendingMove = null;
    this.paused = false;
    this.endedReported = false;
    this.trace = run.competition?.captureTrace
      ? new CompetitionTraceCaptureV4(run.seed)
      : null;
    this.ctx.report.score(0);
    this.play("countdown_beep");
  }

  pause(): void {
    if (this.paused || this.endedReported) return;
    this.flushPendingMove();
    // A system pause can interrupt a held swipe without a pointer-up event.
    // Close it in both the live state and trace so the next swipe still works.
    if (this.state?.pointer && this.pointerId !== null) {
      const { x, y } = this.state.pointer;
      if (!this.applyPointer("cancel", x, y)) {
        // If the official trace is full, no later input can score. Clear the
        // local drag without changing the score.
        swipeNoCap(this.state, "cancel", x, y);
        this.pointerId = null;
      }
    }
    this.paused = true;
    this.tickSound?.pause();
    for (const sound of this.activeSounds) sound.pause();
  }

  resume(): void {
    if (!this.paused || this.endedReported) return;
    this.paused = false;
    if (this.tickSound && !this.muted)
      void this.tickSound.play().catch(() => undefined);
  }

  update(): void {
    if (this.paused || !this.state || !this.rng || this.endedReported) return;
    this.flushPendingMove();
    const finished = stepNoCap(this.state, this.rng);
    this.trace?.advanceTick();
    this.updateEffects();
    if (!this.tickSound && this.state.tick >= 0.8 * 90 * 60 && !finished)
      this.startTick();
    if (finished) this.endRun();
  }

  render(): void {
    if (this.ctx.surface.kind !== "canvas" || !this.state || !this.images)
      return;
    renderNoCap(
      this.ctx.surface.context2d,
      this.state,
      this.images,
      this.effects,
      this.ctx.t,
    );
  }

  destroy(): void {
    for (const unsubscribe of this.unsubscribers) unsubscribe();
    this.unsubscribers = [];
    this.stopSounds();
    this.images = null;
    this.state = null;
    this.rng = null;
    this.trace = null;
    this.pointerId = null;
    this.pendingMove = null;
    this.effects = emptyEffects();
  }

  private onPointer(pointer: NormalizedPointer): void {
    if (!this.state || this.paused || this.endedReported) return;
    if (pointer.action === "down" && this.pointerId !== null) return;
    if (pointer.action !== "down" && pointer.pointerId !== this.pointerId)
      return;
    const x = Math.max(0, Math.min(DESIGN_W, Math.round(pointer.x)));
    const y = Math.max(0, Math.min(DESIGN_H, Math.round(pointer.y)));
    if (pointer.action === "move") {
      // Browser events can arrive at 120 Hz or faster. The simulation and
      // replay both apply only the latest segment once per 60 Hz tick.
      this.pendingMove = { x, y };
      return;
    }
    if (pointer.action === "up" || pointer.action === "cancel")
      this.flushPendingMove();
    const accepted = this.applyPointer(pointer.action, x, y);
    if (accepted && pointer.action === "down")
      this.pointerId = pointer.pointerId;
    if (
      !accepted &&
      (pointer.action === "up" || pointer.action === "cancel") &&
      this.trace &&
      !this.trace.canRecord()
    ) {
      swipeNoCap(this.state, "cancel", x, y);
      this.pointerId = null;
    }
  }

  private flushPendingMove(): void {
    const move = this.pendingMove;
    this.pendingMove = null;
    if (move) this.applyPointer("move", move.x, move.y);
  }

  private applyPointer(
    action: NormalizedPointer["action"],
    x: number,
    y: number,
  ): boolean {
    if (!this.state || (this.trace && !this.trace.canRecord())) return false;
    const result = swipeNoCap(this.state, action, x, y);
    if (!result.accepted) return false;
    if (action === "down") {
      this.play("swipe_whoosh", 0.7);
    } else if (action === "up" || action === "cancel") {
      this.pointerId = null;
    }
    this.trace?.record(action, x, y);
    if (action === "down" || action === "move") {
      this.effects.trail.push({ x, y, age: 0 });
      if (this.effects.trail.length > 14) this.effects.trail.shift();
    }
    for (const hit of result.hits) this.presentHit(hit);
    return true;
  }

  private presentHit(hit: ReturnType<typeof swipeNoCap>["hits"][number]): void {
    const { item, points, combo } = hit;
    const color = !item.fake
      ? "#ff5a7a"
      : item.gold
        ? "#ffd24f"
        : item.silver
          ? "#4ff0ff"
          : "#5affa0";
    if (!item.fake) {
      this.play("penalty_buzzer_crack");
      this.effects.shakeTicks = 24;
      this.effects.toast = {
        text: this.ctx.t("game.no-cap.toast.real", { points: -points }),
        color,
        ticks: 42,
      };
    } else {
      this.play(
        item.gold
          ? "bonus_gold_jackpot"
          : item.silver
            ? "bonus_silver_sparkle"
            : "fake_pop",
      );
      if (combo === 2 || combo === 4 || combo === 6 || combo === 8)
        this.play("combo_stinger", 0.8);
      this.effects.shakeTicks = item.gold ? 8 : 3;
      this.effects.toast = {
        text: item.gold
          ? this.ctx.t("game.no-cap.toast.gold", { points })
          : item.silver
            ? this.ctx.t("game.no-cap.toast.silver", { points })
            : `+${points}`,
        color,
        ticks: 36,
      };
    }
    for (let i = 0; i < (item.fake ? 12 : 20); i++)
      this.effects.particles.push({
        x: item.x,
        y: item.y,
        vx: (Math.random() - 0.5) * 6,
        vy: -Math.random() * 7 - 1,
        life: 1,
        color,
      });
    const size = DESIGN_W * 0.11;
    for (const half of [0, 1] as const) {
      const debris: NoCapDebris = {
        item,
        half,
        x: item.x,
        y: item.y,
        vx: (half ? 1 : -1) * size * 2.5 + item.vx * 0.3,
        vy: -size * 2 + item.vy * 0.25,
        rot: item.rot,
        life: 1,
      };
      this.effects.debris.push(debris);
    }
    this.bestScore = Math.max(this.bestScore, hit.score);
    this.ctx.report.score(hit.score);
  }

  private updateEffects(): void {
    const effects = this.effects;
    if (effects.shakeTicks > 0) effects.shakeTicks -= 1;
    if (effects.toast && --effects.toast.ticks <= 0) effects.toast = null;
    for (const point of effects.trail) point.age += 1;
    effects.trail = effects.trail.filter((point) => point.age < 16);
    for (const particle of effects.particles) {
      particle.x += particle.vx;
      particle.y += particle.vy;
      particle.vy += 0.25;
      particle.life -= 0.03;
    }
    effects.particles = effects.particles.filter(
      (particle) => particle.life > 0,
    );
    for (const debris of effects.debris) {
      debris.x += debris.vx / 60;
      debris.y += debris.vy / 60;
      debris.vy += (DESIGN_H * 0.9) / 60;
      debris.rot += 0.05;
      debris.life -= 1.3 / 60;
    }
    effects.debris = effects.debris.filter((debris) => debris.life > 0);
  }

  private play(name: (typeof SFX)[number], volume = 1): void {
    if (this.muted || this.paused || this.activeSounds.size >= 16) return;
    const audio = this.sounds[name]?.cloneNode(true) as
      HTMLAudioElement | undefined;
    if (!audio) return;
    audio.volume = volume;
    audio.muted = this.muted;
    this.activeSounds.add(audio);
    audio.addEventListener("ended", () => this.activeSounds.delete(audio), {
      once: true,
    });
    void audio.play().catch(() => this.activeSounds.delete(audio));
  }

  private startTick(): void {
    if (this.muted || this.paused) return;
    const audio = this.sounds.timer_tick_loop?.cloneNode(true) as
      HTMLAudioElement | undefined;
    if (!audio) return;
    this.tickSound = audio;
    audio.loop = true;
    audio.volume = 0.55;
    void audio.play().catch(() => undefined);
  }

  private stopSounds(): void {
    this.tickSound?.pause();
    this.tickSound = null;
    for (const audio of this.activeSounds) audio.pause();
    this.activeSounds.clear();
  }

  private endRun(): void {
    if (!this.state || this.endedReported) return;
    this.endedReported = true;
    this.tickSound?.pause();
    this.tickSound = null;
    this.play("gameover_gong");
    this.ctx.report.score(this.state.score);
    this.render();
    this.ctx.report.end({
      reason: "completed",
      ...(this.trace ? { competitionTrace: this.trace.finish() } : {}),
    });
  }
}

export const noCapDefinition: GameDefinition = {
  apiVersion: 1,
  meta: noCapMeta,
  create: (ctx) => new NoCapGame(ctx),
};
