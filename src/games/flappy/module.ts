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
  private unsubscribers: (() => void)[] = [];

  constructor(private readonly ctx: GameContext) {}

  init(): void {
    this.unsubscribers.push(
      this.ctx.input.onPointer((p) => {
        if (p.action === "down" && this.state) flap(this.state);
      }),
      this.ctx.input.onKey((k) => {
        if (k.action === "down" && k.code === "Space" && this.state) {
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
    this.accumulator += dtMs;
    while (this.accumulator >= SIM_STEP_MS) {
      this.accumulator -= SIM_STEP_MS;
      const before = state.score;
      step(state, rng);
      if (state.score !== before) this.ctx.report.score(state.score);
      if (state.status !== "running") {
        if (!this.endedReported) {
          this.endedReported = true;
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

    g.fillStyle = COLORS.background;
    g.fillRect(0, 0, DESIGN.w, DESIGN.h);
    g.fillStyle = COLORS.floor;
    g.fillRect(0, FLOOR_Y, DESIGN.w, DESIGN.h - FLOOR_Y);

    g.fillStyle = COLORS.barricade;
    for (const pipe of state.pipes) {
      g.fillRect(pipe.x, 0, PIPE_WIDTH, pipe.gapCenter - GAP_HALF);
      g.fillRect(
        pipe.x,
        pipe.gapCenter + GAP_HALF,
        PIPE_WIDTH,
        FLOOR_Y - (pipe.gapCenter + GAP_HALF),
      );
    }

    // Lightstick: gold body, pink tip.
    g.fillStyle = COLORS.lightstick;
    g.beginPath();
    g.arc(PLAYER_X, state.y, PLAYER_RADIUS, 0, Math.PI * 2);
    g.fill();
    g.fillStyle = COLORS.lightstickTip;
    g.beginPath();
    g.arc(PLAYER_X + 6, state.y - 4, 4, 0, Math.PI * 2);
    g.fill();
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
