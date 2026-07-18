/**
 * Aegyo Snake — first production ShellLoopGame (docs/games/snake.md).
 *
 * The shell owns the loop, canvas sizing, and lifecycle; this module is a
 * pure-ish state machine over dt plus a renderer. Movement uses a fixed
 * 140ms accumulator (recovered mock feel); input is a VISIBLE on-screen
 * D-pad (docs requirement) + swipe + keyboard arrows, all via the InputBus;
 * all randomness comes from the run's seeded PRNG, so counted runs replay
 * deterministically.
 */

import type {
  GameContext,
  GameDefinition,
  NormalizedPointer,
  RunContext,
  ShellLoopGame,
} from "@/shell/contract";
import { snakeMeta } from "./meta";
import {
  createSnakeState,
  queueDirection,
  step,
  STEP_MS,
  type Dir,
  type SnakeState,
} from "./logic";
import { CONTROL_ZONES, hitControl } from "./controls";
import { arp, blip, sweep } from "@/shell/sfx-presets";

const SWIPE_MIN_PX = 24;

const COLORS = {
  background: "#2b1146",
  board: "#1c0a33",
  gridLine: "rgba(255, 255, 255, 0.05)",
  body: "#ffffff",
  head: "#ff4f8b",
  food: "#ffd166",
  control: "rgba(255, 255, 255, 0.10)",
  controlArrow: "rgba(255, 255, 255, 0.85)",
} as const;

class SnakeGame implements ShellLoopGame {
  readonly loop = "shell" as const;
  private state: SnakeState | null = null;
  private rng: (() => number) | null = null;
  private accumulator = 0;
  private paused = false;
  /** First intentional input starts movement (M4 UX P1: the snake must
   * not be dying while the player is still orienting). */
  private armed = false;
  private endedReported = false;
  private swipeStart: { x: number; y: number } | null = null;
  private unsubscribers: (() => void)[] = [];

  constructor(private readonly ctx: GameContext) {}

  init(): void {
    this.ctx.audio.register("eat", blip(880, 0.06, "square", 0.05));
    this.ctx.audio.register("win", arp([523, 659, 784, 1047]));
    this.ctx.audio.register("lose", sweep(440, 90, 0.3, "sawtooth", 0.04));
    this.unsubscribers.push(
      this.ctx.input.onPointer((p) => this.onPointer(p)),
      this.ctx.input.onKey((k) => {
        if (k.action !== "down") return;
        const dir = KEY_DIRS[k.code];
        if (dir) this.tryQueue(dir);
      }),
    );
  }

  start(run: RunContext): void {
    this.rng = run.random;
    this.state = createSnakeState(run.random);
    this.accumulator = 0;
    this.endedReported = false;
    this.armed = false; // wait for the first intentional input
    this.swipeStart = null; // no gesture survives a restart
    this.ctx.report.score(0);
  }

  pause(): void {
    this.paused = true;
    this.swipeStart = null; // no gesture survives a pause
  }

  resume(): void {
    this.paused = false;
  }

  update(dtMs: number): void {
    const state = this.state;
    const rng = this.rng;
    if (!state || !rng || this.paused || state.status !== "running") return;
    if (!this.armed) return; // frozen until the first input
    this.accumulator += dtMs;
    while (this.accumulator >= STEP_MS) {
      this.accumulator -= STEP_MS;
      const before = state.collected;
      step(state, rng);
      if (state.collected !== before) {
        this.ctx.audio.play("eat");
        this.ctx.report.score(state.collected);
      }
      if (state.status !== "running") {
        if (!this.endedReported) {
          this.endedReported = true;
          this.ctx.audio.play(state.status === "completed" ? "win" : "lose");
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
    const { context2d: g, designBox } = this.ctx.surface;
    const state = this.state;
    const boardSize = designBox.w; // 360×360 board
    const offsetY = (designBox.h - boardSize) / 2;
    const cell = boardSize / state.grid;

    g.fillStyle = COLORS.background;
    g.fillRect(0, 0, designBox.w, designBox.h);
    g.fillStyle = COLORS.board;
    g.fillRect(0, offsetY, boardSize, boardSize);
    // Checkerboard tint instead of grid lines — calmer, more "venue
    // floor" (style pass); same geometry.
    g.fillStyle = "rgba(255, 255, 255, 0.025)";
    for (let gy = 0; gy < state.grid; gy++) {
      for (let gx = gy % 2 === 0 ? 1 : 0; gx < state.grid; gx += 2) {
        g.fillRect(gx * cell, offsetY + gy * cell, cell, cell);
      }
    }
    // Neon frame around the play field.
    g.strokeStyle = "rgba(255, 79, 139, 0.45)";
    g.lineWidth = 2;
    g.strokeRect(1, offsetY + 1, boardSize - 2, boardSize - 2);
    g.strokeStyle = "rgba(255, 143, 184, 0.12)";
    g.lineWidth = 6;
    g.strokeRect(3, offsetY + 3, boardSize - 6, boardSize - 6);

    if (state.food) {
      // Photocard pickup: gold card, pink face, soft pulse (cosmetic
      // clock only — simulation stays seeded/deterministic).
      const fx = state.food.x * cell + cell / 2;
      const fy = offsetY + state.food.y * cell + cell / 2;
      const pulse = 0.9 + 0.1 * Math.sin(performance.now() * 0.005);
      const cardW = cell * 0.62 * pulse;
      const cardH = cell * 0.8 * pulse;
      g.fillStyle = "rgba(255, 209, 102, 0.25)";
      g.beginPath();
      g.arc(fx, fy, cell * 0.55, 0, Math.PI * 2);
      g.fill();
      g.fillStyle = COLORS.food;
      g.beginPath();
      g.roundRect(fx - cardW / 2, fy - cardH / 2, cardW, cardH, 3);
      g.fill();
      g.fillStyle = "#ff8fb8";
      g.beginPath();
      g.roundRect(
        fx - cardW * 0.32,
        fy - cardH * 0.3,
        cardW * 0.64,
        cardH * 0.48,
        2,
      );
      g.fill();
    }

    // Body: head pink fading to violet down the tail; head gets eyes
    // looking along the travel direction.
    const tailLength = Math.max(1, state.body.length - 1);
    for (let i = state.body.length - 1; i >= 0; i--) {
      const segment = state.body[i];
      if (i === 0) {
        g.fillStyle = COLORS.head;
      } else {
        const f = i / tailLength;
        const r = Math.round(255 + (139 - 255) * f);
        const gg = Math.round(79 + (124 - 79) * f);
        const b = Math.round(139 + (255 - 139) * f);
        g.fillStyle = `rgb(${r}, ${gg}, ${b})`;
      }
      const pad = 1;
      g.beginPath();
      g.roundRect(
        segment.x * cell + pad,
        offsetY + segment.y * cell + pad,
        cell - pad * 2,
        cell - pad * 2,
        i === 0 ? 6 : 4,
      );
      g.fill();
    }

    // Soft glow under the head so the leading edge always pops.
    const glowHead = state.body[0];
    const ghx = glowHead.x * cell + cell / 2;
    const ghy = offsetY + glowHead.y * cell + cell / 2;
    const headGlow = g.createRadialGradient(ghx, ghy, 1, ghx, ghy, cell * 1.4);
    headGlow.addColorStop(0, "rgba(255, 79, 139, 0.35)");
    headGlow.addColorStop(1, "rgba(255, 79, 139, 0)");
    g.fillStyle = headGlow;
    g.beginPath();
    g.arc(ghx, ghy, cell * 1.4, 0, Math.PI * 2);
    g.fill();

    const head = state.body[0];
    const neck = state.body[1] ?? head;
    const dx = Math.sign(head.x - neck.x);
    const dy = Math.sign(head.y - neck.y);
    const hx = head.x * cell + cell / 2;
    const hy = offsetY + head.y * cell + cell / 2;
    const spread = cell * 0.22;
    const look = cell * 0.16;
    g.fillStyle = "#ffffff";
    g.beginPath();
    g.arc(
      hx - dy * spread + dx * look,
      hy - dx * spread + dy * look,
      cell * 0.13,
      0,
      Math.PI * 2,
    );
    g.arc(
      hx + dy * spread + dx * look,
      hy + dx * spread + dy * look,
      cell * 0.13,
      0,
      Math.PI * 2,
    );
    g.fill();
    g.fillStyle = "#2b1146";
    g.beginPath();
    g.arc(
      hx - dy * spread + dx * (look + 1.5),
      hy - dx * spread + dy * (look + 1.5),
      cell * 0.06,
      0,
      Math.PI * 2,
    );
    g.arc(
      hx + dy * spread + dx * (look + 1.5),
      hy + dx * spread + dy * (look + 1.5),
      cell * 0.06,
      0,
      Math.PI * 2,
    );
    g.fill();

    this.renderControls(g);
  }

  /** Visible on-screen D-pad (docs/games/snake.md input requirement). */
  private renderControls(g: CanvasRenderingContext2D): void {
    for (const zone of CONTROL_ZONES) {
      g.fillStyle = COLORS.control;
      g.beginPath();
      g.roundRect(zone.x, zone.y, zone.w, zone.h, 12);
      g.fill();

      const cx = zone.x + zone.w / 2;
      const cy = zone.y + zone.h / 2;
      const r = 11;
      g.fillStyle = COLORS.controlArrow;
      g.beginPath();
      if (zone.dir === "up") {
        g.moveTo(cx, cy - r);
        g.lineTo(cx - r, cy + r * 0.7);
        g.lineTo(cx + r, cy + r * 0.7);
      } else if (zone.dir === "down") {
        g.moveTo(cx, cy + r);
        g.lineTo(cx - r, cy - r * 0.7);
        g.lineTo(cx + r, cy - r * 0.7);
      } else if (zone.dir === "left") {
        g.moveTo(cx - r, cy);
        g.lineTo(cx + r * 0.7, cy - r);
        g.lineTo(cx + r * 0.7, cy + r);
      } else {
        g.moveTo(cx + r, cy);
        g.lineTo(cx - r * 0.7, cy - r);
        g.lineTo(cx - r * 0.7, cy + r);
      }
      g.closePath();
      g.fill();
    }
  }

  destroy(): void {
    for (const unsubscribe of this.unsubscribers) unsubscribe();
    this.unsubscribers = [];
    this.state = null;
    this.swipeStart = null;
  }

  private onPointer(p: NormalizedPointer): void {
    if (!this.state) return;
    if (p.action === "down") {
      // Visible D-pad first (docs requirement); swipe elsewhere. A D-pad
      // press also discards any in-flight swipe so a stale gesture can't
      // overwrite the queued direction later (M2 re-review P2).
      const controlDir = hitControl(p.x, p.y);
      if (controlDir) {
        this.swipeStart = null;
        this.tryQueue(controlDir);
        return;
      }
      this.swipeStart = { x: p.x, y: p.y };
      return;
    }
    if (p.action === "cancel") {
      this.swipeStart = null;
      return;
    }
    if (p.action !== "up" || !this.swipeStart) return;
    const dx = p.x - this.swipeStart.x;
    const dy = p.y - this.swipeStart.y;
    this.swipeStart = null;
    if (Math.max(Math.abs(dx), Math.abs(dy)) < SWIPE_MIN_PX) return;
    const dir: Dir =
      Math.abs(dx) > Math.abs(dy)
        ? dx > 0
          ? "right"
          : "left"
        : dy > 0
          ? "down"
          : "up";
    this.tryQueue(dir);
  }

  /** Single arming path: only an ACCEPTED input (same-direction or a
   * legal turn) starts the run — a rejected reversal as the first press
   * must not launch the snake the other way (M4 review). */
  private tryQueue(dir: Dir): void {
    if (!this.state) return;
    if (queueDirection(this.state, dir)) this.armed = true;
  }
}

const KEY_DIRS: Record<string, Dir> = {
  ArrowUp: "up",
  ArrowDown: "down",
  ArrowLeft: "left",
  ArrowRight: "right",
};

export const snakeDefinition: GameDefinition = {
  apiVersion: 1,
  meta: snakeMeta,
  create(ctx: GameContext) {
    return new SnakeGame(ctx);
  },
};
