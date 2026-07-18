/**
 * Game Runtime Contract v1 — TECH_SPEC §6.2, FROZEN 2026-07-18 (ADR 0005).
 *
 * Freeze evidence: real-claw adapter spike + refactors, hostile fixture,
 * leak conformance across all three surface/loop shapes, and both
 * production compatibility checks (Flappy shell-loop canvas, Hangman dom).
 * Changes require an ADR; breaking changes require a new `apiVersion`.
 */

export type RunMode = "practice" | "counted" | "prize";

export interface GameMeta {
  id: string;
  titleKey: string;
  taglineKey: string;
  /** Which surface the host must construct BEFORE loading the game chunk. */
  surface: "canvas" | "dom";
  designBox: { w: number; h: number };
  capabilities: {
    counted: boolean;
    prize: boolean;
  };
}

export type GameSurface =
  | {
      kind: "canvas";
      canvas: HTMLCanvasElement;
      context2d: CanvasRenderingContext2D;
      designBox: { w: number; h: number };
    }
  | {
      kind: "dom";
      root: HTMLElement;
    };

interface RunContextBase {
  seed: string;
  /** Seeded PRNG. Games never use Math.random() for ranked mechanics. */
  random: () => number;
  /** Aborts when the run is being torn down mid-flight. */
  signal: AbortSignal;
}

/**
 * Discriminated on `mode` (M1 review P1): non-practice runs REQUIRE a
 * server attempt id — a counted/prize run without one is unrepresentable,
 * and games must additionally reject it at runtime rather than fall back
 * to practice behavior.
 */
export type RunContext =
  | (RunContextBase & { mode: "practice"; attemptId: null })
  | (RunContextBase & { mode: "counted" | "prize"; attemptId: string });

export interface GameEndResult {
  reason?: "completed" | "lost" | "quit";
}

export interface GameContext {
  host: HTMLElement;
  surface: GameSurface;
  input: InputBus;
  audio: AudioBus;
  t: (key: string, vars?: Record<string, string | number>) => string;
  report: {
    /** Live integer score; shell validates shape and keeps the last value. */
    score: (score: number) => void;
    /** Accepted once per run; duplicates are ignored (logged in dev). */
    end: (result?: GameEndResult) => void;
  };
}

interface BaseGameInstance {
  /** Runs once. Load assets, build state. Abort must cancel cleanly. */
  init(signal: AbortSignal): Promise<void> | void;
  /** Fresh run state; valid from `ready` or `ended` only. */
  start(run: RunContext): void;
  pause(reason: "hidden" | "blur" | "system"): void;
  resume(): void;
  /** Idempotent; terminal from every state, including failed/aborted init. */
  destroy(): void;
}

/** Default for new games: the shell owns the loop. */
export interface ShellLoopGame extends BaseGameInstance {
  loop: "shell";
  update(dtMs: number): void;
  render(alpha: number): void;
}

/** Documented migration escape hatch (the claw), not the default strategy. */
export interface ModuleLoopGame extends BaseGameInstance {
  loop: "module";
}

export type GameInstance = ShellLoopGame | ModuleLoopGame;

export interface GameDefinition {
  apiVersion: 1;
  meta: GameMeta;
  /** Factory — a fresh instance per mount; no singleton run state. */
  create(ctx: GameContext): GameInstance;
}

/* ------------------------------------------------------------------ */
/* Shell service buses — M0 contract deliverables (TECH_SPEC §6, ~319) */
/* ------------------------------------------------------------------ */

export type PointerAction = "down" | "move" | "up" | "cancel";

/** Pointer event normalized into design-box coordinates. */
export interface NormalizedPointer {
  action: PointerAction;
  /** Design-box x/y (canvas surfaces) or host-relative CSS px (dom surfaces). */
  x: number;
  y: number;
  pointerId: number;
}

export type KeyAction = "down" | "up";

export interface NormalizedKey {
  action: KeyAction;
  /** KeyboardEvent.code, e.g. "ArrowLeft", "Space". */
  code: string;
}

export interface InputBus {
  /** Subscribe; returns an unsubscribe function. */
  onPointer(listener: (p: NormalizedPointer) => void): () => void;
  /** Keyboard is an enhancement; never required for gameplay. */
  onKey(listener: (k: NormalizedKey) => void): () => void;
  readonly enabled: boolean;
  setEnabled(enabled: boolean): void;
  /** Idempotent. Removes every DOM listener and drops subscribers. */
  destroy(): void;
}

export interface AudioBus {
  /** Register a named synth SFX (WebAudio; no audio files). */
  register(name: string, synth: (ctx: AudioContext, at: number) => void): void;
  /** No-op until gesture-unlocked, while muted, or after destroy. */
  play(name: string): void;
  readonly unlocked: boolean;
  readonly muted: boolean;
  setMuted(muted: boolean): void;
  /**
   * Observe mute changes; returns an unsubscribe function. Module-loop
   * games with legacy audio use this to stay in sync mid-run.
   */
  onMutedChange(listener: (muted: boolean) => void): () => void;
  /** Idempotent. Closes the AudioContext. */
  destroy(): void;
}

/** Host-observable lifecycle — TECH_SPEC §6.3 state machine. */
export type LifecycleState =
  | "created"
  | "initializing"
  | "ready"
  | "running"
  | "paused"
  | "ended"
  | "failed"
  | "destroyed";

/**
 * §6.3: `start()` is valid only from `ready` or `ended`; a call while
 * running/paused is rejected without creating another loop or subscription.
 * Pure so hosts and conformance tests share one rule.
 */
export function canStart(state: LifecycleState): boolean {
  return state === "ready" || state === "ended";
}
