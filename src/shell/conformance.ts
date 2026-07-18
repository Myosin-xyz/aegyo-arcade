/**
 * Conformance instrumentation (TECH_SPEC §6.1.3): track timers, animation
 * frames, and event listeners created between begin() and end(), so tests
 * and spikes can assert that a destroyed game left nothing behind.
 *
 * Test/spike harness only — never imported by production routes.
 */

export interface LeakReport {
  timeouts: number;
  intervals: number;
  animationFrames: number;
  listeners: { target: string; type: string }[];
  clean: boolean;
}

interface TrackedListener {
  target: EventTarget;
  type: string;
  listener: EventListenerOrEventListenerObject;
}

export class LeakTracker {
  private originalSetTimeout = globalThis.setTimeout.bind(globalThis);
  private originalClearTimeout = globalThis.clearTimeout.bind(globalThis);
  private originalSetInterval = globalThis.setInterval.bind(globalThis);
  private originalClearInterval = globalThis.clearInterval.bind(globalThis);
  private originalRaf: typeof requestAnimationFrame | null = null;
  private originalCaf: typeof cancelAnimationFrame | null = null;
  private originalAdd = EventTarget.prototype.addEventListener;
  private originalRemove = EventTarget.prototype.removeEventListener;
  // Vitest's jsdom environment copies addEventListener onto the global as a
  // bound OWN property, bypassing the prototype patch — wrap those too.
  private windowOwnAdd: typeof addEventListener | null = null;
  private windowOwnRemove: typeof removeEventListener | null = null;

  private timeouts = new Set<number>();
  private intervals = new Set<number>();
  private frames = new Set<number>();
  private listeners: TrackedListener[] = [];
  private active = false;

  begin(): void {
    if (this.active) throw new Error("LeakTracker already active");
    this.active = true;
    this.timeouts.clear();
    this.intervals.clear();
    this.frames.clear();
    this.listeners = [];

    const tracker = this;

    globalThis.setTimeout = ((
      handler: TimerHandler,
      timeout?: number,
      ...args: unknown[]
    ) => {
      const id = tracker.originalSetTimeout(
        // Self-clearing: a fired timeout is not a leak.
        typeof handler === "function"
          ? (...inner: unknown[]) => {
              tracker.timeouts.delete(id as unknown as number);
              (handler as (...a: unknown[]) => void)(...inner);
            }
          : handler,
        timeout,
        ...args,
      ) as unknown as number;
      tracker.timeouts.add(id);
      return id;
    }) as typeof setTimeout;

    globalThis.clearTimeout = ((id?: number) => {
      if (id !== undefined) tracker.timeouts.delete(id);
      return tracker.originalClearTimeout(id);
    }) as typeof clearTimeout;

    globalThis.setInterval = ((
      handler: TimerHandler,
      timeout?: number,
      ...args: unknown[]
    ) => {
      const id = tracker.originalSetInterval(
        handler,
        timeout,
        ...args,
      ) as unknown as number;
      tracker.intervals.add(id);
      return id;
    }) as typeof setInterval;

    globalThis.clearInterval = ((id?: number) => {
      if (id !== undefined) tracker.intervals.delete(id);
      return tracker.originalClearInterval(id);
    }) as typeof clearInterval;

    if (typeof requestAnimationFrame === "function") {
      this.originalRaf = globalThis.requestAnimationFrame.bind(globalThis);
      this.originalCaf = globalThis.cancelAnimationFrame.bind(globalThis);
      globalThis.requestAnimationFrame = (cb: FrameRequestCallback) => {
        const id = tracker.originalRaf!((now) => {
          tracker.frames.delete(id);
          cb(now);
        });
        tracker.frames.add(id);
        return id;
      };
      globalThis.cancelAnimationFrame = (id: number) => {
        tracker.frames.delete(id);
        return tracker.originalCaf!(id);
      };
    }

    EventTarget.prototype.addEventListener = function (
      this: EventTarget,
      type: string,
      listener: EventListenerOrEventListenerObject | null,
      options?: boolean | AddEventListenerOptions,
    ) {
      if (listener) tracker.listeners.push({ target: this, type, listener });
      return tracker.originalAdd.call(this, type, listener, options);
    };

    EventTarget.prototype.removeEventListener = function (
      this: EventTarget,
      type: string,
      listener: EventListenerOrEventListenerObject | null,
      options?: boolean | EventListenerOptions,
    ) {
      const index = tracker.listeners.findIndex(
        (l) => l.target === this && l.type === type && l.listener === listener,
      );
      if (index >= 0) tracker.listeners.splice(index, 1);
      return tracker.originalRemove.call(this, type, listener, options);
    };

    const win = globalThis as unknown as Window & typeof globalThis;
    if (
      typeof win.addEventListener === "function" &&
      Object.prototype.hasOwnProperty.call(win, "addEventListener")
    ) {
      this.windowOwnAdd = win.addEventListener.bind(win);
      this.windowOwnRemove = win.removeEventListener.bind(win);
      win.addEventListener = ((
        type: string,
        listener: EventListenerOrEventListenerObject,
        options?: boolean | AddEventListenerOptions,
      ) => {
        if (listener) tracker.listeners.push({ target: win, type, listener });
        return tracker.windowOwnAdd!(type, listener, options);
      }) as typeof addEventListener;
      win.removeEventListener = ((
        type: string,
        listener: EventListenerOrEventListenerObject,
        options?: boolean | EventListenerOptions,
      ) => {
        const index = tracker.listeners.findIndex(
          (l) => l.target === win && l.type === type && l.listener === listener,
        );
        if (index >= 0) tracker.listeners.splice(index, 1);
        return tracker.windowOwnRemove!(type, listener, options);
      }) as typeof removeEventListener;
    }
  }

  end(): LeakReport {
    if (!this.active) throw new Error("LeakTracker not active");
    this.active = false;

    globalThis.setTimeout = this.originalSetTimeout as typeof setTimeout;
    globalThis.clearTimeout = this.originalClearTimeout as typeof clearTimeout;
    globalThis.setInterval = this.originalSetInterval as typeof setInterval;
    globalThis.clearInterval = this
      .originalClearInterval as typeof clearInterval;
    if (this.originalRaf) globalThis.requestAnimationFrame = this.originalRaf;
    if (this.originalCaf) globalThis.cancelAnimationFrame = this.originalCaf;
    EventTarget.prototype.addEventListener = this.originalAdd;
    EventTarget.prototype.removeEventListener = this.originalRemove;
    if (this.windowOwnAdd && this.windowOwnRemove) {
      const win = globalThis as unknown as Window & typeof globalThis;
      win.addEventListener = this.windowOwnAdd;
      win.removeEventListener = this.windowOwnRemove;
      this.windowOwnAdd = null;
      this.windowOwnRemove = null;
    }

    const report: LeakReport = {
      timeouts: this.timeouts.size,
      intervals: this.intervals.size,
      animationFrames: this.frames.size,
      listeners: this.listeners.map((l) => ({
        target: describeTarget(l.target),
        type: l.type,
      })),
      clean:
        this.timeouts.size === 0 &&
        this.intervals.size === 0 &&
        this.frames.size === 0 &&
        this.listeners.length === 0,
    };
    return report;
  }
}

function describeTarget(target: EventTarget): string {
  // Direct identity first: vitest's jsdom global is not `instanceof Window`.
  if (target === (globalThis as unknown as EventTarget)) return "window";
  if (typeof Window !== "undefined" && target instanceof Window)
    return "window";
  if (typeof Document !== "undefined" && target instanceof Document)
    return "document";
  if (typeof Element !== "undefined" && target instanceof Element)
    return `<${target.tagName.toLowerCase()}>`;
  return "unknown";
}
