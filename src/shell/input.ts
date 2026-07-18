/**
 * InputBus (TECH_SPEC §6.3): surface-scoped pointer input normalized into
 * design-box coordinates, keyboard as an enhancement, subscriptions that
 * return unsubscribe functions, and mandatory idempotent teardown. Games
 * never install their own global listeners.
 */

import type {
  InputBus,
  NormalizedKey,
  NormalizedPointer,
  PointerAction,
} from "./contract";

export interface InputBusOptions {
  /** Element pointer listeners attach to (the game surface). */
  target: HTMLElement;
  /** Client → design-box mapping; identity-ish for DOM surfaces. */
  toDesign: (clientX: number, clientY: number) => { x: number; y: number };
  /**
   * Capture the pointer on down (default true — canvas games keep
   * receiving move/up when the finger leaves the surface). MUST be false
   * for dom surfaces: capture retargets the subsequent `click` to the
   * root, so real-browser taps never reach buttons (e2e-caught bug).
   */
  capturePointer?: boolean;
}

export function createInputBus(options: InputBusOptions): InputBus {
  const pointerListeners = new Set<(p: NormalizedPointer) => void>();
  const keyListeners = new Set<(k: NormalizedKey) => void>();
  let enabled = true;
  let destroyed = false;

  const emitPointer = (action: PointerAction, e: PointerEvent): void => {
    if (!enabled || destroyed) return;
    const { x, y } = options.toDesign(e.clientX, e.clientY);
    const normalized: NormalizedPointer = {
      action,
      x,
      y,
      pointerId: e.pointerId,
    };
    for (const listener of pointerListeners) listener(normalized);
  };

  const onPointerDown = (e: PointerEvent): void => {
    // Keep receiving move/up even when the finger leaves the surface
    // (canvas surfaces only — see capturePointer doc).
    if (options.capturePointer !== false) {
      options.target.setPointerCapture?.(e.pointerId);
    }
    emitPointer("down", e);
  };
  const onPointerMove = (e: PointerEvent): void => emitPointer("move", e);
  const onPointerUp = (e: PointerEvent): void => emitPointer("up", e);
  const onPointerCancel = (e: PointerEvent): void => emitPointer("cancel", e);

  const emitKey = (action: NormalizedKey["action"], e: KeyboardEvent): void => {
    if (!enabled || destroyed || e.repeat) return;
    const normalized: NormalizedKey = { action, code: e.code };
    for (const listener of keyListeners) listener(normalized);
  };
  const onKeyDown = (e: KeyboardEvent): void => emitKey("down", e);
  const onKeyUp = (e: KeyboardEvent): void => emitKey("up", e);

  options.target.addEventListener("pointerdown", onPointerDown);
  options.target.addEventListener("pointermove", onPointerMove);
  options.target.addEventListener("pointerup", onPointerUp);
  options.target.addEventListener("pointercancel", onPointerCancel);
  // Keyboard listens on window (focus juggling on mobile isn't worth it),
  // but the bus itself is torn down with the game, so nothing leaks.
  window.addEventListener("keydown", onKeyDown);
  window.addEventListener("keyup", onKeyUp);

  return {
    onPointer(listener) {
      pointerListeners.add(listener);
      return () => pointerListeners.delete(listener);
    },
    onKey(listener) {
      keyListeners.add(listener);
      return () => keyListeners.delete(listener);
    },
    get enabled() {
      return enabled;
    },
    setEnabled(next) {
      enabled = next;
    },
    destroy() {
      if (destroyed) return;
      destroyed = true;
      enabled = false;
      options.target.removeEventListener("pointerdown", onPointerDown);
      options.target.removeEventListener("pointermove", onPointerMove);
      options.target.removeEventListener("pointerup", onPointerUp);
      options.target.removeEventListener("pointercancel", onPointerCancel);
      window.removeEventListener("keydown", onKeyDown);
      window.removeEventListener("keyup", onKeyUp);
      pointerListeners.clear();
      keyListeners.clear();
    },
  };
}
