import type { ControlKey, Manifest } from "./types";

export interface InputState {
  /** controls currently showing their lit overlay */
  pressed: Set<ControlKey>;
}

interface InputOptions {
  canvas: HTMLCanvasElement;
  manifest: Manifest;
  toDesign: (clientX: number, clientY: number) => { x: number; y: number };
  /** a horizontal direction is being held (claw glides while held) */
  onDirDown: (dir: -1 | 1) => void;
  /** the held horizontal direction was released */
  onDirUp: () => void;
  /** a depth direction is being held: -1 = deeper (away), +1 = closer */
  onDepthDown: (dir: -1 | 1) => void;
  /** the held depth direction was released */
  onDepthUp: () => void;
  /** the drop button was tapped */
  onDrop: () => void;
}

// Hit zones are expanded well past the drawn buttons so taps feel forgiving on
// touch — the cute pixel buttons stay small, the tappable area does not.
const HIT_PAD = 0.5;
const DROP_LIT_MS = 150;

// All four directions are live (team feedback, 2026-07-19): forward/backward
// restore the original machine's depth axis as a pseudo-perspective glide —
// the gantry rides slightly lower "closer" to the glass and the aim shadow
// travels down the pile. Assets for the lit arrows shipped with the port.
const ZONES: ControlKey[] = ["left", "right", "forward", "backward", "drop"];

/** forward = away from the viewer (up-screen), backward = toward it. */
const DEPTH_DIR: Partial<Record<ControlKey, -1 | 1>> = {
  forward: -1,
  backward: 1,
};
const X_DIR: Partial<Record<ControlKey, -1 | 1>> = { left: -1, right: 1 };

export function createInput(opts: InputOptions): {
  state: InputState;
  setEnabled: (on: boolean) => void;
  destroy: () => void;
} {
  const {
    canvas,
    manifest,
    toDesign,
    onDirDown,
    onDirUp,
    onDepthDown,
    onDepthUp,
    onDrop,
  } = opts;
  const controls = manifest.controls;
  const pressed = new Set<ControlKey>();
  // Pause gating (M2 review P1): the legacy adapter bypasses InputBus, so
  // it needs its own switch. Disabling clears every transient hold.
  let enabled = true;

  function hitTest(dx: number, dy: number): ControlKey | null {
    // The padded zones OVERLAP on the d-pad cross (a visible tap on the
    // forward button also lands in left's padded zone), so first-match
    // misroutes corner taps. Resolve every match to the NEAREST button
    // center instead (review P1, 2026-07-19).
    let best: ControlKey | null = null;
    let bestDist = Infinity;
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
        const cx = r.x + r.w / 2;
        const cy = r.y + r.h / 2;
        const dist = (dx - cx) * (dx - cx) + (dy - cy) * (dy - cy);
        if (dist < bestDist) {
          bestDist = dist;
          best = k;
        }
      }
    }
    return best;
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

  // SOURCE-tagged hold registry (review P2 rounds 1+2, 2026-07-19):
  // two physical sources can hold the SAME control (a pointer on Left
  // plus ArrowLeft, or two pointers on one button), and opposite
  // controls can be held on one axis. Releases remove only the exact
  // released source; each axis then recomputes its EFFECTIVE direction
  // (newest surviving hold wins) and emits callbacks only when that
  // effective state actually changes — so releasing a redundant hold
  // neither stops movement nor unlights a still-held button.
  interface Hold {
    source: string;
    control: ControlKey;
  }
  const holds: Hold[] = [];
  let lastX: -1 | 0 | 1 = 0;
  let lastZ: -1 | 0 | 1 = 0;

  function effectiveDir(dirs: Partial<Record<ControlKey, -1 | 1>>): -1 | 0 | 1 {
    for (let i = holds.length - 1; i >= 0; i--) {
      const dir = dirs[holds[i].control];
      if (dir !== undefined) return dir;
    }
    return 0;
  }

  function syncAxes(): void {
    for (const k of Object.keys(DEPTH_DIR).concat(
      Object.keys(X_DIR),
    ) as ControlKey[]) {
      if (holds.some((hold) => hold.control === k)) pressed.add(k);
      else pressed.delete(k);
    }
    const effX = effectiveDir(X_DIR);
    if (effX !== lastX) {
      lastX = effX;
      if (effX === 0) onDirUp();
      else onDirDown(effX);
    }
    const effZ = effectiveDir(DEPTH_DIR);
    if (effZ !== lastZ) {
      lastZ = effZ;
      if (effZ === 0) onDepthUp();
      else onDepthDown(effZ);
    }
  }

  function press(source: string, control: ControlKey): void {
    const i = holds.findIndex((hold) => hold.source === source);
    if (i >= 0) holds.splice(i, 1);
    holds.push({ source, control });
    syncAxes();
  }

  function release(source: string): void {
    const i = holds.findIndex((hold) => hold.source === source);
    if (i < 0) return;
    holds.splice(i, 1);
    syncAxes();
  }

  // --- pointer (per-pointer holds, so a thumb can steer while the other
  // adjusts depth — the two axes are independent) ---
  const pointerHolds = new Map<number, ControlKey>();

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
    pointerHolds.set(e.pointerId, k);
    press(`ptr:${e.pointerId}`, k);
  }

  function onPointerUp(e: PointerEvent): void {
    if (pointerHolds.delete(e.pointerId)) release(`ptr:${e.pointerId}`);
  }

  // --- keyboard ---
  const KEY_TO_CONTROL: Record<string, ControlKey> = {
    ArrowLeft: "left",
    ArrowRight: "right",
    ArrowUp: "forward",
    ArrowDown: "backward",
  };
  const heldKeys = new Set<string>();

  function onKeyDown(e: KeyboardEvent): void {
    if (!enabled || e.repeat) return;
    const control = KEY_TO_CONTROL[e.key];
    if (control) {
      heldKeys.add(e.key);
      press(`key:${e.key}`, control);
      e.preventDefault();
    } else if (e.key === " " || e.key === "Enter") {
      tapDrop();
      e.preventDefault();
    }
  }

  function onKeyUp(e: KeyboardEvent): void {
    if (KEY_TO_CONTROL[e.key] && heldKeys.delete(e.key)) {
      release(`key:${e.key}`);
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
    pointerHolds.clear();
    heldKeys.clear();
    holds.length = 0;
    syncAxes(); // emits the Ups for any axis that was active
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
