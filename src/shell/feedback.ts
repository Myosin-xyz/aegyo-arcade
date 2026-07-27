/**
 * "Something bad happened" feedback — a brief red screen wash plus a
 * small canvas shake (Daidai polish round, 2026-07-27: "red flashing
 * whole screen when something bad happen with a little screen shake").
 *
 * One shared implementation so every game FEELS the same: modules keep a
 * HitFeedback value, `trigger` it on deaths/hits/losses, `tick` it in
 * update, and bracket their draw with `shakeOffset` + `drawFlash`.
 * The shake honors prefers-reduced-motion (the flash stays — it is the
 * lose SIGNAL, and 300ms at ≤0.28 alpha is comfortably under flash
 * thresholds; motion is what the preference is about).
 */

export const FLASH_MS = 300;
export const SHAKE_MS = 260;
export const SHAKE_MAG = 5; // design px, decaying

export interface HitFeedback {
  flashMs: number;
  shakeMs: number;
}

export function createHitFeedback(): HitFeedback {
  return { flashMs: 0, shakeMs: 0 };
}

function reducedMotion(): boolean {
  return (
    typeof window !== "undefined" &&
    typeof window.matchMedia === "function" &&
    window.matchMedia("(prefers-reduced-motion: reduce)").matches
  );
}

export function triggerHitFeedback(f: HitFeedback): void {
  f.flashMs = FLASH_MS;
  f.shakeMs = reducedMotion() ? 0 : SHAKE_MS;
}

export function tickHitFeedback(f: HitFeedback, dtMs: number): void {
  f.flashMs = Math.max(0, f.flashMs - dtMs);
  f.shakeMs = Math.max(0, f.shakeMs - dtMs);
}

/** Random jitter offset, decaying to zero — apply via ctx.translate
 * BEFORE the game draw and translate back (or save/restore) after. */
export function shakeOffset(f: HitFeedback): { x: number; y: number } {
  if (f.shakeMs <= 0) return { x: 0, y: 0 };
  const mag = SHAKE_MAG * (f.shakeMs / SHAKE_MS);
  return {
    x: (Math.random() - 0.5) * 2 * mag,
    y: (Math.random() - 0.5) * 2 * mag,
  };
}

/** Red wash over the whole surface, fading out. Draw LAST. */
export function drawHitFlash(
  g: CanvasRenderingContext2D,
  f: HitFeedback,
  w: number,
  h: number,
): void {
  if (f.flashMs <= 0) return;
  g.save();
  g.globalAlpha = 0.28 * (f.flashMs / FLASH_MS);
  g.fillStyle = "#ff2a3c";
  g.fillRect(0, 0, w, h);
  g.restore();
}
