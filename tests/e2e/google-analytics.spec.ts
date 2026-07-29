import { expect, test } from "@playwright/test";

const MEASUREMENT_ID = "G-700MXJM1FW";

test("root layout initializes the configured Google Analytics property", async ({
  page,
}) => {
  test.skip(
    !process.env.CI,
    "Google Analytics loads in production builds only",
  );

  // Observe the integration without depending on Google's network being
  // reachable from CI. The inline config should still initialize dataLayer.
  await page.route("https://www.googletagmanager.com/**", (route) =>
    route.abort(),
  );
  let pageUrlAtTagRequest: string | null = null;
  page.on("request", (request) => {
    if (request.url().startsWith("https://www.googletagmanager.com/gtag/js")) {
      pageUrlAtTagRequest = page.url();
    }
  });
  const tagRequest = page.waitForRequest((request) =>
    request.url().startsWith("https://www.googletagmanager.com/gtag/js"),
  );

  await page.goto("/?utm_source=tiktok&gclid=must-not-reach-ga");

  expect(new URL((await tagRequest).url()).searchParams.get("id")).toBe(
    MEASUREMENT_ID,
  );
  expect(pageUrlAtTagRequest).toBe("http://localhost:3105/");
  await expect
    .poll(() =>
      page.evaluate(() =>
        (window.dataLayer ?? []).map((entry) =>
          Array.from(entry as ArrayLike<unknown>),
        ),
      ),
    )
    .toContainEqual(["config", MEASUREMENT_ID]);
});
