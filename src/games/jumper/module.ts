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
  /** First steer input starts the run (M4 UX P1: drag steering is
   * invisible — nothing should move before the player engages). */
  private armed = false;
  private unsubscribers: (() => void)[] = [];

  constructor(private readonly ctx: GameContext) {}

  init(): void {
    this.unsubscribers.push(
      this.ctx.input.onPointer((p) => this.onPointer(p)),
      this.ctx.input.onKey((k) => {
        if (k.action !== "down" || !this.state) return;
        if (k.code === "ArrowLeft") {
          this.armed = true;
          steer(this.state, this.state.x - KEY_NUDGE);
        } else if (k.code === "ArrowRight") {
          this.armed = true;
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
    this.armed = false; // stand on the platform until the first steer
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
    if (!this.armed) return; // frozen until the first steer
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

    // Venue depth: gradient + two parallax speck layers keyed to camera.
    const sky = g.createLinearGradient(0, 0, 0, DESIGN.h);
    sky.addColorStop(0, "#1a0c33");
    sky.addColorStop(1, "#2b1146");
    g.fillStyle = sky;
    g.fillRect(0, 0, DESIGN.w, DESIGN.h);
    for (let layer = 0; layer < 2; layer++) {
      const speed = layer === 0 ? 0.25 : 0.55;
      g.fillStyle =
        layer === 0 ? "rgba(139,124,255,0.22)" : "rgba(255,143,184,0.26)";
      for (let i = 0; i < 26; i++) {
        const px = (i * 89 + layer * 41) % DESIGN.w;
        const py =
          (((i * 53 + layer * 17) % DESIGN.h) -
            ((state.cameraY * speed) % DESIGN.h) +
            DESIGN.h * 2) %
          DESIGN.h;
        g.fillRect(px, py, 2, 2);
      }
    }

    // Platforms as neon stage bars: soft under-glow, body, lit top edge.
    for (const platform of state.platforms) {
      const screenY = platform.y - state.cameraY;
      if (screenY < -PLATFORM_H || screenY > DESIGN.h) continue;
      g.fillStyle = "rgba(139, 124, 255, 0.25)";
      g.beginPath();
      g.roundRect(
        platform.x - 3,
        screenY - 2,
        PLATFORM_W + 6,
        PLATFORM_H + 6,
        7,
      );
      g.fill();
      g.fillStyle = COLORS.platform;
      g.beginPath();
      g.roundRect(platform.x, screenY, PLATFORM_W, PLATFORM_H, 5);
      g.fill();
      g.fillStyle = "rgba(244, 236, 255, 0.65)";
      g.fillRect(platform.x + 4, screenY + 1, PLATFORM_W - 8, 2);
      // Speaker-grill dots on every third platform (hash by y, stable
      // per platform — deterministic detail, no RNG).
      if (Math.abs(Math.round(platform.y)) % 3 === 0) {
        g.fillStyle = "rgba(20, 10, 38, 0.5)";
        for (let dcol = 0; dcol < 4; dcol++) {
          g.beginPath();
          g.arc(
            platform.x + 14 + dcol * 12,
            screenY + PLATFORM_H - 3.5,
            1.6,
            0,
            Math.PI * 2,
          );
          g.fill();
        }
      }
    }

    // The climber: bunny-eared bounce blob (hitbox rect unchanged),
    // squashed by vertical velocity for landing/launch feel.
    const px = state.x;
    const py = state.y - state.cameraY;
    const vy = (state as { vy?: number }).vy ?? 0;
    const squash = Math.max(0.82, Math.min(1.18, 1 - vy * 0.012));
    g.save();
    g.translate(px + PLAYER_W / 2, py + PLAYER_H);
    g.scale(2 - squash, squash);
    g.fillStyle = COLORS.player;
    g.beginPath();
    g.roundRect(-PLAYER_W / 2, -PLAYER_H, PLAYER_W, PLAYER_H, 9);
    g.fill();
    // ears
    g.beginPath();
    g.roundRect(-PLAYER_W * 0.32, -PLAYER_H - 9, 7, 12, 3.5);
    g.roundRect(PLAYER_W * 0.32 - 7, -PLAYER_H - 9, 7, 12, 3.5);
    g.fill();
    // eyes
    g.fillStyle = "#f4ecff";
    g.beginPath();
    g.arc(-6, -PLAYER_H * 0.55, 4, 0, Math.PI * 2);
    g.arc(6, -PLAYER_H * 0.55, 4, 0, Math.PI * 2);
    g.fill();
    g.fillStyle = "#2b1146";
    g.beginPath();
    g.arc(-6, -PLAYER_H * 0.55, 1.8, 0, Math.PI * 2);
    g.arc(6, -PLAYER_H * 0.55, 1.8, 0, Math.PI * 2);
    g.fill();
    g.restore();

    // Side vignette: pulls the eye toward the climb column.
    const vignette = g.createLinearGradient(0, 0, DESIGN.w, 0);
    vignette.addColorStop(0, "rgba(10, 4, 20, 0.35)");
    vignette.addColorStop(0.18, "rgba(10, 4, 20, 0)");
    vignette.addColorStop(0.82, "rgba(10, 4, 20, 0)");
    vignette.addColorStop(1, "rgba(10, 4, 20, 0.35)");
    g.fillStyle = vignette;
    g.fillRect(0, 0, DESIGN.w, DESIGN.h);

    // Chart-position HUD — the progression hook (docs: visible rank).
    g.fillStyle = "rgba(20, 10, 38, 0.55)";
    g.beginPath();
    g.roundRect(8, 8, 76, 34, 10);
    g.fill();
    g.fillStyle = COLORS.rankText;
    g.font = "800 22px system-ui, sans-serif";
    g.textAlign = "left";
    g.textBaseline = "top";
    g.fillText(`#${rankOf(state)}`, 16, 14);
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
      this.armed = true;
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
