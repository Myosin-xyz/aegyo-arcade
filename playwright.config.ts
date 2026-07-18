import { defineConfig, devices } from "@playwright/test";

export default defineConfig({
  testDir: "tests/e2e",
  timeout: 60_000,
  retries: process.env.CI ? 2 : 0,
  use: {
    baseURL: "http://localhost:3105",
    trace: "retain-on-failure",
  },
  projects: [
    // Mobile-first product: the primary E2E profile is a phone viewport.
    { name: "mobile-chromium", use: { ...devices["Pixel 7"] } },
  ],
  webServer: {
    // CI runs against the production build (built in a prior step);
    // local runs use the dev server for iteration speed.
    command: process.env.CI ? "pnpm start --port 3105" : "pnpm dev --port 3105",
    port: 3105,
    reuseExistingServer: !process.env.CI,
    timeout: 120_000,
  },
});
