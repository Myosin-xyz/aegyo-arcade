import { expect, test, type Page } from "@playwright/test";
import { listGames } from "../../src/games/registry";

async function mockPortalApis(page: Page) {
  await page.route("**/api/session", (route) =>
    route.fulfill({
      status: 200,
      contentType: "application/json",
      body: JSON.stringify({ ok: true, locale: "en" }),
    }),
  );
  await page.route("**/api/streak", (route) =>
    route.fulfill({
      status: 200,
      contentType: "application/json",
      body: JSON.stringify({ current: 0, best: 0 }),
    }),
  );
}

test("every gameplay preview remains a working game-card link", async ({
  page,
}) => {
  await mockPortalApis(page);
  await page.goto("/");

  for (const entry of listGames()) {
    const card = page.getByTestId(`game-card-${entry.meta.id}`);
    await card.scrollIntoViewIfNeeded();
    await card.getByTestId(`game-preview-${entry.meta.id}`).click({
      position: { x: 24, y: 24 },
    });
    await expect(page).toHaveURL(new RegExp(`/play/${entry.meta.id}(?:\\?|$)`));
    await page.goBack();
    await expect(page.getByTestId(`game-card-${entry.meta.id}`)).toBeVisible();
  }
});

test("desktop hover loads, plays, and releases only the hovered preview", async ({
  browser,
}) => {
  const context = await browser.newContext({
    viewport: { width: 1280, height: 720 },
    hasTouch: false,
    isMobile: false,
  });
  const page = await context.newPage();
  await mockPortalApis(page);
  await page.goto("http://localhost:3105/");
  expect(await page.evaluate(() => matchMedia("(hover: hover)").matches)).toBe(
    true,
  );

  const preview = page.getByTestId("game-preview-claw");
  await expect(preview).not.toHaveAttribute("src");
  await preview.hover();
  await expect(preview).toHaveAttribute("src", "/games/claw/preview-v1-en.mp4");
  await expect
    .poll(() =>
      preview.evaluate((video) => (video as HTMLVideoElement).currentTime),
    )
    .toBeGreaterThan(0);

  await page.locator("header").hover();
  await expect(preview).not.toHaveAttribute("src");
  await expect
    .poll(() =>
      preview.evaluate((video) => (video as HTMLVideoElement).currentTime),
    )
    .toBe(0);
  await context.close();
});
