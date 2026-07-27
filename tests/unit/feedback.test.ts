/**
 * Shared hit feedback (Daidai polish round): trigger/decay semantics and
 * the reduced-motion posture — shake suppressed, flash kept (the flash is
 * the lose SIGNAL; motion is what the preference governs).
 */

import { afterEach, describe, expect, it, vi } from "vitest";
import {
  FLASH_MS,
  SHAKE_MS,
  createHitFeedback,
  drawHitFlash,
  shakeOffset,
  tickHitFeedback,
  triggerHitFeedback,
} from "@/shell/feedback";

function stubReducedMotion(matches: boolean): void {
  vi.stubGlobal(
    "matchMedia",
    vi.fn(() => ({ matches }) as MediaQueryList),
  );
}

afterEach(() => {
  vi.unstubAllGlobals();
});

describe("hit feedback", () => {
  it("trigger arms flash + shake; tick decays both to zero", () => {
    stubReducedMotion(false);
    const f = createHitFeedback();
    triggerHitFeedback(f);
    expect(f.flashMs).toBe(FLASH_MS);
    expect(f.shakeMs).toBe(SHAKE_MS);
    // Deterministic randomness → EXACT nonzero offset (audit follow-up:
    // a bounds-only check would pass a shakeOffset that always returned
    // zero). random()=1 → +mag, random()=0 → −mag at full shakeMs.
    const random = vi
      .spyOn(Math, "random")
      .mockReturnValueOnce(1)
      .mockReturnValueOnce(0);
    expect(shakeOffset(f)).toEqual({ x: 5, y: -5 });
    random.mockRestore();
    // And bounded by the decaying magnitude with real randomness.
    for (let i = 0; i < 20; i++) {
      const off = shakeOffset(f);
      expect(Math.abs(off.x)).toBeLessThanOrEqual(5);
      expect(Math.abs(off.y)).toBeLessThanOrEqual(5);
    }
    tickHitFeedback(f, FLASH_MS + SHAKE_MS);
    expect(f.flashMs).toBe(0);
    expect(f.shakeMs).toBe(0);
    expect(shakeOffset(f)).toEqual({ x: 0, y: 0 });
  });

  it("prefers-reduced-motion suppresses the SHAKE but keeps the flash", () => {
    stubReducedMotion(true);
    const f = createHitFeedback();
    triggerHitFeedback(f);
    expect(f.shakeMs).toBe(0); // no motion
    expect(f.flashMs).toBe(FLASH_MS); // the signal stays
    expect(shakeOffset(f)).toEqual({ x: 0, y: 0 });
  });

  it("drawHitFlash paints only while armed, with fading alpha", () => {
    stubReducedMotion(false);
    const f = createHitFeedback();
    const ops: string[] = [];
    const g = new Proxy(
      {},
      {
        get: (target, prop) => {
          if (prop === "fillRect") return () => ops.push("fillRect");
          const v = (target as Record<PropertyKey, unknown>)[prop];
          return v !== undefined ? v : () => undefined;
        },
        set: () => true,
      },
    ) as unknown as CanvasRenderingContext2D;
    drawHitFlash(g, f, 100, 100);
    expect(ops).toEqual([]); // idle: nothing painted
    triggerHitFeedback(f);
    drawHitFlash(g, f, 100, 100);
    expect(ops).toEqual(["fillRect"]);
  });
});
