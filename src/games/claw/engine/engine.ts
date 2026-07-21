import { fetchManifest, loadImages, type ImageBank } from "./assets";
import { Renderer } from "./render";
import { createInput } from "./input";
import { Confetti } from "./confetti";
import { sfx, haptic, unlockAudio, teardownAudio } from "./audio";
import {
  clamp01,
  lerp,
  easeInCubic,
  easeOutCubic,
  easeInOutCubic,
  easeOutBack,
} from "./easing";
import {
  fixedOutcome,
  type OutcomeProvider,
  ClawPlayRefusedError,
} from "./outcome";
import type { Manifest, Outcome, SpriteRect } from "./types";

export interface ClawMachineOptions {
  canvas: HTMLCanvasElement;
  stage: HTMLElement;
  /** path prefix where manifest.json + PNGs live, e.g. "claw/" */
  assetsBase: string;
  outcome: OutcomeProvider;
  /** Fires when a drop SEQUENCE finishes (win celebration started, or
   * miss/drop settled). Counted adapters must NOT end the run here — they
   * call beginCountedFinale() so the presentation completes with input
   * dead and the frame chain stops BEFORE report.end (M2 review P1). */
  onDropComplete?: (outcome: Outcome) => void;
  crt?: boolean;
}

type Phase = "loading" | "ready" | "dropping" | "won";
type SpriteState = "open" | "closed" | "plush";

interface Segment {
  name: string;
  dur: number;
  enter?: () => void;
  apply: (t: number) => void;
  /** Loop this segment while true (server-outcome dwell gate). */
  repeat?: () => boolean;
  /** Takes over when the segment completes (instead of advancing). */
  next?: () => void;
}

// --- tunables (design-space fractions, so they scale with export resolution) ---
/**
 * Aim → plush mapping (M4 UX P1 + depth axis, team feedback 2026-07-19):
 * the claw's travel divides into fixed columns AND two depth rows —
 * front (closer to the glass) and back. Aiming selects the plush from a
 * 2×5 grid; the server still decides grip (win / slip / miss).
 * Deterministic — the same (column, depth) always yields the same
 * plush, never a random one. The default depth (0.5) is the FRONT row,
 * which preserves the original single-axis mapping.
 */
const FRONT_ROW = ["D", "A", "E", "B", "K"] as const;
const BACK_ROW = ["K", "E", "A2", "D", "B"] as const;
const PILE_Y_FRAC = 0.72; // pile surface line at center depth
const PILE_DEPTH_SPAN = 0.1; // aim shadow travel across the pile (of dH)
const GANTRY_DEPTH_FRAC = 0.04; // gantry y-shift across full depth (of dH)
const DEPTH_SPEED = 0.0011; // depth units per ms while forward/back held
const DEPTH_FALL_TOP = 40; // slip tumble starts just under the claw tips
const OUTCOME_WAIT_MS = 6000; // dwell cap while the server resolves
const HOLE_CX_FRAC = 0.16; // horizontal center of the prize chute (bottom-left)
const HOLE_DROP_FRAC = 0.26; // how deep the claw dips to sink the plush into the box
const MOVE_SPEED_FRAC = 0.00085; // design-widths per ms while a direction is held
const MOVE_LO_FRAC = 0.26; // claw-center horizontal travel bounds
const MOVE_HI_FRAC = 0.74;
const WIN_HOLD_MS = 4200; // auto-return from the win screen
const FLASH_MS = 1300; // miss / "so close" toast duration
const CONFETTI_GRAVITY = 0.0013; // px per ms^2
const FRAME_CLAMP_MS = 50; // cap dt so a backgrounded tab doesn't fast-forward

const clamp = (v: number, lo: number, hi: number): number =>
  v < lo ? lo : v > hi ? hi : v;

export class ClawMachine {
  private manifest!: Manifest;
  private bank!: ImageBank;
  private renderer!: Renderer;
  private input!: ReturnType<typeof createInput>;
  private readonly confetti = new Confetti();

  private phase: Phase = "loading";
  private loadProgress = 0;
  private raf = 0;
  private last = 0;

  // claw transform (offset from the authored rest position, design px)
  private clawTX = 0;
  private clawTY = 0;
  /** Depth position: 0 = back of the cabinet, 1 = against the glass. */
  private clawTZ = 0.5;
  private heldDir: -1 | 0 | 1 = 0;
  private heldDepth: -1 | 0 | 1 = 0;
  private dropStartTX = 0;
  private spriteState: SpriteState = "open";
  private heldKey = "D";
  private pendingOutcome: Outcome | null = null;
  private dropError = false;
  /** The server REFUSED the play — terminal, never retryable. */
  private dropRefused = false;
  /** Pendulum offset of the claw below the trolley (presentation only). */
  private swing = 0;
  /** Falling-plush tween during a slip: -1 idle, else 0..1. */
  private fallT = -1;
  /** Falling-plush tween at the WIN release over the chute (DaiDai
   * realism note): the claw opens and the plush visibly drops in. */
  private winFallT = -1;
  private winFallPuffed = false;
  private dwellMs = 0;
  /** Monotonic drop generation: results from superseded drops (after a
   * timeout/reset) must never cross into a newer drop (M4 review P1). */
  private dropGen = 0;

  // drop timeline
  private segs: Segment[] = [];
  private segIndex = 0;
  private segElapsed = 0;
  private dropOutcome: Outcome = "miss";
  private awaiting = false;
  private forced: Outcome | null = null;

  // win screen
  private wonElapsed = 0;
  private boardT = 0;

  // fx
  private shakeMag = 0;
  private shakeMag0 = 0;
  private shakeTime = 0;
  private shakeDur = 1;
  private flashText = "";
  private flashT = 0;

  private readonly crt: boolean;
  private onResize: (() => void) | null = null;
  private resizeObserver: ResizeObserver | null = null;
  private onCanvasTap: (() => void) | null = null;
  // Counted terminal sequence (M2 review P1): once set, gameplay input is
  // dead, the result presentation runs to completion, then the frame
  // chain stops and the callback fires exactly once.
  private finale: ((outcome: Outcome) => void) | null = null;

  constructor(private readonly opts: ClawMachineOptions) {
    this.crt = opts.crt ?? false;
  }

  // M0 spike-slice lifecycle (TECH_SPEC §7.1.2): load/run split so init does
  // not start the loop, cancellable/resumable rAF, public reset, idempotent
  // destroy. M1 completes host/flag injection and outcome wiring.
  private loaded = false;
  private running = false;
  private pausedFlag = false;
  private destroyed = false;

  /** Load assets and build renderer/input. Does NOT start the loop. */
  async load(): Promise<void> {
    if (this.loaded || this.destroyed) return;
    this.manifest = await fetchManifest(this.opts.assetsBase);
    if (this.destroyed) return;
    this.renderer = new Renderer(
      this.opts.canvas,
      this.manifest.design,
      this.opts.stage,
    );
    this.onResize = () => this.renderer.resize();
    window.addEventListener("resize", this.onResize);
    // Container-only size changes never fire window.resize — observe the
    // stage directly (M4 review P2). Guarded: jsdom lacks ResizeObserver.
    if (typeof ResizeObserver !== "undefined") {
      this.resizeObserver = new ResizeObserver(() => this.renderer.resize());
      this.resizeObserver.observe(this.opts.stage);
    }

    this.bank = await loadImages(this.opts.assetsBase, this.manifest, (p) => {
      this.loadProgress = p;
    });
    if (this.destroyed) {
      // destroy() raced the asset load — release what start() would have owned.
      window.removeEventListener("resize", this.onResize);
      this.onResize = null;
      this.resizeObserver?.disconnect();
      this.resizeObserver = null;
      return;
    }

    this.input = createInput({
      canvas: this.opts.canvas,
      manifest: this.manifest,
      toDesign: (x, y) => this.renderer.toDesign(x, y),
      onDirDown: (d) => this.onDirDown(d),
      onDirUp: () => this.onDirUp(),
      onDepthDown: (d) => this.onDepthDown(d),
      onDepthUp: () => this.onDepthUp(),
      onDrop: () => this.onDrop(),
    });
    this.onCanvasTap = () => {
      // The tap-to-replay path bypasses the legacy input adapter, so it
      // needs its own finale gate — ended presentation must be inert.
      if (this.pausedFlag || this.destroyed || this.finale) return;
      if (this.phase === "won") this.replay();
    };
    this.opts.canvas.addEventListener("pointerdown", this.onCanvasTap);

    this.phase = "ready";
    this.loaded = true;
  }

  /** Start the rAF loop (idempotent while already running). */
  run(): void {
    if (!this.loaded || this.destroyed || this.running) return;
    // Close the stale-initial-viewport race (M4 review P2): the stage
    // may have been measured mid-layout; remeasure at start.
    this.renderer.resize();
    this.running = true;
    this.pausedFlag = false;
    this.last = performance.now();
    this.raf = requestAnimationFrame(this.frame);
  }

  pause(): void {
    if (!this.running || this.pausedFlag || this.destroyed) return;
    this.pausedFlag = true;
    cancelAnimationFrame(this.raf);
    this.raf = 0;
    // A held glide must not survive a background pause.
    this.heldDir = 0;
    this.heldDepth = 0;
    // The legacy adapter bypasses InputBus, so it is gated here: frozen
    // time means frozen state — no key/tap may reach the engine while
    // paused (M2 review P1).
    this.input?.setEnabled(false);
  }

  resume(): void {
    if (!this.running || !this.pausedFlag || this.destroyed) return;
    this.pausedFlag = false;
    // Never re-arm gameplay input while a finale presentation is active.
    if (!this.finale) this.input?.setEnabled(true);
    this.last = performance.now();
    this.raf = requestAnimationFrame(this.frame);
  }

  /** Return to the playable attract state without reloading assets. */
  resetToReady(): void {
    if (!this.loaded || this.destroyed) return;
    this.finale = null;
    this.input?.setEnabled(true);
    // Mid-drop bookkeeping must not survive a reset — a stale `awaiting`
    // would refuse every future drop (caught by the M4 aim vector).
    this.awaiting = false;
    this.pendingOutcome = null;
    this.dropError = false;
    this.dwellMs = 0;
    this.dropGen++; // invalidate any in-flight resolution
    this.toReady();
    this.clawTX = 0;
    this.clawTY = 0;
    this.clawTZ = 0.5;
    this.winFallT = -1;
    this.segs = [];
    this.segIndex = 0;
    this.segElapsed = 0;
    this.wonElapsed = 0;
    this.boardT = 0;
    this.flashT = 0;
    this.confetti.clear();
  }

  destroy(): void {
    if (this.destroyed) return;
    this.destroyed = true;
    this.running = false;
    cancelAnimationFrame(this.raf);
    this.raf = 0;
    if (this.onResize) window.removeEventListener("resize", this.onResize);
    this.resizeObserver?.disconnect();
    this.resizeObserver = null;
    if (this.onCanvasTap)
      this.opts.canvas.removeEventListener("pointerdown", this.onCanvasTap);
    this.input?.destroy();
    teardownAudio();
  }

  setForcedOutcome(o: Outcome | null): void {
    this.forced = o;
  }

  /**
   * Begin the counted terminal presentation (call from onDropComplete):
   * 1) gameplay input disabled NOW, 2) win-hold / miss-flash completes,
   * 3) the frame chain stops, 4) `done(outcome)` fires once. Restart via
   * resetToReady() + run() resumes exactly one chain.
   */
  beginCountedFinale(done: (outcome: Outcome) => void): void {
    if (this.destroyed || this.finale) return;
    this.finale = done;
    this.input?.setEnabled(false);
  }

  private completeFinale(): void {
    const done = this.finale;
    if (!done) return;
    this.finale = null;
    this.running = false;
    cancelAnimationFrame(this.raf);
    this.raf = 0;
    done(this.dropOutcome);
  }

  // ---- loop ----

  private readonly frame = (now: number): void => {
    if (this.destroyed || this.pausedFlag || !this.running) return;
    const dt = Math.min(FRAME_CLAMP_MS, now - this.last);
    this.last = now;
    this.update(dt);
    // completeFinale() may stop the chain from INSIDE update — never
    // render into or reschedule a stopped run.
    if (this.destroyed || !this.running) return;
    this.render(now);
    this.raf = requestAnimationFrame(this.frame);
  };

  private update(dt: number): void {
    if (this.shakeTime > 0) {
      this.shakeTime -= dt;
      this.shakeMag =
        this.shakeTime > 0
          ? this.shakeMag0 * (this.shakeTime / this.shakeDur)
          : 0;
    }
    if (this.flashT > 0) this.flashT -= dt;
    this.confetti.update(dt, CONFETTI_GRAVITY);

    if (this.phase === "ready") {
      if (this.heldDir !== 0) {
        const { lo, hi } = this.moveBounds();
        const speed = this.manifest.design.w * MOVE_SPEED_FRAC;
        this.clawTX = clamp(this.clawTX + this.heldDir * speed * dt, lo, hi);
      }
      if (this.heldDepth !== 0) {
        this.clawTZ = clamp(
          this.clawTZ + this.heldDepth * DEPTH_SPEED * dt,
          0,
          1,
        );
      }
      // ease any residual vertical offset (e.g. after a win) back to rest
      this.clawTY += (0 - this.clawTY) * Math.min(1, dt / 110);
    } else if (this.phase === "dropping") {
      const seg = this.segs[this.segIndex];
      if (!seg) {
        this.finishDrop();
        return;
      }
      if (this.segElapsed === 0 && seg.enter) seg.enter();
      this.segElapsed += dt;
      seg.apply(clamp01(this.segElapsed / seg.dur));
      if (this.segElapsed >= seg.dur) {
        if (seg.repeat?.()) {
          // Dwell gate: hold at depth while the server outcome is in
          // flight (M4 UX P1: descent starts immediately; the outcome is
          // only needed at the grab moment).
          this.segElapsed = 0;
          this.dwellMs += seg.dur;
          if (this.dwellMs > OUTCOME_WAIT_MS) this.abortDrop();
          return;
        }
        if (seg.next) {
          seg.next();
          return;
        }
        this.segIndex += 1;
        this.segElapsed = 0;
        if (this.segIndex >= this.segs.length) this.finishDrop();
      }
    } else if (this.phase === "won") {
      this.wonElapsed += dt;
      this.boardT = clamp01(this.wonElapsed / 420);
      if (this.wonElapsed > WIN_HOLD_MS) {
        // Counted finale: the win hold IS the presentation — complete it,
        // then stop; never auto-replay a counted run.
        if (this.finale) this.completeFinale();
        else this.replay();
      }
    }
    // Counted finale, miss/drop path: presentation = the result flash.
    if (this.finale && this.phase === "ready" && this.flashT <= 0) {
      this.completeFinale();
    }
  }

  // ---- input ----

  private moveBounds(): { lo: number; hi: number } {
    const dW = this.manifest.design.w;
    const restCenter = this.manifest.clawOpen.x + this.manifest.clawOpen.w / 2;
    return {
      lo: dW * MOVE_LO_FRAC - restCenter,
      hi: dW * MOVE_HI_FRAC - restCenter,
    };
  }

  private onDirDown(dir: -1 | 1): void {
    if (this.pausedFlag || this.destroyed || this.finale || !this.running) {
      return;
    }
    unlockAudio();
    if (this.phase !== "ready") return;
    this.heldDir = dir;
    sfx.move();
    haptic(6);
  }

  private onDirUp(): void {
    this.heldDir = 0;
  }

  private onDepthDown(dir: -1 | 1): void {
    if (this.pausedFlag || this.destroyed || this.finale || !this.running) {
      return;
    }
    unlockAudio();
    if (this.phase !== "ready") return;
    this.heldDepth = dir;
    sfx.move();
    haptic(6);
  }

  private onDepthUp(): void {
    this.heldDepth = 0;
  }

  private onDrop(): void {
    // Terminal guard (M2 review P1): a finale presentation and an ended
    // (stopped-chain) machine must never accept another drop/replay, no
    // matter which path reached this verb.
    if (this.pausedFlag || this.destroyed || this.finale || !this.running) {
      return;
    }
    unlockAudio();
    if (this.phase === "won") {
      this.replay();
      return;
    }
    if (this.phase !== "ready" || this.awaiting) return;
    this.heldDir = 0;
    this.awaiting = true;
    this.pendingOutcome = null;
    this.dropError = false;
    this.dropRefused = false;
    this.dwellMs = 0;
    const gen = ++this.dropGen;
    sfx.press();
    haptic(12);
    const provider = this.forced
      ? fixedOutcome(this.forced)
      : this.opts.outcome;
    // Descent begins NOW; the outcome resolves in parallel and is only
    // consumed at the grab moment (no counted-mode network hesitation).
    provider()
      .then((o) => {
        // Guard BOTH teardown (M1 review B6) and superseded drops
        // (M4 review P1): a result from an older generation must never
        // populate a newer drop's outcome. The adapter has already
        // cached committed results for durable replay.
        if (this.destroyed || gen !== this.dropGen) return;
        this.pendingOutcome = o;
      })
      .catch((error: unknown) => {
        if (this.destroyed || gen !== this.dropGen) return;
        if (error instanceof ClawPlayRefusedError) this.dropRefused = true;
        this.dropError = true;
      });
    this.startDescent();
  }

  // ---- drop sequence ----

  /** Aim → (column, depth row) → plush. FIVE EQUAL bins per row (M4
   * review P2: rounding four intervals gave the edge plushes half-width
   * lanes) × TWO depth rows. clawTZ ≥ 0.5 (the default) is the FRONT
   * row, preserving the original single-axis mapping. */
  private targetKey(): string {
    const { lo, hi } = this.moveBounds();
    const span = hi - lo || 1;
    const row = this.clawTZ >= 0.5 ? FRONT_ROW : BACK_ROW;
    const index = Math.floor(((this.clawTX - lo) / span) * row.length);
    const key = row[clamp(index, 0, row.length - 1)];
    return this.manifest.clawPlush[key] ? key : "D";
  }

  /** Pile surface line at the CURRENT depth (front = lower on screen). */
  private pileY(): number {
    const { h: dH } = this.manifest.design;
    return dH * (PILE_Y_FRAC + (this.clawTZ - 0.5) * PILE_DEPTH_SPAN);
  }

  /** Pseudo-perspective gantry shift: closer to the glass rides lower. */
  private gantryY(): number {
    return (this.clawTZ - 0.5) * this.manifest.design.h * GANTRY_DEPTH_FRAC;
  }

  private clawDesignX(): number {
    return (
      this.manifest.clawOpen.x + this.manifest.clawOpen.w / 2 + this.clawTX
    );
  }

  /** How far the claw sinks to reach the pile at the CURRENT depth
   * (front rows sit lower on screen; the gantry shift covers part). */
  private descentDepth(): number {
    const { h: dH } = this.manifest.design;
    return (
      dH * 0.225 +
      (this.clawTZ - 0.5) * dH * (PILE_DEPTH_SPAN - GANTRY_DEPTH_FRAC)
    );
  }

  /** Immediate descent + dwell gate; the aimed plush is locked here. */
  private startDescent(): void {
    const DEPTH = this.descentDepth();

    this.heldKey = this.targetKey(); // aim decides the plush, not RNG
    this.dropStartTX = this.clawTX;
    this.heldDir = 0;
    this.heldDepth = 0; // aim committed — depth locks with the columns
    this.swing = 0;
    this.fallT = -1;
    this.winFallT = -1;
    this.winFallPuffed = false;
    this.spriteState = "open";

    this.segs = [
      {
        name: "descend",
        dur: 720,
        enter: () => {
          this.spriteState = "open";
          sfx.descend();
          haptic(10);
        },
        apply: (t) => {
          this.clawTY = DEPTH * easeInCubic(t);
        },
      },
      {
        // Grip dwell: micro-jitter at depth until the server outcome
        // lands (usually already resolved — one loop at most).
        name: "await",
        dur: 120,
        apply: (t) => {
          this.clawTY = DEPTH * (1 - 0.015 * Math.sin(t * Math.PI * 2));
        },
        repeat: () => this.pendingOutcome === null && !this.dropError,
        next: () => {
          if (this.dropError || this.pendingOutcome === null) {
            this.abortDrop();
          } else {
            this.beginOutcome(this.pendingOutcome);
          }
        },
      },
    ];
    this.segIndex = 0;
    this.segElapsed = 0;
    this.phase = "dropping";
  }

  /** Server said win / slip(drop) / miss — play it on the AIMED plush. */
  private beginOutcome(outcome: Outcome): void {
    const M = this.manifest;
    const { w: dW, h: dH } = M.design;
    const DEPTH = this.descentDepth();
    const restCenter = M.clawOpen.x + M.clawOpen.w / 2;
    const holeTX = dW * HOLE_CX_FRAC - restCenter;

    this.awaiting = false;
    this.dropOutcome = outcome;

    const segs: Segment[] = [
      {
        name: "grab",
        dur: 300,
        enter: () => {
          this.spriteState = outcome === "miss" ? "closed" : "plush";
          sfx.grab();
          haptic(30);
          this.shake(5, 170);
          // Contact feedback at the aimed column: pile "gives" a little.
          this.confetti.puff(this.clawDesignX(), this.pileY(), 10);
        },
        apply: (t) => {
          this.clawTY = DEPTH * (1 - 0.05 * Math.sin(t * Math.PI));
        },
      },
    ];

    if (outcome === "win") {
      segs.push(
        {
          name: "rise",
          dur: 720,
          enter: () => sfx.rise(),
          apply: (t) => {
            this.clawTY = DEPTH * (1 - easeOutCubic(t));
            // Cable tension: a slight pendulum builds as the load lifts.
            this.swing = Math.sin(t * Math.PI * 2) * dW * 0.006 * t;
          },
        },
        {
          name: "toHole",
          dur: 840,
          apply: (t) => {
            this.clawTX = lerp(this.dropStartTX, holeTX, easeInOutCubic(t));
            this.clawTY = -dH * 0.012 * Math.sin(t * Math.PI);
            // Carry swing, damping as the trolley decelerates.
            this.swing =
              Math.sin(t * Math.PI * 3) * dW * 0.013 * (1 - 0.55 * t);
          },
        },
        {
          name: "lower",
          dur: 360,
          apply: (t) => {
            this.clawTX = holeTX;
            this.clawTY = dH * HOLE_DROP_FRAC * easeInCubic(t);
            this.swing *= 1 - t; // settle over the chute
          },
        },
        {
          name: "release",
          dur: 520,
          enter: () => {
            // The claw OPENS over the chute and the plush visibly falls
            // in (DaiDai realism note) — no teleporting prizes.
            this.spriteState = "open";
            sfx.drop();
            haptic(40);
          },
          apply: (t) => {
            this.clawTX = holeTX;
            this.clawTY = dH * HOLE_DROP_FRAC * (1 - 0.25 * t);
            this.winFallT = t;
            if (t >= 0.72 && !this.winFallPuffed) {
              this.winFallPuffed = true;
              // sparkle at the LANDING moment, not the release moment
              this.confetti.burst(dW * HOLE_CX_FRAC, dH * 0.82, 26, 1.0);
            }
          },
        },
        {
          name: "settleOpen",
          dur: 220,
          enter: () => {
            this.winFallT = -1;
          },
          apply: (t) => {
            this.clawTX = holeTX;
            this.clawTY = dH * HOLE_DROP_FRAC * 0.75 * (1 - easeOutCubic(t));
          },
        },
      );
    } else if (outcome === "drop") {
      segs.push(
        {
          name: "lift",
          dur: 520,
          enter: () => sfx.rise(),
          apply: (t) => {
            this.clawTY = DEPTH * (1 - 0.45 * easeOutCubic(t));
          },
        },
        {
          name: "slip",
          dur: 280,
          enter: () => {
            this.spriteState = "open";
            sfx.drop();
            haptic([20, 40, 20]);
            this.shake(13, 300);
          },
          apply: (t) => {
            this.clawTY = DEPTH * (0.55 + 0.08 * Math.sin(t * Math.PI));
            this.fallT = t; // the aimed plush tumbles back to the pile
          },
        },
        {
          name: "recover",
          dur: 560,
          enter: () => {
            sfx.rise();
            this.fallT = -1;
            // dust fires at the LANDING moment, synced with the tumble.
            this.confetti.puff(this.clawDesignX(), this.pileY(), 16);
          },
          apply: (t) => {
            this.clawTY = DEPTH * 0.55 * (1 - easeOutCubic(t));
          },
        },
      );
    } else {
      segs.push(
        {
          name: "rise",
          dur: 760,
          enter: () => sfx.rise(),
          apply: (t) => {
            this.clawTY = DEPTH * (1 - easeOutCubic(t));
          },
        },
        {
          name: "settle",
          dur: 240,
          enter: () => {
            sfx.miss();
            haptic(25);
          },
          apply: () => {
            this.clawTY = 0;
          },
        },
      );
    }

    this.segs = segs;
    this.segIndex = 0;
    this.segElapsed = 0;
  }

  /**
   * The drop cannot proceed. Two shapes (M4 review P2/P3):
   * - INDEFINITE (network death / dwell timeout): consumption is
   *   UNKNOWN — the operation stays durable (same idempotency key, or
   *   the adapter's cached late outcome), and the next Drop press
   *   re-attempts it. "TRY AGAIN" is literal.
   * - REFUSED (server answered 4xx): terminal — the adapter has already
   *   ended the run honestly; the flash just explains the retract.
   */
  private abortDrop(): void {
    this.awaiting = false;
    this.pendingOutcome = null;
    this.dropError = false;
    this.dropGen++; // a late resolution may not cross into the next drop
    this.spriteState = "open";
    this.flash(this.dropRefused ? "UNAVAILABLE" : "TRY AGAIN");
    this.dropRefused = false;
    this.toReady();
  }

  private finishDrop(): void {
    if (this.dropOutcome === "win") {
      const { w: dW, h: dH } = this.manifest.design;
      this.phase = "won";
      this.wonElapsed = 0;
      this.boardT = 0;
      sfx.win();
      haptic([0, 60, 40, 60, 40, 140]);
      this.confetti.burst(dW * 0.5, dH * 0.42, 120, 1.7);
      this.shake(7, 320);
    } else {
      this.flash(this.dropOutcome === "drop" ? "SO CLOSE!" : "TRY AGAIN");
      this.toReady();
    }
    this.opts.onDropComplete?.(this.dropOutcome);
  }

  private toReady(): void {
    this.phase = "ready";
    this.heldDir = 0;
    this.heldDepth = 0;
    this.spriteState = "open";
    this.awaiting = false;
  }

  private replay(): void {
    if (this.phase !== "won") return;
    this.toReady();
  }

  private flash(text: string): void {
    this.flashText = text;
    this.flashT = FLASH_MS;
  }

  private shake(mag: number, dur: number): void {
    this.shakeMag0 = mag;
    this.shakeMag = mag;
    this.shakeTime = dur;
    this.shakeDur = dur;
  }

  // ---- render ----

  private clawRect(): SpriteRect {
    const M = this.manifest;
    if (this.spriteState === "plush")
      return M.clawPlush[this.heldKey] ?? M.clawClosed;
    if (this.spriteState === "closed") return M.clawClosed;
    return M.clawOpen;
  }

  private render(now: number): void {
    const r = this.renderer;
    const ctx = r.ctx;
    const s = r.vp.scale;
    if (this.phase === "loading") {
      this.drawLoading(ctx);
      return;
    }
    const M = this.manifest;
    const { w: dW, h: dH } = M.design;
    const sx = this.shakeMag > 0 ? (Math.random() - 0.5) * this.shakeMag : 0;
    const sy = this.shakeMag > 0 ? (Math.random() - 0.5) * this.shakeMag : 0;
    ctx.setTransform(s, 0, 0, s, sx * s, sy * s);
    ctx.imageSmoothingEnabled = false;
    ctx.fillStyle = "#0d0717";
    ctx.fillRect(-80, -80, dW + 160, dH + 160);

    // gentle idle sway only when parked (not while gliding under a held direction)
    const idle =
      this.phase === "ready" && this.heldDir === 0 && this.heldDepth === 0;
    const sway = idle ? Math.sin(now * 0.0016) * dW * 0.0035 : 0;
    r.blit(this.bank.get(M.back), M.back);
    const claw = this.clawRect();
    // Depth reads as cable length: the trolley stays on its rail; the
    // claw hangs lower when "closer" to the glass (pseudo-perspective).
    const gY = this.gantryY();
    // Cable: the claw sprite slides down leaving a gap above its top —
    // bridge it with a line from the ceiling anchor, slanting when the
    // load swings (presentation physics, M4 style pass).
    if (this.clawTY + gY > 2) {
      const anchorX = this.clawDesignX() + sway;
      const topY = M.clawOpen.y + 3;
      const clawTopY = M.clawOpen.y + this.clawTY + gY + 4;
      ctx.strokeStyle = "#161022";
      ctx.lineWidth = dW * 0.006;
      ctx.beginPath();
      ctx.moveTo(anchorX, topY);
      ctx.lineTo(anchorX + this.swing, clawTopY);
      ctx.stroke();
      ctx.strokeStyle = "#3a2c55";
      ctx.lineWidth = dW * 0.002;
      ctx.beginPath();
      ctx.moveTo(anchorX, topY);
      ctx.lineTo(anchorX + this.swing, clawTopY);
      ctx.stroke();
    }
    r.blit(
      this.bank.get(claw),
      claw,
      this.clawTX + sway + this.swing,
      this.clawTY + gY,
    );
    r.blit(this.bank.get(M.trolley), M.trolley, this.clawTX + sway, 0);
    // Slip tumble: the AIMED plush (bottom crop of its carried sprite)
    // falls from the claw tips back onto the pile, tipping as it goes.
    if (this.fallT >= 0) {
      const plushRect = M.clawPlush[this.heldKey];
      const img = plushRect ? this.bank.get(plushRect) : null;
      if (img && img.naturalWidth > 0) {
        const t = this.fallT;
        const size = dW * 0.15;
        const iw = img.naturalWidth;
        const ih = img.naturalHeight;
        const cropH = Math.min(iw, ih);
        const fx = this.clawDesignX();
        // Start at the claw's CURRENT tips (it slipped at ~55% lift).
        const tipY =
          M.clawOpen.y +
          this.clawTY +
          this.gantryY() +
          M.clawOpen.h -
          DEPTH_FALL_TOP;
        const pileY = this.pileY() - size * 0.4;
        const fy = tipY + (pileY - tipY) * (t * t); // gravity-ish
        const squash = t > 0.85 ? 1 - (t - 0.85) * 1.6 : 1;
        ctx.save();
        ctx.translate(fx, fy + size / 2);
        ctx.rotate((t - 0.15) * 0.5);
        ctx.scale(1 / squash, squash);
        ctx.drawImage(
          img,
          0,
          ih - cropH,
          iw,
          cropH,
          -size / 2,
          -size / 2,
          size,
          size,
        );
        ctx.restore();
      }
    }
    // Win release: the plush visibly FALLS from the open claw into the
    // prize chute (DaiDai realism note) — drawn behind the front pile so
    // it disappears "into" the box mouth.
    if (this.winFallT >= 0) {
      const plushRect = M.clawPlush[this.heldKey];
      const img = plushRect ? this.bank.get(plushRect) : null;
      if (img && img.naturalWidth > 0) {
        const t = this.winFallT;
        const size = dW * 0.14;
        const iw = img.naturalWidth;
        const ih = img.naturalHeight;
        const cropH = Math.min(iw, ih);
        const fx = this.clawDesignX();
        const tipY =
          M.clawOpen.y +
          this.clawTY +
          this.gantryY() +
          M.clawOpen.h -
          DEPTH_FALL_TOP;
        const chuteY = dH * 0.84 - size * 0.4;
        const fy = tipY + (chuteY - tipY) * (t * t); // gravity-ish
        const squash = t > 0.82 ? 1 - (t - 0.82) * 1.4 : 1;
        ctx.save();
        ctx.globalAlpha = t > 0.9 ? 1 - (t - 0.9) * 8 : 1; // sinks in
        ctx.translate(fx, fy + size / 2);
        ctx.rotate((t - 0.1) * 0.35);
        ctx.scale(1 / squash, squash);
        ctx.drawImage(
          img,
          0,
          ih - cropH,
          iw,
          cropH,
          -size / 2,
          -size / 2,
          size,
          size,
        );
        ctx.restore();
      }
    }
    r.blit(this.bank.get(M.frontPlush), M.frontPlush);

    // Aim indicator (M4 UX P1, revised per DaiDai): a soft contact
    // shadow on the pile at the (column, depth) the claw would grab —
    // the pink target ring is retired; the shadow tracks BOTH axes so
    // aim stays legible without reading as a bullseye overlay.
    if (this.phase === "ready" || this.phase === "dropping") {
      const tx = this.clawDesignX() + sway;
      const py = this.pileY();
      const dropping = this.phase === "dropping";
      // Perspective: the shadow grows slightly as the claw comes closer.
      const depthScale = 1 + (this.clawTZ - 0.5) * 0.35;
      ctx.save();
      ctx.globalAlpha = dropping ? 0.6 : 0.5;
      ctx.fillStyle = "#0a0414";
      ctx.beginPath();
      ctx.ellipse(
        tx,
        py,
        dW * 0.07 * depthScale,
        dW * 0.023 * depthScale,
        0,
        0,
        Math.PI * 2,
      );
      ctx.fill();
      ctx.restore();
    }

    r.blit(this.bank.get(M.frame), M.frame);

    // Unlit bases for the depth buttons: the cabinet art bakes only the
    // left/right bases (the depth axis was retired in the first port),
    // so the lit sprites double as dimmed resting bases — otherwise the
    // restored forward/backward controls would be invisible until held.
    r.blit(this.bank.get(M.controls.forward), M.controls.forward, 0, 0, 0.45);
    r.blit(this.bank.get(M.controls.backward), M.controls.backward, 0, 0, 0.45);

    // attract: pulse the drop button to invite the first tap
    if (this.phase === "ready" && !this.awaiting) {
      const a = 0.3 + 0.35 * (0.5 + 0.5 * Math.sin(now * 0.005));
      r.blit(this.bank.get(M.controls.drop), M.controls.drop, 0, 0, a);
    }
    // lit overlays for held / recently pressed controls
    for (const k of this.input.state.pressed) {
      r.blit(this.bank.get(M.controls[k]), M.controls[k]);
    }

    this.confetti.draw(ctx);
    if (this.phase === "won") this.drawWinBoard(ctx, dW, dH, now);
    if (this.flashT > 0) this.drawFlash(ctx, dW, dH);
    if (this.crt) this.drawCRT(ctx, dW, dH);
  }

  private drawLoading(ctx: CanvasRenderingContext2D): void {
    const { w: dW, h: dH } = this.manifest.design;
    const s = this.renderer.vp.scale;
    ctx.setTransform(s, 0, 0, s, 0, 0);
    ctx.fillStyle = "#0d0717";
    ctx.fillRect(0, 0, dW, dH);
    ctx.textAlign = "center";
    ctx.textBaseline = "middle";
    ctx.fillStyle = "#ff5db0";
    ctx.font = `700 ${Math.round(dW * 0.05)}px ui-monospace, monospace`;
    ctx.fillText("AEGYO ARENA", dW / 2, dH * 0.44);
    const bw = dW * 0.5;
    const bh = dH * 0.012;
    const bx = (dW - bw) / 2;
    const by = dH * 0.5;
    ctx.fillStyle = "#2a2140";
    ctx.fillRect(bx, by, bw, bh);
    ctx.fillStyle = "#ff5db0";
    ctx.fillRect(bx, by, bw * this.loadProgress, bh);
  }

  private drawWinBoard(
    ctx: CanvasRenderingContext2D,
    dW: number,
    dH: number,
    now: number,
  ): void {
    const wb = this.manifest.winBoard;
    const t = easeOutBack(clamp01(this.boardT));
    ctx.save();
    ctx.translate(dW * 0.5, dH * 0.4);
    ctx.scale(t, t);
    ctx.drawImage(this.bank.get(wb), -wb.w / 2, -wb.h / 2, wb.w, wb.h);
    ctx.restore();
    if (this.wonElapsed > 800) {
      ctx.globalAlpha = 0.55 + 0.45 * Math.sin(now * 0.006);
      ctx.fillStyle = "#fff";
      ctx.textAlign = "center";
      ctx.textBaseline = "middle";
      ctx.font = `700 ${Math.round(dW * 0.034)}px ui-monospace, monospace`;
      ctx.fillText("TAP TO PLAY AGAIN", dW * 0.5, dH * 0.56);
      ctx.globalAlpha = 1;
    }
  }

  private drawFlash(
    ctx: CanvasRenderingContext2D,
    dW: number,
    dH: number,
  ): void {
    ctx.save();
    ctx.globalAlpha = clamp01(this.flashT / 300);
    ctx.textAlign = "center";
    ctx.textBaseline = "middle";
    ctx.lineJoin = "round";
    ctx.font = `800 ${Math.round(dW * 0.06)}px ui-monospace, monospace`;
    ctx.lineWidth = dW * 0.006;
    ctx.strokeStyle = "#1a0f2e";
    ctx.fillStyle = "#fff";
    ctx.strokeText(this.flashText, dW * 0.5, dH * 0.4);
    ctx.fillText(this.flashText, dW * 0.5, dH * 0.4);
    ctx.restore();
  }

  private drawCRT(ctx: CanvasRenderingContext2D, dW: number, dH: number): void {
    ctx.save();
    ctx.globalAlpha = 0.05;
    ctx.fillStyle = "#000";
    for (let y = 0; y < dH; y += 4) ctx.fillRect(0, y, dW, 2);
    ctx.globalAlpha = 1;
    const g = ctx.createRadialGradient(
      dW / 2,
      dH / 2,
      dH * 0.22,
      dW / 2,
      dH / 2,
      dH * 0.62,
    );
    g.addColorStop(0, "rgba(0,0,0,0)");
    g.addColorStop(1, "rgba(0,0,0,0.33)");
    ctx.fillStyle = g;
    ctx.fillRect(0, 0, dW, dH);
    ctx.restore();
  }
}
