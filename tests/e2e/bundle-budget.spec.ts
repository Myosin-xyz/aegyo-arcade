/**
 * Browser-level FIRST-PARTY bundle budget (TECH_SPEC §15; M1 review B7):
 * measures what the browser actually transferred from /_next/ and asserts
 * no game-route prefetch fires from the portal home. Third-party GA is
 * verified separately; its hosted script has its own observational budget.
 *
 * Runs against the production server only (CI); the dev server is
 * unminified and would measure fiction. scripts/check-bundle-budget.mjs
 * remains the fast local approximation.
 */

import { expect, test } from "@playwright/test";

const BUDGET_BYTES = 175 * 1024;

test("home transfers ≤ first-party JS budget and no game prefetch (production)", async ({
  page,
}) => {
  test.skip(
    !process.env.CI,
    "budget is measured against the production build in CI",
  );

  await page.goto("/", { waitUntil: "networkidle" });
  const resources = await page.evaluate(() =>
    performance.getEntriesByType("resource").map((entry) => {
      const r = entry as PerformanceResourceTiming;
      return {
        name: r.name,
        transferSize: r.transferSize,
        encodedBodySize: r.encodedBodySize,
      };
    }),
  );

  const scripts = resources.filter(
    (r) => r.name.includes("/_next/") && /\.js(\?|$)/.test(r.name),
  );
  const totalBytes = scripts.reduce(
    (sum, r) => sum + (r.transferSize || r.encodedBodySize),
    0,
  );
  expect(totalBytes, JSON.stringify(scripts, null, 2)).toBeLessThanOrEqual(
    BUDGET_BYTES,
  );

  // §15: game-card prefetch stays off — landing must not fetch /play/*.
  const gameFetches = resources.filter((r) => r.name.includes("/play/"));
  expect(gameFetches).toEqual([]);
});
