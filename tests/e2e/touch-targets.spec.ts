/**
 * Touch targets measured in a REAL browser at the smallest viewport we
 * support (M2.5 review P2, extended by the pre-launch operator pass).
 *
 * Unit tests can only prove design-space CONSTANTS against a surface size
 * captured by hand. They cannot notice a HOST-layout change — taller
 * header, new chrome, different letterbox margins — that shrinks the
 * surface underneath correct constants. These read live bounding boxes, so
 * the guarantee is about what a thumb actually gets.
 *
 * Why 320×568: the floor of the Phase 7 mobile sweep, and the shape of the
 * IG/TikTok in-app browser that carries ~95% of our traffic.
 */

import { expect, test, type Page } from "@playwright/test";
import { dpadRects } from "../../src/games/snake/module";
import { DESIGN_H } from "../../src/games/snake/render";
import { HIT_PAD } from "../../src/games/claw/engine/input";
import clawManifest from "../../public/games/claw/manifest.json";

/** iOS touch-target guidance. */
const MIN_TOUCH_CSS_PX = 44;
/** Typical iPhone home-indicator inset — the Down button must clear it. */
const MIN_BOTTOM_CLEARANCE_CSS_PX = 34;

/** Boot a game to its ready card. */
async function open(page: Page, gameId: string): Promise<void> {
  await page.goto(`/play/${gameId}`);
  await expect(page.getByTestId("game-host")).toHaveAttribute(
    "data-lifecycle",
    "ready",
    { timeout: 30_000 },
  );
}

/** Boot a game and start a practice run. */
async function startRun(page: Page, gameId: string): Promise<void> {
  await open(page, gameId);
  await page.getByTestId("start-run").click();
  await expect(page.getByTestId("game-host")).toHaveAttribute(
    "data-lifecycle",
    "running",
  );
}

test.describe("touch targets at the 320px floor", () => {
  test.use({ viewport: { width: 320, height: 568 } });

  test("global Back and Sound controls are at least 44×44", async ({
    page,
  }) => {
    // These two are on EVERY game screen and were the smallest targets in
    // the app — roughly 16×20 and 28×20 before this pass.
    await open(page, "snake");
    for (const testid of ["host-back", "host-mute"]) {
      const box = await page.getByTestId(testid).boundingBox();
      expect(box, `${testid} missing`).not.toBeNull();
      if (!box) continue;
      expect(box.width, `${testid} width`).toBeGreaterThanOrEqual(
        MIN_TOUCH_CSS_PX,
      );
      expect(box.height, `${testid} height`).toBeGreaterThanOrEqual(
        MIN_TOUCH_CSS_PX,
      );
    }
  });

  test("hangman letter keys are at least 44×44 and fit without overflow", async ({
    page,
  }) => {
    await startRun(page, "hangman");
    const keys = page.locator("button[data-letter]");
    const count = await keys.count();
    expect(count, "expected the full alphabet").toBe(26);
    for (let i = 0; i < count; i++) {
      const key = keys.nth(i);
      const letter = await key.getAttribute("data-letter");
      const box = await key.boundingBox();
      expect(box, `key ${letter} missing`).not.toBeNull();
      if (!box) continue;
      expect(box.width, `key ${letter} width`).toBeGreaterThanOrEqual(
        MIN_TOUCH_CSS_PX,
      );
      expect(box.height, `key ${letter} height`).toBeGreaterThanOrEqual(
        MIN_TOUCH_CSS_PX,
      );
    }
    const overflow = await page.evaluate(
      () =>
        document.documentElement.scrollWidth -
        document.documentElement.clientWidth,
    );
    expect(overflow, "hangman keyboard overflows at 320px").toBeLessThanOrEqual(
      0,
    );
  });

  test("claw directional controls clear 44px once hit padding is applied", async ({
    page,
  }) => {
    // The claw deliberately draws SMALL pixel buttons and pads the hit
    // zones instead, so the number that matters is the padded zone, not
    // the art. Drop is excluded: it is far larger than the minimum.
    await startRun(page, "claw");
    const box = await page.locator("canvas").first().boundingBox();
    expect(box, "no claw canvas mounted").not.toBeNull();
    if (!box) return;

    const scale = Math.min(
      box.width / clawManifest.design.w,
      box.height / clawManifest.design.h,
    );
    for (const key of ["left", "right", "forward", "backward"] as const) {
      const r = clawManifest.controls[key];
      // hitTest pads by HIT_PAD × the rect on EACH side.
      const w = r.w * (1 + 2 * HIT_PAD) * scale;
      const h = r.h * (1 + 2 * HIT_PAD) * scale;
      expect(w, `claw ${key} hit width (CSS px)`).toBeGreaterThanOrEqual(
        MIN_TOUCH_CSS_PX,
      );
      expect(h, `claw ${key} hit height (CSS px)`).toBeGreaterThanOrEqual(
        MIN_TOUCH_CSS_PX,
      );
    }
  });

  test("D-pad clears 44px and the home-indicator inset on the live canvas", async ({
    page,
  }) => {
    const pageErrors: string[] = [];
    page.on("pageerror", (error) => pageErrors.push(String(error)));

    await startRun(page, "snake");

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
