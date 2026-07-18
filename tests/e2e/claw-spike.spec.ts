/**
 * M0 claw contract spike (TECH_SPEC §6.1.1): the REAL claw — real engine,
 * real assets — mounts, starts, pauses, resumes, and unmounts through the
 * GameHost adapter in a real browser.
 *
 * Restart-in-place note: the claw's win→replay cycle is internal to the
 * engine; contract-level repeatable start() on a fresh RunContext is the
 * M1 completion item (§7.1.2) and is covered at driver level by the
 * conformance suite.
 */

import { expect, test } from "@playwright/test";

test("portal lists the claw and navigates to it", async ({ page }) => {
  await page.goto("/");
  const card = page.getByTestId("game-card-claw");
  await expect(card).toBeVisible();
  await card.click();
  await expect(page).toHaveURL(/\/play\/claw/);
});

test("claw mounts, starts, pauses, resumes, and unmounts cleanly", async ({
  page,
}) => {
  await page.goto("/play/claw");
  const host = page.getByTestId("game-host");

  // init → ready (real manifest + sprite loads).
  await expect(host).toHaveAttribute("data-lifecycle", "ready", {
    timeout: 30_000,
  });

  // start → running, and the engine actually paints.
  await page.getByTestId("start-run").click();
  await expect(host).toHaveAttribute("data-lifecycle", "running");
  await page.waitForTimeout(400); // a few frames
  const painted = await page.evaluate(() => {
    const canvas = document.querySelector("canvas");
    if (!canvas) return false;
    const ctx = canvas.getContext("2d");
    if (!ctx) return false;
    const { data } = ctx.getImageData(
      0,
      0,
      Math.min(64, canvas.width),
      Math.min(64, canvas.height),
    );
    return data.some((v, i) => i % 4 !== 3 && v !== 0);
  });
  expect(painted).toBe(true);

  // window blur → host pauses the module loop.
  await page.evaluate(() => window.dispatchEvent(new Event("blur")));
  await expect(host).toHaveAttribute("data-lifecycle", "paused");

  // resume → running again.
  await page.getByTestId("resume-run").click();
  await expect(host).toHaveAttribute("data-lifecycle", "running");

  // pointer input reaches the engine without errors (tap the canvas).
  const pageErrors: string[] = [];
  page.on("pageerror", (err) => pageErrors.push(String(err)));
  await page.locator("canvas").click({ position: { x: 50, y: 50 } });

  // unmount via back-navigation — no crash, portal renders.
  await page.getByRole("link", { name: /back/i }).click();
  await expect(page.getByTestId("game-card-claw")).toBeVisible();
  expect(pageErrors).toEqual([]);
});
