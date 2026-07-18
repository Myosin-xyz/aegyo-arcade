/**
 * Bias Flap — ShellLoopGame (docs/games/flappy.md). Fixed 60Hz simulation
 * through the shell loop; tap anywhere (pointer down) or Space to flap;
 * all randomness from the run's seeded PRNG.
 */

import type {
  GameContext,
  GameDefinition,
  RunContext,
  ShellLoopGame,
} from "@/shell/contract";
import { flappyMeta } from "./meta";
import { blip, sweep } from "@/shell/sfx-presets";
import {
  createFlappyState,
  flap,
  step,
  DESIGN,
  FLOOR_Y,
  GAP_HALF,
  PIPE_WIDTH,
  PLAYER_RADIUS,
  PLAYER_X,
  type FlappyState,
} from "./logic";

const SIM_STEP_MS = 1000 / 60;

const COLORS = {
  background: "#2b1146",
  floor: "#1c0a33",
  barricade: "#7b2ff7",
  lightstick: "#ffd166",
  lightstickTip: "#ff4f8b",
} as const;

class FlappyGame implements ShellLoopGame {
  readonly loop = "shell" as const;
  private state: FlappyState | null = null;
  private rng: (() => number) | null = null;
  private accumulator = 0;
  private paused = false;
  private endedReported = false;
  /** First flap starts the run (M4 UX P1: no falling while orienting). */
  private armed = false;
  /** Render-only glow trail of recent player positions (style pass). */
  private trail: number[] = [];
  private unsubscribers: (() => void)[] = [];

  constructor(private readonly ctx: GameContext) {}

  init(): void {
    this.ctx.audio.register("flap", sweep(280, 560, 0.09, "triangle", 0.04));
    this.ctx.audio.register("point", blip(1046, 0.07, "triangle", 0.045));
    this.ctx.audio.register("lose", sweep(500, 80, 0.28, "sawtooth", 0.045));
    this.unsubscribers.push(
      this.ctx.input.onPointer((p) => {
        if (p.action === "down" && this.state) {
          this.armed = true;
          if (this.state.status === "running") this.ctx.audio.play("flap");
          flap(this.state);
        }
      }),
      this.ctx.input.onKey((k) => {
        if (k.action === "down" && k.code === "Space" && this.state) {
          this.armed = true;
          if (this.state.status === "running") this.ctx.audio.play("flap");
          flap(this.state);
        }
      }),
    );
  }

  start(run: RunContext): void {
    this.rng = run.random;
    this.state = createFlappyState(run.random);
    this.accumulator = 0;
    this.endedReported = false;
    this.armed = false; // hover until the first flap
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
    if (!state || !rng || this.paused || state.status !== "running") return;
    if (!this.armed) return; // frozen until the first flap
    this.accumulator += dtMs;
    while (this.accumulator >= SIM_STEP_MS) {
      this.accumulator -= SIM_STEP_MS;
      const before = state.score;
      step(state, rng);
      if (state.score !== before) {
        this.ctx.audio.play("point");
        this.ctx.report.score(state.score);
      }
      if (state.status !== "running") {
        if (!this.endedReported) {
          this.endedReported = true;
          this.ctx.audio.play("lose");
          this.ctx.report.end({ reason: "lost" });
        }
        return;
      }
    }
  }

  render(): void {
    if (this.ctx.surface.kind !== "canvas" || !this.state) return;
    const { context2d: g } = this.ctx.surface;
    const state = this.state;

    // Render-only trail bookkeeping (never touches the simulation).
    if (this.armed && state.status === "running") {
      this.trail.push(state.y);
      if (this.trail.length > 7) this.trail.shift();
    } else if (this.trail.length > 0 && state.status !== "running") {
      this.trail.length = 0;
    }

    // Concert night sky + deterministic crowd-lightstick specks (hash
    // scatter — render stays allocation-light and RNG-free).
    const sky = g.createLinearGradient(0, 0, 0, FLOOR_Y);
    sky.addColorStop(0, "#150a2b");
    sky.addColorStop(1, "#341457");
    g.fillStyle = sky;
    g.fillRect(0, 0, DESIGN.w, DESIGN.h);
    for (let i = 0; i < 42; i++) {
      const px = (i * 97 + 23) % DESIGN.w;
      const py = ((i * 61 + 11) % Math.floor(FLOOR_Y * 0.92)) + 8;
      g.globalAlpha = 0.12 + (i % 5) * 0.06;
      g.fillStyle = i % 3 === 0 ? "#ffd166" : "#ff8fb8";
      g.fillRect(px, py, 2, 2);
    }
    g.globalAlpha = 1;

    // Floor: crowd silhouette bumps under a pink stage-edge glow.
    g.fillStyle = COLORS.floor;
    g.fillRect(0, FLOOR_Y, DESIGN.w, DESIGN.h - FLOOR_Y);
    g.fillStyle = "#120722";
    for (let i = 0; i < 16; i++) {
      const bx = i * (DESIGN.w / 15);
      const br = 14 + ((i * 37) % 9);
      g.beginPath();
      g.arc(bx, FLOOR_Y + 12, br, Math.PI, 0);
      g.fill();
    }
    g.fillStyle = "rgba(255, 79, 139, 0.55)";
    g.fillRect(0, FLOOR_Y, DESIGN.w, 3);

    // Barricades: rounded neon blocks with a caution rim at the gap.
    for (const pipe of state.pipes) {
      const topH = pipe.gapCenter - GAP_HALF;
      const botY = pipe.gapCenter + GAP_HALF;
      const body = g.createLinearGradient(pipe.x, 0, pipe.x + PIPE_WIDTH, 0);
      body.addColorStop(0, "#5b21c9");
      body.addColorStop(0.5, "#7b2ff7");
      body.addColorStop(1, "#4a18a8");
      g.fillStyle = body;
      g.beginPath();
      g.roundRect(pipe.x, -8, PIPE_WIDTH, topH + 8, 6);
      g.roundRect(pipe.x, botY, PIPE_WIDTH, FLOOR_Y - botY + 8, 6);
      g.fill();
      g.fillStyle = "#ff8fb8";
      g.fillRect(pipe.x, topH - 4, PIPE_WIDTH, 4);
      g.fillRect(pipe.x, botY, PIPE_WIDTH, 4);
    }

    // Glow trail behind the lightstick (render-only history).
    for (let i = 0; i < this.trail.length; i++) {
      const a = ((i + 1) / this.trail.length) * 0.22;
      g.globalAlpha = a;
      g.fillStyle = "#ffd166";
      g.beginPath();
      g.arc(
        PLAYER_X - (this.trail.length - i) * 7,
        this.trail[i] - 4,
        PLAYER_RADIUS * 0.5,
        0,
        Math.PI * 2,
      );
      g.fill();
    }
    g.globalAlpha = 1;

    // The bias lightstick: tilted handle + glowing gold head (hitbox
    // stays the PLAYER_RADIUS circle — this is draw-only).
    const tilt = Math.max(-0.5, Math.min(0.6, state.vy * 0.045));
    g.save();
    g.translate(PLAYER_X, state.y);
    g.rotate(tilt);
    g.fillStyle = "#52307a";
    g.beginPath();
    g.roundRect(-3.5, 0, 7, PLAYER_RADIUS * 1.7, 3.5);
    g.fill();
    g.fillStyle = "#8b5cf6";
    g.fillRect(-3.5, PLAYER_RADIUS * 0.5, 7, 2);
    const glow = g.createRadialGradient(0, -4, 1, 0, -4, PLAYER_RADIUS * 1.9);
    glow.addColorStop(0, "rgba(255, 227, 140, 0.95)");
    glow.addColorStop(0.45, "rgba(255, 209, 102, 0.5)");
    glow.addColorStop(1, "rgba(255, 209, 102, 0)");
    g.fillStyle = glow;
    g.beginPath();
    g.arc(0, -4, PLAYER_RADIUS * 1.9, 0, Math.PI * 2);
    g.fill();
    g.fillStyle = COLORS.lightstick;
    g.beginPath();
    g.arc(0, -4, PLAYER_RADIUS * 0.85, 0, Math.PI * 2);
    g.fill();
    g.fillStyle = "#fff6dd";
    g.beginPath();
    g.arc(-2, -6, PLAYER_RADIUS * 0.32, 0, Math.PI * 2);
    g.fill();
    g.restore();
  }

  destroy(): void {
    for (const unsubscribe of this.unsubscribers) unsubscribe();
    this.unsubscribers = [];
    this.state = null;
  }
}

export const flappyDefinition: GameDefinition = {
  apiVersion: 1,
  meta: flappyMeta,
  create(ctx: GameContext) {
    return new FlappyGame(ctx);
  },
};
