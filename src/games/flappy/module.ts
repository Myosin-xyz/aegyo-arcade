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
  /** Constant draw-only gradients, built once (lazy) — see render(). */
  private skyGradient: CanvasGradient | null = null;
  private pipeGradient: CanvasGradient | null = null;
  private wingGradient: CanvasGradient | null = null;
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

  /**
   * Build the constant (position-independent) gradients once. Their stops
   * and coordinates never change, so rebuilding them every frame was pure
   * waste. The pipe gradient spans 0..PIPE_WIDTH and is translated to each
   * pipe at fill time; the wing gradient's coords are transformed by the
   * CTM at paint — both stay draw-identical. Local vars let the compiler
   * narrow away the null without an assertion.
   */
  private ensureGradients(g: CanvasRenderingContext2D): {
    sky: CanvasGradient;
    pipe: CanvasGradient;
    wing: CanvasGradient;
  } {
    let sky = this.skyGradient;
    let pipe = this.pipeGradient;
    let wing = this.wingGradient;
    if (!sky || !pipe || !wing) {
      sky = g.createLinearGradient(0, 0, 0, FLOOR_Y);
      sky.addColorStop(0, "#150a2b");
      sky.addColorStop(1, "#341457");
      pipe = g.createLinearGradient(0, 0, PIPE_WIDTH, 0);
      pipe.addColorStop(0, "#5b21c9");
      pipe.addColorStop(0.5, "#7b2ff7");
      pipe.addColorStop(1, "#4a18a8");
      wing = g.createLinearGradient(0, 0, -PLAYER_RADIUS * 1.7, 0);
      wing.addColorStop(0, "#fff6ee");
      wing.addColorStop(1, "#ffd9ec");
      this.skyGradient = sky;
      this.pipeGradient = pipe;
      this.wingGradient = wing;
    }
    return { sky, pipe, wing };
  }

  render(): void {
    if (this.ctx.surface.kind !== "canvas" || !this.state) return;
    const { context2d: g } = this.ctx.surface;
    const state = this.state;
    const grad = this.ensureGradients(g);

    // Render-only trail bookkeeping (never touches the simulation).
    if (this.armed && state.status === "running") {
      this.trail.push(state.y);
      if (this.trail.length > 7) this.trail.shift();
    } else if (this.trail.length > 0 && state.status !== "running") {
      this.trail.length = 0;
    }

    // Concert night sky + deterministic crowd-lightstick specks (hash
    // scatter — render stays allocation-light and RNG-free).
    g.fillStyle = grad.sky;
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
      // Cached gradient spans 0..PIPE_WIDTH; translate places it per pipe
      // (identical to the old per-pipe createLinearGradient at pipe.x).
      g.save();
      g.translate(pipe.x, 0);
      g.fillStyle = grad.pipe;
      g.beginPath();
      g.roundRect(0, -8, PIPE_WIDTH, topH + 8, 6);
      g.roundRect(0, botY, PIPE_WIDTH, FLOOR_Y - botY + 8, 6);
      g.fill();
      g.fillStyle = "#ff8fb8";
      g.fillRect(0, topH - 4, PIPE_WIDTH, 4);
      g.fillRect(0, botY, PIPE_WIDTH, 4);
      g.restore();
    }

    // Feather trail behind the flyer (render-only history).
    for (let i = 0; i < this.trail.length; i++) {
      const a = ((i + 1) / this.trail.length) * 0.18;
      g.globalAlpha = a;
      g.fillStyle = "#fff6ee";
      g.beginPath();
      g.arc(
        PLAYER_X - (this.trail.length - i) * 7,
        this.trail[i] - 2,
        PLAYER_RADIUS * 0.4,
        0,
        Math.PI * 2,
      );
      g.fill();
    }
    g.globalAlpha = 1;

    // The flyer: a winged idol cartoon (team feedback 2026-07-19 —
    // shirtless, tattooed arm, lip ring; see CONTENT_REGISTER for the
    // likeness gate). Hitbox stays the PLAYER_RADIUS circle — draw-only.
    const R = PLAYER_RADIUS;
    const tilt = Math.max(-0.5, Math.min(0.6, state.vy * 0.045));
    // Wings flap with vertical velocity: up-beat right after a flap.
    const flapBeat = Math.max(-0.9, Math.min(0.9, -state.vy * 0.08));
    g.save();
    g.translate(PLAYER_X, state.y);
    g.rotate(tilt);

    // Wings (behind the body): two feathered arcs, angle driven by vy.
    for (const side of [-1, 1] as const) {
      g.save();
      g.scale(side, 1);
      g.translate(-R * 0.45, -R * 0.15);
      g.rotate(-0.55 - flapBeat * 0.55);
      // Cached constant gradient; its coords are mapped by the current
      // CTM at paint, so the per-side scale/rotate still applies.
      g.fillStyle = grad.wing;
      g.beginPath();
      g.ellipse(-R * 0.85, 0, R * 1.05, R * 0.42, 0.12, 0, Math.PI * 2);
      g.fill();
      g.fillStyle = "rgba(255, 143, 184, 0.45)";
      for (let f = 0; f < 3; f++) {
        g.beginPath();
        g.ellipse(
          -R * (0.55 + f * 0.45),
          R * 0.16,
          R * 0.3,
          R * 0.12,
          0.1,
          0,
          Math.PI * 2,
        );
        g.fill();
      }
      g.restore();
    }

    // Torso: shirtless, warm skin tone.
    g.fillStyle = "#f2c49b";
    g.beginPath();
    g.roundRect(-R * 0.5, -R * 0.35, R, R * 1.05, R * 0.3);
    g.fill();
    // Chest line + navel (cartoon shading).
    g.strokeStyle = "rgba(146, 90, 51, 0.5)";
    g.lineWidth = 1;
    g.beginPath();
    g.moveTo(-R * 0.18, R * 0.05);
    g.lineTo(R * 0.18, R * 0.05);
    g.stroke();
    // Shorts.
    g.fillStyle = "#2b1146";
    g.beginPath();
    g.roundRect(-R * 0.5, R * 0.55, R, R * 0.4, R * 0.14);
    g.fill();
    // Arms: trailing arm carries the tattoo sleeve (dark ink marks).
    g.fillStyle = "#f2c49b";
    g.beginPath();
    g.roundRect(-R * 0.92, -R * 0.3, R * 0.42, R * 0.95, R * 0.2);
    g.roundRect(R * 0.5, -R * 0.3, R * 0.42, R * 0.95, R * 0.2);
    g.fill();
    g.strokeStyle = "rgba(43, 17, 70, 0.75)";
    g.lineWidth = 1.4;
    for (let m = 0; m < 3; m++) {
      g.beginPath();
      g.moveTo(-R * 0.88, -R * 0.12 + m * R * 0.26);
      g.lineTo(-R * 0.54, -R * 0.02 + m * R * 0.26);
      g.stroke();
    }

    // Head: dark shaggy hair, soft face, lip ring glint.
    g.fillStyle = "#f6d0ab";
    g.beginPath();
    g.arc(0, -R * 0.85, R * 0.62, 0, Math.PI * 2);
    g.fill();
    g.fillStyle = "#241430";
    g.beginPath();
    g.arc(0, -R * 1.0, R * 0.62, Math.PI * 0.92, Math.PI * 2.08);
    g.fill();
    // Fringe strands.
    g.beginPath();
    g.ellipse(-R * 0.22, -R * 1.02, R * 0.24, R * 0.34, 0.5, 0, Math.PI * 2);
    g.ellipse(R * 0.2, -R * 1.04, R * 0.22, R * 0.3, -0.4, 0, Math.PI * 2);
    g.fill();
    // Eyes + tiny smile.
    g.fillStyle = "#241430";
    g.beginPath();
    g.arc(-R * 0.22, -R * 0.82, R * 0.07, 0, Math.PI * 2);
    g.arc(R * 0.22, -R * 0.82, R * 0.07, 0, Math.PI * 2);
    g.fill();
    g.strokeStyle = "#a4553a";
    g.lineWidth = 1.2;
    g.beginPath();
    g.arc(0, -R * 0.62, R * 0.16, 0.25, Math.PI - 0.25);
    g.stroke();
    // Lip ring: a tiny silver hoop at the lower lip.
    g.strokeStyle = "#dfe6f2";
    g.lineWidth = 1.1;
    g.beginPath();
    g.arc(R * 0.11, -R * 0.5, R * 0.06, 0, Math.PI * 2);
    g.stroke();

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
