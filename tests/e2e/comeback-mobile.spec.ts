import { expect, test } from "@playwright/test";

test("Comeback Climb fits a 320px social-webview and loads music only on play", async ({
  page,
}) => {
  await page.setViewportSize({ width: 320, height: 568 });
  await page.goto("/play/jumper?seed=comeback-mobile-320");
  const host = page.getByTestId("game-host");
  await expect(host).toHaveAttribute("data-lifecycle", "ready", {
    timeout: 30_000,
  });

  const layout = await page.evaluate(() => {
    const buttons = [
      document.querySelector<HTMLElement>('[data-testid="start-counted"]'),
      document.querySelector<HTMLElement>('[data-testid="start-run"]'),
    ];
    return {
      innerWidth: window.innerWidth,
      scrollWidth: document.documentElement.scrollWidth,
      buttons: buttons.map((button) => {
        const rect = button?.getBoundingClientRect();
        return rect
          ? { width: rect.width, height: rect.height, bottom: rect.bottom }
          : null;
      }),
      musicBeforeStart: performance
        .getEntriesByType("resource")
        .some((entry) => entry.name.includes("/games/music/")),
    };
  });
  expect(layout.scrollWidth).toBeLessThanOrEqual(layout.innerWidth);
  expect(layout.musicBeforeStart).toBe(false);
  for (const button of layout.buttons) {
    expect(button).not.toBeNull();
    expect(button!.height).toBeGreaterThanOrEqual(44);
    expect(button!.bottom).toBeLessThanOrEqual(568);
  }

  const musicResponse = page.waitForResponse((response) =>
    response.url().includes("/games/music/jumper.mp3"),
  );
  await page.getByTestId("start-run").click();
  expect((await musicResponse).ok()).toBe(true);
  await expect(host).toHaveAttribute("data-lifecycle", "running");

  const surface = page.getByTestId("game-surface");
  const box = await surface.boundingBox();
  if (!box) throw new Error("Comeback Climb canvas has no bounding box");
  expect(box.x).toBeGreaterThanOrEqual(0);
  expect(box.x + box.width).toBeLessThanOrEqual(320);
  expect(box.y + box.height).toBeLessThanOrEqual(568);

  // Exercise both invisible mobile strengths through the real surface.
  await page.mouse.click(box.x + box.width * 0.44, box.y + box.height * 0.55);
  await page.mouse.click(box.x + box.width * 0.94, box.y + box.height * 0.55);
  await expect(host).toHaveAttribute("data-lifecycle", "running");
});
