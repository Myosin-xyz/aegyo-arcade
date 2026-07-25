/**
 * Freebie HUD score containment against REAL Chromium canvas metrics
 * (Daidai overflow fix, review P2): the synthetic-width unit test proves
 * the fitFontPx math, but only a real font engine proves that "128",
 * "1000", and the 2277 maximum actually stay inside the baked score pill.
 * This replicates the production sizing decision in an in-browser canvas
 * and asserts the resulting measured width never exceeds SCORE_MAX_W.
 */

import { expect, test } from "@playwright/test";
import {
  SCORE_BASE_PX,
  SCORE_MAX_W,
  SCORE_MIN_PX,
} from "../../src/games/freebie/render";

test("freebie score fits its pill at 128 / 1000 / 2277 (real canvas metrics)", async ({
  page,
}) => {
  // Any served document gives us system-ui + a real 2D context.
  await page.goto("/");

  const widths = await page.evaluate(
    ({ maxW, base, min }) => {
      const ctx = document.createElement("canvas").getContext("2d");
      if (!ctx) throw new Error("no 2d context");
      const measure = (s: string): number => {
        // Mirror render.ts fitScoreSize exactly: analytic seed, then
        // remeasure-and-step-down until it fits (down to `min`).
        ctx.font = `700 ${base}px system-ui, sans-serif`;
        const w0 = ctx.measureText(s).width;
        let size =
          w0 <= 0 || w0 <= maxW
            ? base
            : Math.max(min, Math.floor(base * (maxW / w0)));
        while (size > min) {
          ctx.font = `700 ${size}px system-ui, sans-serif`;
          const w = ctx.measureText(s).width;
          if (w <= 0 || w <= maxW) break;
          size -= 1;
        }
        ctx.font = `700 ${size}px system-ui, sans-serif`;
        return ctx.measureText(s).width;
      };
      return {
        d3: measure("128"),
        d4: measure("1000"),
        max: measure("2277"),
      };
    },
    { maxW: SCORE_MAX_W, base: SCORE_BASE_PX, min: SCORE_MIN_PX },
  );

  // The chosen size alone contains every case; fillText's maxWidth arg in
  // render.ts is the additional spec-guaranteed hard clamp.
  expect(widths.d3, "128").toBeLessThanOrEqual(SCORE_MAX_W);
  expect(widths.d4, "1000").toBeLessThanOrEqual(SCORE_MAX_W);
  expect(widths.max, "2277").toBeLessThanOrEqual(SCORE_MAX_W);
});
