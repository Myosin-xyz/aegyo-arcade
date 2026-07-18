import type { ControlKey, Manifest } from "./types";

export interface InputState {
  /** controls currently showing their lit overlay */
  pressed: Set<ControlKey>;
}

interface InputOptions {
  canvas: HTMLCanvasElement;
  manifest: Manifest;
  toDesign: (clientX: number, clientY: number) => { x: number; y: number };
  /** a direction is being held down (claw should glide while held) */
  onDirDown: (dir: -1 | 1) => void;
  /** the held direction was released */
  onDirUp: () => void;
  /** the drop button was tapped */
  onDrop: () => void;
}

// Hit zones are expanded well past the drawn buttons so taps feel forgiving on
// touch — the cute pixel buttons stay small, the tappable area does not.
const HIT_PAD = 0.5;
const DROP_LIT_MS = 150;

// Only left / right / drop are interactive. Up + down are intentionally retired:
// the cabinet is a flat front view with a single horizontal rail, so a depth axis
// would be faking 3D. The arrows stay in the art but never light or respond.
const ZONES: ControlKey[] = ["left", "right", "drop"];

export function createInput(opts: InputOptions): {
  state: InputState;
  setEnabled: (on: boolean) => void;
  destroy: () => void;
} {
  const { canvas, manifest, toDesign, onDirDown, onDirUp, onDrop } = opts;
  const controls = manifest.controls;
  const pressed = new Set<ControlKey>();
  // Pause gating (M2 review P1): the legacy adapter bypasses InputBus, so
  // it needs its own switch. Disabling clears every transient hold.
  let enabled = true;

  function hitTest(dx: number, dy: number): ControlKey | null {
    for (const k of ZONES) {
      const r = controls[k];
      const px = r.w * HIT_PAD;
      const py = r.h * HIT_PAD;
      if (
        dx >= r.x - px &&
        dx <= r.x + r.w + px &&
        dy >= r.y - py &&
        dy <= r.y + r.h + py
      ) {
        return k;
      }
    }
    return null;
  }

  let dropLitTimer: number | null = null;

  function tapDrop(): void {
    if (!enabled) return;
    pressed.add("drop");
    if (dropLitTimer !== null) clearTimeout(dropLitTimer);
    dropLitTimer = window.setTimeout(() => {
      dropLitTimer = null;
      pressed.delete("drop");
    }, DROP_LIT_MS);
    onDrop();
  }

  // --- pointer (one active hold at a time) ---
  let holdPointer: number | null = null;
  let holdKey: ControlKey | null = null;

  function endPointerHold(): void {
    if (holdKey) {
      pressed.delete(holdKey);
      holdKey = null;
    }
    holdPointer = null;
    onDirUp();
  }

  function onPointerDown(e: PointerEvent): void {
    if (!enabled) return;
    const d = toDesign(e.clientX, e.clientY);
    const k = hitTest(d.x, d.y);
    if (!k) return;
    e.preventDefault();
    if (k === "drop") {
      tapDrop();
      return;
    }
    holdPointer = e.pointerId;
    holdKey = k;
    pressed.add(k);
    onDirDown(k === "left" ? -1 : 1);
  }

  function onPointerUp(e: PointerEvent): void {
    if (holdPointer !== null && e.pointerId === holdPointer) endPointerHold();
  }

  // --- keyboard ---
  const heldKeys = new Set<string>();

  function onKeyDown(e: KeyboardEvent): void {
    if (!enabled || e.repeat) return;
    if (e.key === "ArrowLeft") {
      heldKeys.add(e.key);
      pressed.add("left");
      onDirDown(-1);
      e.preventDefault();
    } else if (e.key === "ArrowRight") {
      heldKeys.add(e.key);
      pressed.add("right");
      onDirDown(1);
      e.preventDefault();
    } else if (e.key === " " || e.key === "Enter") {
      tapDrop();
      e.preventDefault();
    }
  }

  function onKeyUp(e: KeyboardEvent): void {
    if (e.key === "ArrowLeft" && heldKeys.delete("ArrowLeft")) {
      pressed.delete("left");
      onDirUp();
    } else if (e.key === "ArrowRight" && heldKeys.delete("ArrowRight")) {
      pressed.delete("right");
      onDirUp();
    }
  }

  canvas.addEventListener("pointerdown", onPointerDown);
  window.addEventListener("pointerup", onPointerUp);
  window.addEventListener("pointercancel", onPointerUp);
  window.addEventListener("keydown", onKeyDown);
  window.addEventListener("keyup", onKeyUp);

  function clearTransientState(): void {
    if (dropLitTimer !== null) {
      clearTimeout(dropLitTimer);
      dropLitTimer = null;
    }
    if (holdKey) endPointerHold();
    heldKeys.clear();
    pressed.clear();
  }

  return {
    state: { pressed },
    setEnabled(on: boolean) {
      if (enabled === on) return;
      enabled = on;
      if (!on) clearTransientState();
    },
    destroy() {
      if (dropLitTimer !== null) {
        clearTimeout(dropLitTimer);
        dropLitTimer = null;
      }
      canvas.removeEventListener("pointerdown", onPointerDown);
      window.removeEventListener("pointerup", onPointerUp);
      window.removeEventListener("pointercancel", onPointerUp);
      window.removeEventListener("keydown", onKeyDown);
      window.removeEventListener("keyup", onKeyUp);
    },
  };
}
