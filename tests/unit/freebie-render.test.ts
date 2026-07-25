/**
 * Renderer WIRING regression (review P2, 2026-07-25): the Chromium
 * real-metrics test proves fitScoreSize's math, but it mirrors the logic
 * rather than calling renderFreebie — so it would stay green if the
 * production renderer stopped fitting the score or dropped the maxWidth
 * clamp. This drives the REAL renderFreebie with controlled measureText
 * results and asserts the production wiring: the 2277 score is drawn at a
 * REDUCED font AND via fillText(text, x, y, SCORE_MAX_W).
 */

import { describe, expect, it } from "vitest";
import { seededRandom } from "@/shell/rng";
import { createFreebieState } from "@/games/freebie/logic";
import {
  SCORE_BASE_PX,
  SCORE_MAX_W,
  renderFreebie,
  type FreebieImages,
} from "@/games/freebie/render";

interface FillCall {
  text: string;
  maxWidth: number | undefined;
  font: string;
}

/**
 * Minimal recording 2D context: `measureText` returns a width driven by
 * the current font's px size (so text "shrinks" as the renderer steps the
 * size down), `fillText` records its args + the active font, and every
 * other canvas method is a no-op. `widthFor(px)` = px * 1.8 overflows the
 * ~25px pill at 17px and fits once the renderer drops below it.
 */
function recordingCtx(): { ctx: CanvasRenderingContext2D; fills: FillCall[] } {
  const fills: FillCall[] = [];
  let font = "";
  const target: Record<PropertyKey, unknown> = {
    get font() {
      return font;
    },
    set font(value: string) {
      font = value;
    },
    measureText(_s: string): TextMetrics {
      const px = Number(/(\d+)px/.exec(font)?.[1] ?? "17");
      return { width: px * 1.8 } as TextMetrics;
    },
    fillText(text: string, _x: number, _y: number, maxWidth?: number): void {
      fills.push({ text, maxWidth, font });
    },
  };
  const ctx = new Proxy(target, {
    get(t, prop) {
      if (prop in t) return t[prop];
      return () => undefined; // save/restore/drawImage/beginPath/… no-op
    },
  }) as unknown as CanvasRenderingContext2D;
  return { ctx, fills };
}

function stubImages(): FreebieImages {
  const img = { naturalWidth: 130, naturalHeight: 160 } as HTMLImageElement;
  return { bg: img, hero: img, tiers: Array.from({ length: 6 }, () => img) };
}

describe("freebie render — score-fit production wiring (P2)", () => {
  it("draws the 2277 maximum at a reduced font AND through the SCORE_MAX_W fillText clamp", () => {
    const state = createFreebieState(seededRandom("render-wiring"));
    state.score = 2277; // the container-busting maximum
    const { ctx, fills } = recordingCtx();

    renderFreebie(ctx, state, stubImages(), (key) => key);

    const scoreFill = fills.find((f) => f.text === "2277");
    expect(scoreFill, "renderFreebie must draw the score value").toBeDefined();
    // Wiring 1: the hard containment clamp is passed to fillText.
    expect(scoreFill!.maxWidth).toBe(SCORE_MAX_W);
    // Wiring 2: the font was actually reduced below the base to fit.
    const px = Number(/(\d+)px/.exec(scoreFill!.font)?.[1] ?? "0");
    expect(px).toBeGreaterThan(0);
    expect(px).toBeLessThan(SCORE_BASE_PX);
  });
});
