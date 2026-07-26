/**
 * Snake D-pad touch targets measured in a REAL browser at the smallest
 * viewport we support (M2.5 review P2).
 *
 * The unit test in tests/unit/snake-module.test.ts proves the design-space
 * constants against a canvas height captured by hand. That cannot notice a
 * HOST-layout change — taller header, new chrome, different letterbox
 * margins — that shrinks the canvas underneath correct constants. This test
 * reads the live bounding box instead, so the guarantee is about what a
 * thumb actually gets rather than about yesterday's measurement.
 *
 * Why 320×568: the floor of the Phase 7 mobile sweep, and the shape of the
 * IG/TikTok in-app browser that carries ~95% of our traffic.
 */

import { expect, test } from "@playwright/test";
import { dpadRects } from "../../src/games/snake/module";
import { DESIGN_H } from "../../src/games/snake/render";

/** iOS touch-target guidance. */
const MIN_TOUCH_CSS_PX = 44;
/** Typical iPhone home-indicator inset — the Down button must clear it. */
const MIN_BOTTOM_CLEARANCE_CSS_PX = 34;

test.describe("snake touch targets at the 320px floor", () => {
  test.use({ viewport: { width: 320, height: 568 } });

  test("D-pad clears 44px and the home-indicator inset on the live canvas", async ({
    page,
  }) => {
    const pageErrors: string[] = [];
    page.on("pageerror", (error) => pageErrors.push(String(error)));

    await page.goto("/play/snake");
    const host = page.getByTestId("game-host");
    await expect(host).toHaveAttribute("data-lifecycle", "ready", {
      timeout: 30_000,
    });
    await page.getByTestId("start-run").click();
    await expect(host).toHaveAttribute("data-lifecycle", "running");

    const box = await page.locator("canvas").first().boundingBox();
    expect(box, "no canvas mounted").not.toBeNull();
    if (!box) return;

    // The design box is letterboxed by the SHORTER axis. On a tall phone
    // that is height, which is exactly the axis an earlier width-based
    // estimate got wrong (46 design px read as 41 CSS px; it was 38).
    const scale = box.height / DESIGN_H;
    const rects = dpadRects();

    for (const [name, r] of Object.entries(rects)) {
      expect(
        r.w * scale,
        `${name} button width (CSS px)`,
      ).toBeGreaterThanOrEqual(MIN_TOUCH_CSS_PX);
      expect(
        r.h * scale,
        `${name} button height (CSS px)`,
      ).toBeGreaterThanOrEqual(MIN_TOUCH_CSS_PX);
    }

    const bottomClearance = (DESIGN_H - (rects.down.y + rects.down.h)) * scale;
    expect(
      bottomClearance,
      "clearance under the Down button (CSS px)",
    ).toBeGreaterThanOrEqual(MIN_BOTTOM_CLEARANCE_CSS_PX);

    // The whole D-pad must be on-screen, not clipped by the letterbox.
    expect(box.y + (rects.down.y + rects.down.h) * scale).toBeLessThanOrEqual(
      568,
    );

    // And the page itself must not scroll sideways at this width.
    const overflow = await page.evaluate(
      () =>
        document.documentElement.scrollWidth -
        document.documentElement.clientWidth,
    );
    expect(overflow, "horizontal overflow at 320px").toBeLessThanOrEqual(0);

    expect(pageErrors).toEqual([]);
  });
});
