/**
 * Fixed-timestep loop (TECH_SPEC §6.3): update at a fixed simulation rate,
 * render every animation frame with an interpolation alpha. Frame delta is
 * clamped so a backgrounded/janked tab cannot fast-forward the simulation.
 */

export interface LoopCallbacks {
  update(dtMs: number): void;
  render(alpha: number): void;
}

const STEP_MS = 1000 / 60;
const FRAME_CLAMP_MS = 50;

export class FixedLoop {
  private raf = 0;
  private last = 0;
  private accumulator = 0;
  private running = false;

  constructor(private readonly callbacks: LoopCallbacks) {}

  get isRunning(): boolean {
    return this.running;
  }

  start(): void {
    if (this.running) return;
    this.running = true;
    this.last = performance.now();
    this.accumulator = 0;
    this.raf = requestAnimationFrame(this.frame);
  }

  stop(): void {
    if (!this.running) return;
    this.running = false;
    cancelAnimationFrame(this.raf);
    this.raf = 0;
  }

  private readonly frame = (now: number): void => {
    if (!this.running) return;
    // Clamp both ways: a backgrounded tab can't fast-forward, and a clock
    // mismatch (rAF timestamp vs performance.now) can't run time backwards.
    const delta = Math.min(Math.max(now - this.last, 0), FRAME_CLAMP_MS);
    this.last = now;
    this.accumulator += delta;
    while (this.accumulator >= STEP_MS) {
      this.callbacks.update(STEP_MS);
      this.accumulator -= STEP_MS;
      // update() may call report.end() → stop(); this frame must not render
      // or reschedule after that (M0 review P1: no rAF survives stop()).
      if (!this.running) return;
    }
    this.callbacks.render(this.accumulator / STEP_MS);
    if (!this.running) return;
    this.raf = requestAnimationFrame(this.frame);
  };
}
