/**
 * Comeback Climb — ShellLoopGame (docs/games/jumper.md). Horizontal
 * drag/touch steering through the InputBus (pointer position sets the
 * steering target); arrows nudge as a keyboard enhancement; the HUD shows
 * the current chart rank (#100 → #1).
 */

import type {
  GameContext,
  GameDefinition,
  NormalizedPointer,
  RunContext,
  ShellLoopGame,
} from "@/shell/contract";
import { jumperMeta } from "./meta";
import {
  createJumperState,
  rankOf,
  steer,
  step,
  DESIGN,
  PLATFORM_H,
  PLATFORM_W,
  PLAYER_H,
  PLAYER_W,
  type JumperState,
} from "./logic";

const SIM_STEP_MS = 1000 / 60;
const KEY_NUDGE = 60;

const COLORS = {
  background: "#2b1146",
  platform: "#ffd166",
  player: "#ff4f8b",
  rankText: "rgba(255, 255, 255, 0.85)",
} as const;

class JumperGame implements ShellLoopGame {
  readonly loop = "shell" as const;
  private state: JumperState | null = null;
  private rng: (() => number) | null = null;
  private accumulator = 0;
  private paused = false;
  private endedReported = false;
  private dragging = false;
  private unsubscribers: (() => void)[] = [];

  constructor(private readonly ctx: GameContext) {}

  init(): void {
    this.unsubscribers.push(
      this.ctx.input.onPointer((p) => this.onPointer(p)),
      this.ctx.input.onKey((k) => {
        if (k.action !== "down" || !this.state) return;
        if (k.code === "ArrowLeft") {
          steer(this.state, this.state.x - KEY_NUDGE);
        } else if (k.code === "ArrowRight") {
          steer(this.state, this.state.x + KEY_NUDGE);
        }
      }),
    );
  }

  start(run: RunContext): void {
    this.rng = run.random;
    this.state = createJumperState(run.random);
    this.accumulator = 0;
    this.endedReported = false;
    this.dragging = false;
    this.ctx.report.score(0);
  }

  pause(): void {
    this.paused = true;
    this.dragging = false; // no drag survives a pause
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
      const before = state.climbed;
      step(state, rng);
      if (state.climbed !== before) this.ctx.report.score(state.climbed);
      if (state.status !== "running") {
        if (!this.endedReported) {
          this.endedReported = true;
          this.ctx.report.end({
            reason: state.status === "completed" ? "completed" : "lost",
          });
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

    g.fillStyle = COLORS.platform;
    for (const platform of state.platforms) {
      const screenY = platform.y - state.cameraY;
      if (screenY < -PLATFORM_H || screenY > DESIGN.h) continue;
      g.beginPath();
      g.roundRect(platform.x, screenY, PLATFORM_W, PLATFORM_H, 5);
      g.fill();
    }

    g.fillStyle = COLORS.player;
    g.beginPath();
    g.roundRect(state.x, state.y - state.cameraY, PLAYER_W, PLAYER_H, 8);
    g.fill();

    // Chart-position HUD — the progression hook (docs: visible rank).
    g.fillStyle = COLORS.rankText;
    g.font = "700 24px system-ui, sans-serif";
    g.textAlign = "left";
    g.textBaseline = "top";
    g.fillText(`#${rankOf(state)}`, 12, 12);
  }

  destroy(): void {
    for (const unsubscribe of this.unsubscribers) unsubscribe();
    this.unsubscribers = [];
    this.state = null;
    this.dragging = false;
  }

  private onPointer(p: NormalizedPointer): void {
    if (!this.state) return;
    if (p.action === "down") {
      this.dragging = true;
      steer(this.state, p.x - PLAYER_W / 2);
      return;
    }
    if (p.action === "move" && this.dragging) {
      steer(this.state, p.x - PLAYER_W / 2);
      return;
    }
    if (p.action === "up" || p.action === "cancel") {
      this.dragging = false;
    }
  }
}

export const jumperDefinition: GameDefinition = {
  apiVersion: 1,
  meta: jumperMeta,
  create(ctx: GameContext) {
    return new JumperGame(ctx);
  },
};
