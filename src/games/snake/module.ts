/**
 * Snake Freebies — ShellLoopGame adapter (docs/games/snake-freebies.md).
 *
 * The shell owns the loop and canvas; this module feeds real time into the
 * pure core (which ticks on each level's own cadence) and wires input
 * through the InputBus.
 *
 * MOBILE (Simon 2026-07-26: ~95% of traffic is the IG/TikTok in-app
 * browser): three input paths, all pointer-first —
 *   1. SWIPE anywhere on the surface (primary on phones),
 *   2. an on-canvas D-PAD under the arena, acting on pointer DOWN (not
 *      click) for zero latency,
 *   3. arrow keys / WASD as the desktop enhancement.
 * Arena sizing comes from the shell's CanvasSurfaceManager (design-box
 * letterboxing + DPR cap), never from the delivery's own resize handler —
 * that is what keeps it correct in an in-app browser whose viewport lies.
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
  FREEBIE_SPRITE_COUNT,
  continueFromLevelBreak,
  createSnakeState,
  queueDirection,
  step,
  type Cell,
  type Rng,
  type SnakeState,
} from "./logic";
import { DESIGN_W, renderSnake, type SnakeImages } from "./render";
import { arp, blip, sweep, thud } from "@/shell/sfx-presets";
import {
  createHitFeedback,
  drawHitFlash,
  shakeOffset,
  tickHitFeedback,
  triggerHitFeedback,
} from "@/shell/feedback";

const ASSETS_BASE = "/games/snake/";
/** Minimum pointer travel (design px) that counts as a swipe. */
const SWIPE_MIN = 18;
/** D-pad geometry, below the arena (see `dpadRects` for the sizing math). */
const DPAD_CY = 528;
const DPAD_BTN = 58;
/** DaiDai mobile UX pass (2026-08-03): separate the four thumb targets
 * so adjacent directions do not read or feel like one connected pad. */
const DPAD_GAP = 10;
const TOAST_MS = 900;
const GIFT_TOAST_COUNT = 6;

const DIRS: Record<string, Cell> = {
  up: { x: 0, y: -1 },
  down: { x: 0, y: 1 },
  left: { x: -1, y: 0 },
  right: { x: 1, y: 0 },
};

const KEY_DIRS: Record<string, Cell> = {
  ArrowUp: DIRS.up,
  ArrowDown: DIRS.down,
  ArrowLeft: DIRS.left,
  ArrowRight: DIRS.right,
  KeyW: DIRS.up,
  KeyS: DIRS.down,
  KeyA: DIRS.left,
  KeyD: DIRS.right,
};

interface Rect {
  x: number;
  y: number;
  w: number;
  h: number;
}

/**
 * D-pad hit rects in design space (also used to draw it).
 *
 * SIZING (M2.5 review P2 — an earlier 46 design px assumed a WIDTH-limited
 * letterbox): on a tall phone the canvas is HEIGHT-limited, so the scale is
 * `canvasH / 640`, not `canvasW / 360`. At the measured 320×568 worst case
 * the canvas is 298×531 → scale 0.83, which turned 46 design px into only
 * 38 CSS px and left 15 px under the Down button — inside a typical iOS
 * home-indicator inset. At 58 design px the same viewport yields ≈48 CSS px
 * (clears the 44 px guidance) with ≈45 px of clearance below. `dpad-touch-
 * targets` in tests/unit/snake-module.test.ts regresses both numbers.
 */
export function dpadRects(): Record<string, Rect> {
  const cx = DESIGN_W / 2;
  const s = DPAD_BTN;
  const g = DPAD_GAP;
  return {
    up: { x: cx - s / 2, y: DPAD_CY - s - g, w: s, h: s },
    down: { x: cx - s / 2, y: DPAD_CY + g, w: s, h: s },
    left: { x: cx - s * 1.5 - g, y: DPAD_CY - s / 2, w: s, h: s },
    right: { x: cx + s / 2 + g, y: DPAD_CY - s / 2, w: s, h: s },
  };
}

function loadImage(
  src: string,
  signal: AbortSignal,
): Promise<HTMLImageElement> {
  return new Promise((resolve, reject) => {
    if (signal.aborted) {
      reject(new DOMException("snake init aborted", "AbortError"));
      return;
    }
    const img = new Image();
    const onAbort = () =>
      reject(new DOMException("snake init aborted", "AbortError"));
    signal.addEventListener("abort", onAbort, { once: true });
    img.onload = () => {
      signal.removeEventListener("abort", onAbort);
      resolve(img);
    };
    img.onerror = () => {
      signal.removeEventListener("abort", onAbort);
      reject(new Error(`snake asset failed: ${src}`));
    };
    img.src = src;
  });
}

class SnakeGame implements ShellLoopGame {
  readonly loop = "shell" as const;
  private state: SnakeState | null = null;
  private rng: Rng | null = null;
  private images: SnakeImages | null = null;
  private paused = false;
  private endedReported = false;
  private hitFx = createHitFeedback();
  /** Terminal-loss hold: the flash must PAINT before report.end stops
   * the loop (audit P1 — same trap as the flappy endRun lesson). */
  private endHoldMs = 0;
  /** First input starts the run (no dying while orienting). */
  private armed = false;
  private lastScore = -1;
  private lastLives = -1;
  private toastKey: string | null = null;
  private toastMs = 0;
  private arcadeFont = "monospace";
  /**
   * Gesture bookkeeping is per PHYSICAL pointer (M2.5 review P2): with a
   * single global origin, a second finger pressing the D-pad could consume
   * the first finger's swipe on release and enqueue a turn nobody asked for.
   */
  private swipeOrigins = new Map<number, { x: number; y: number }>();
  private pressedDirs = new Map<number, string>();
  private unsubscribers: (() => void)[] = [];

  constructor(private readonly ctx: GameContext) {}

  async init(signal: AbortSignal): Promise<void> {
    this.ctx.audio.register("gift", blip(880, 0.06, "triangle", 0.045));
    this.ctx.audio.register("levelUp", arp([523, 659, 784, 1047], 0.07));
    this.ctx.audio.register("die", thud(90, 0.22, 0.05));
    this.ctx.audio.register("lose", sweep(500, 80, 0.28, "sawtooth", 0.045));
    this.ctx.audio.register("win", arp([659, 784, 988, 1319], 0.08));

    const [head, gift, frame, ...freebies] = await Promise.all([
      loadImage(`${ASSETS_BASE}head.webp`, signal),
      loadImage(`${ASSETS_BASE}gift.webp`, signal),
      loadImage(`${ASSETS_BASE}frame.webp`, signal),
      ...Array.from({ length: FREEBIE_SPRITE_COUNT }, (_, i) =>
        loadImage(`${ASSETS_BASE}f${String(i).padStart(2, "0")}.webp`, signal),
      ),
    ]);
    this.images = { head, gift, frame, freebies };
    const resolvedArcadeFont = getComputedStyle(document.documentElement)
      .getPropertyValue("--font-arcade")
      .trim();
    if (resolvedArcadeFont) {
      this.arcadeFont = `${resolvedArcadeFont}, monospace`;
    }

    this.unsubscribers.push(
      this.ctx.input.onKey((k) => {
        if (k.action !== "down" || this.paused) return;
        const dir = KEY_DIRS[k.code];
        if (dir) this.turn(dir);
      }),
      this.ctx.input.onPointer((p) => this.onPointer(p)),
    );
  }

  start(run: RunContext): void {
    this.rng = run.random;
    this.state = createSnakeState(run.random);
    this.endedReported = false;
    this.hitFx = createHitFeedback(); // no stale flash after Play Again
    this.endHoldMs = 0;
    this.armed = false;
    this.lastScore = -1;
    this.lastLives = -1;
    this.toastKey = null;
    this.toastMs = 0;
    this.swipeOrigins.clear();
    this.pressedDirs.clear();
    this.ctx.report.score(0);
  }

  pause(): void {
    this.paused = true;
    this.swipeOrigins.clear();
    this.pressedDirs.clear();
  }

  resume(): void {
    this.paused = false;
  }

  update(dtMs: number): void {
    const state = this.state;
    const rng = this.rng;
    if (!state || !rng || this.paused) return;
    this.toastMs = Math.max(0, this.toastMs - dtMs);
    if (this.toastMs === 0) this.toastKey = null;
    if (state.status === "won" || state.status === "lost") {
      // The terminal hold spans UPDATES: without re-entering here, the
      // top guard would stall the pending end forever (audit P1 fix).
      if (!this.endedReported) {
        tickHitFeedback(this.hitFx, dtMs);
        this.finishTerminal(state.status, dtMs);
      }
      return;
    }
    // Level breaks wait for the player, like the delivery's GO! button.
    if (state.status === "levelBreak") return;
    if (!this.armed) return; // frozen until the first input

    const before = state.status;
    // step() RETURNS the new status: reading state.status back here would
    // keep TypeScript's pre-call narrowing and dead-end the comparisons.
    const after = step(state, dtMs, rng);
    tickHitFeedback(this.hitFx, dtMs);

    if (state.score !== this.lastScore) {
      if (this.lastScore >= 0) {
        this.ctx.audio.play("gift");
        this.toastKey = `game.snake.toast.gift.${
          (state.gifts - 1) % GIFT_TOAST_COUNT
        }`;
        this.toastMs = TOAST_MS;
      }
      this.lastScore = state.score;
      this.ctx.report.score(state.score);
    }
    if (this.lastLives >= 0 && state.lives < this.lastLives) {
      this.ctx.audio.play("die");
      triggerHitFeedback(this.hitFx);
      this.toastKey = "game.snake.toast.ouch";
      this.toastMs = TOAST_MS;
    }
    this.lastLives = state.lives;
    if (before === "playing" && after === "levelBreak") {
      this.ctx.audio.play("levelUp");
    }
    if (after === "won" || after === "lost") {
      this.finishTerminal(after, dtMs);
    }
  }

  /** Report the end once, holding a lost run ~300ms so the red wash
   * paints before report.end stops the loop (audit P1). */
  private finishTerminal(status: "won" | "lost", dtMs: number): void {
    if (this.endedReported) return;
    if (status === "lost" && this.endHoldMs === 0 && this.hitFx.flashMs > 0) {
      this.endHoldMs = 300;
    }
    if (this.endHoldMs > 0) {
      this.endHoldMs = Math.max(0, this.endHoldMs - dtMs);
      if (this.endHoldMs > 0) return;
    }
    this.endedReported = true;
    this.ctx.audio.play(status === "won" ? "win" : "lose");
    this.ctx.report.end({
      reason: status === "won" ? "completed" : "lost",
    });
  }

  render(): void {
    if (this.ctx.surface.kind !== "canvas" || !this.state || !this.images) {
      return;
    }
    const { context2d: g } = this.ctx.surface;
    const off = shakeOffset(this.hitFx);
    g.save();
    g.translate(off.x, off.y);
    renderSnake(g, this.state, this.images, this.ctx.t, performance.now(), {
      toast: this.toastKey ? this.ctx.t(this.toastKey) : null,
      toastOpacity: Math.min(1, this.toastMs / 250),
      arcadeFont: this.arcadeFont,
    });
    this.drawDpad(g);
    g.restore();
    drawHitFlash(g, this.hitFx, DESIGN_W, 640);
  }

  destroy(): void {
    for (const unsubscribe of this.unsubscribers) unsubscribe();
    this.unsubscribers = [];
    this.state = null;
    this.images = null;
  }

  /**
   * Queue a turn, arming the run on the first ACCEPTED one.
   *
   * Arming on a rejected turn (M2.5 review P1) meant that from the initial
   * right-facing state, tapping Left — a reversal the core refuses — still
   * unfroze the simulation and sent the snake right, a move the player
   * never asked for. Returns whether the direction was taken.
   */
  private turn(dir: Cell): boolean {
    const state = this.state;
    if (!state) return false;
    if (state.status === "levelBreak") return false;
    if (!queueDirection(state, dir)) return false;
    this.armed = true;
    return true;
  }

  private dpadHit(x: number, y: number): string | null {
    for (const [name, r] of Object.entries(dpadRects())) {
      if (x >= r.x && x <= r.x + r.w && y >= r.y && y <= r.y + r.h) return name;
    }
    return null;
  }

  /** Decode a drag into a turn once it clears SWIPE_MIN; axis of greater travel wins. */
  private resolveSwipe(
    origin: { x: number; y: number },
    p: NormalizedPointer,
  ): boolean {
    const dx = p.x - origin.x;
    const dy = p.y - origin.y;
    if (Math.max(Math.abs(dx), Math.abs(dy)) < SWIPE_MIN) return false;
    if (Math.abs(dx) > Math.abs(dy)) {
      this.turn(dx > 0 ? DIRS.right : DIRS.left);
    } else {
      this.turn(dy > 0 ? DIRS.down : DIRS.up);
    }
    return true;
  }

  private onPointer(p: NormalizedPointer): void {
    const state = this.state;
    if (!state || this.paused) return;

    if (p.action === "down") {
      // Level break: any tap continues (the delivery's GO! button).
      if (state.status === "levelBreak" && this.rng) {
        continueFromLevelBreak(state, this.rng);
        return;
      }
      // D-pad first — a press inside a button is a turn, not a swipe.
      const hit = this.dpadHit(p.x, p.y);
      if (hit) {
        this.pressedDirs.set(p.pointerId, hit);
        this.turn(DIRS[hit]);
        return;
      }
      this.swipeOrigins.set(p.pointerId, { x: p.x, y: p.y });
      return;
    }

    if (p.action === "move") {
      // PRIMARY mobile control (M2.5 review P1): turn the moment the drag
      // crosses the threshold, as the delivery does on touchmove. Waiting
      // for finger-up costs multiple ticks at level 3's 125 ms cadence.
      // The origin is dropped on success so one drag yields one turn.
      const origin = this.swipeOrigins.get(p.pointerId);
      if (origin && this.resolveSwipe(origin, p)) {
        this.swipeOrigins.delete(p.pointerId);
      }
      return;
    }

    if (p.action === "up" || p.action === "cancel") {
      const origin = this.swipeOrigins.get(p.pointerId);
      this.swipeOrigins.delete(p.pointerId);
      this.pressedDirs.delete(p.pointerId);
      // Fallback for a flick so quick it never reported a move past the
      // threshold. A CANCELLED gesture stays silent — the platform took
      // the finger away, so it was never a deliberate turn.
      if (origin && p.action === "up") this.resolveSwipe(origin, p);
    }
  }

  /** On-canvas d-pad: always visible, thumb-sized, drawn under the arena. */
  private drawDpad(g: CanvasRenderingContext2D): void {
    const held0 = new Set(this.pressedDirs.values());
    for (const [name, r] of Object.entries(dpadRects())) {
      const held = held0.has(name);
      g.save();
      g.shadowColor = held
        ? "rgba(255, 79, 216, 0.9)"
        : "rgba(79, 240, 255, 0.45)";
      g.shadowBlur = held ? 13 : 7;
      g.fillStyle = held ? "#a52bb7" : "#241040";
      g.beginPath();
      if (typeof g.roundRect === "function") {
        g.roundRect(r.x, r.y, r.w, r.h, 12);
      } else {
        g.rect(r.x, r.y, r.w, r.h);
      }
      g.fill();
      g.strokeStyle = held ? "#ffd6f5" : "#4ff0ff";
      g.lineWidth = 2;
      g.stroke();
      g.shadowBlur = 0;
      const cx = r.x + r.w / 2;
      const cy = r.y + r.h / 2;
      const s = 9;
      g.fillStyle = "#ffd6f5";
      g.beginPath();
      if (name === "up") {
        g.moveTo(cx, cy - s);
        g.lineTo(cx + s, cy + s * 0.6);
        g.lineTo(cx - s, cy + s * 0.6);
      } else if (name === "down") {
        g.moveTo(cx, cy + s);
        g.lineTo(cx + s, cy - s * 0.6);
        g.lineTo(cx - s, cy - s * 0.6);
      } else if (name === "left") {
        g.moveTo(cx - s, cy);
        g.lineTo(cx + s * 0.6, cy + s);
        g.lineTo(cx + s * 0.6, cy - s);
      } else {
        g.moveTo(cx + s, cy);
        g.lineTo(cx - s * 0.6, cy + s);
        g.lineTo(cx - s * 0.6, cy - s);
      }
      g.closePath();
      g.fill();
      g.restore();
    }
  }
}

export const snakeDefinition: GameDefinition = {
  apiVersion: 1,
  meta: snakeMeta,
  create(ctx: GameContext) {
    return new SnakeGame(ctx);
  },
};
