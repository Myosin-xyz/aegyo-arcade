// Explicit synthetic-only proof of the two deployed staging origins.
// It resets the seeded test member's password. It never imports or reads a real user.
import "../../services/accounts/scripts/check-runtime.mjs";
import { readFile, writeFile } from "node:fs/promises";
import { randomBytes } from "node:crypto";
import assert from "node:assert/strict";
import { chromium } from "@playwright/test";
import pg from "pg";
import { createAccountsProvider } from "../../services/accounts/src/provider-core.mjs";
import { databaseOptions } from "../../services/accounts/src/database-options.mjs";

if (process.env.ACCOUNTS_STAGING_BROWSER_CONFIRM !== "synthetic-only")
  throw new Error(
    "Set ACCOUNTS_STAGING_BROWSER_CONFIRM=synthetic-only to reset the staging fixture",
  );
const proofRoot = new URL("../../services/accounts/.proof/", import.meta.url);
const seedPath = new URL("staging-seed.json", proofRoot);
const seed = JSON.parse(await readFile(seedPath, "utf8"));
const infrastructure = JSON.parse(
  await readFile(new URL("railway-staging.json", proofRoot), "utf8"),
);
const arcade = "https://arcade-auth-preview-accounts-staging.up.railway.app";
const accounts = "https://aegyo-accounts-accounts-staging.up.railway.app";
assert.ok(
  seed.environment === "staging" &&
    seed.baseURL === accounts &&
    infrastructure.baseURL === accounts &&
    infrastructure.environmentId === "279e0a09-8ba3-42dc-8d44-a2598d1f3fe9" &&
    infrastructure.databaseServiceId ===
      "950e29c3-1592-4b09-be95-572ce43030c5" &&
    seed.member.email.endsWith("@example.invalid"),
  "Unexpected staging target",
);

const report = {
  startedAt: new Date().toISOString(),
  browser: "Chromium",
  checks: [],
  origins: [accounts, arcade],
  resetEmailTransport: "local recorder; delivery not tested",
};
let phase = "launch";
let browser;
let database;
const passed = (name) => {
  report.checks.push(name);
  console.log(`PASS ${name}`);
};
try {
  browser = await chromium.launch({ headless: true });
  const deviceA = await browser.newContext({
    viewport: { width: 1280, height: 900 },
  });
  const deviceB = await browser.newContext({
    viewport: { width: 390, height: 844 },
  });
  const a = await deviceA.newPage();
  const b = await deviceB.newPage();
  a.setDefaultTimeout(20_000);
  b.setDefaultTimeout(20_000);
  const cookie = async (context, name) =>
    (await context.cookies(arcade)).find((c) => c.name === name);
  const memberState = async (context) =>
    context.request.get(`${arcade}/api/accounts/session`);
  const login = async (page, password, spanish = false) => {
    await page
      .getByLabel(spanish ? "Correo electrónico" : "Email address", {
        exact: true,
      })
      .fill(seed.member.email);
    await page
      .getByLabel(spanish ? "Contraseña" : "Password", { exact: true })
      .fill(password);
    await page
      .getByRole("button", {
        name: spanish ? "Iniciar sesión" : "Sign in",
        exact: true,
      })
      .click();
    await page.waitForURL(`${arcade}/`);
  };

  phase = "guest bootstrap";
  await a.goto(`${arcade}/`);
  const guestResponse = await deviceA.request.post(`${arcade}/api/session`, {
    headers: { origin: arcade },
    data: { locale: "en" },
  });
  assert.ok(guestResponse.ok(), "Guest bootstrap unavailable");
  const guestBefore = await guestResponse.json();
  const guestCookie = await cookie(deviceA, "__Host-aegyo_device");
  assert.ok(guestCookie?.value, "Guest cookie missing");
  passed("guest play identity exists before login");

  phase = "desktop sign-in and locale continuation";
  await a.getByRole("link", { name: "Sign in", exact: true }).click();
  await a.waitForURL(
    (url) => url.origin === accounts && url.pathname === "/sign-in",
  );
  await a.getByRole("link", { name: "Español", exact: true }).click();
  await a
    .getByRole("heading", { name: "Qué bueno verte", exact: true })
    .waitFor();
  await a.screenshot({
    path: new URL("staging-sign-in-desktop.png", proofRoot).pathname,
  });
  await login(a, seed.member.password, true);
  assert.ok((await memberState(deviceA)).ok(), "Arcade member session missing");
  const memberCookie = await cookie(deviceA, "__Host-aegyo_member");
  assert.ok(
    memberCookie?.httpOnly &&
      memberCookie.secure &&
      memberCookie.sameSite === "Lax",
    "Member cookie security mismatch",
  );
  assert.ok(
    (await cookie(deviceA, "__Host-aegyo_device"))?.value === guestCookie.value,
    "Guest identity changed on login",
  );
  assert.ok(
    !(await cookie(deviceA, "__Host-aegyo_oidc_tx")),
    "Transaction cookie survived callback",
  );
  passed(
    "desktop OAuth login survives language change and preserves guest identity",
  );

  phase = "Arcade logout and provider SSO";
  const logout = await deviceA.request.post(`${arcade}/api/accounts/logout`, {
    headers: { origin: arcade },
  });
  assert.ok(logout.ok(), "Arcade logout failed");
  assert.ok(
    (await memberState(deviceA)).status() === 401,
    "Local logout left a member session",
  );
  await a.goto(`${arcade}/api/accounts/login`);
  await a.waitForURL(`${arcade}/`);
  assert.ok(
    (await memberState(deviceA)).ok(),
    "Existing SSO did not restore product login",
  );
  passed(
    "product logout and sign-in reuse the provider session without another password",
  );

  phase = "second-device mobile login";
  await b.goto(`${arcade}/api/accounts/login`);
  await b.waitForURL(
    (url) => url.origin === accounts && url.pathname === "/sign-in",
  );
  await b.screenshot({
    path: new URL("staging-sign-in-mobile.png", proofRoot).pathname,
  });
  assert.ok(
    await b.evaluate(() => document.documentElement.scrollWidth <= innerWidth),
    "Mobile page overflows",
  );
  await login(b, seed.member.password);
  assert.ok(
    (await memberState(deviceB)).ok(),
    "Second-device member session missing",
  );
  passed("a fresh mobile browser signs in through the same provider");

  phase = "synthetic recovery issuance";
  const connection = new URL(infrastructure.DATABASE_PUBLIC_URL);
  connection.username = infrastructure.appRole;
  connection.password = infrastructure.appPassword;
  database = new pg.Pool({
    ...databaseOptions(connection.href, {
      caCertificate: infrastructure.databaseCA,
      serverSHA256: infrastructure.databaseServerSHA256,
    }),
    max: 2,
    connectionTimeoutMillis: 5_000,
  });
  const messages = [];
  const { auth } = createAccountsProvider({
    database,
    baseURL: accounts,
    secret: infrastructure.secret,
    legacyPepper: infrastructure.legacyPepper,
    mail: async (kind, message) => {
      if (kind === "reset") messages.push(message);
    },
  });
  await auth.api.requestPasswordReset({
    body: {
      email: seed.member.email,
      redirectTo: `${accounts}/reset-password`,
    },
    headers: new Headers({
      origin: accounts,
      "x-aegyo-client-ip": "192.0.2.50",
    }),
  });
  assert.ok(messages.length === 1, "Synthetic reset link was not recorded");
  // Uses the real emailed-link route, while recording delivery only in local memory.
  phase = "reset through deployed UI";
  await a.goto(messages[0].url);
  const newPassword = randomBytes(28).toString("base64url");
  await a.getByLabel("New password", { exact: true }).fill(newPassword);
  await a.getByLabel("Confirm new password", { exact: true }).fill(newPassword);
  await a
    .getByRole("button", { name: "Save new password", exact: true })
    .click();
  await a.waitForURL(`${accounts}/reset-password?status=success`);
  seed.member.password = newPassword;
  await writeFile(seedPath, JSON.stringify(seed, null, 2) + "\n", {
    mode: 0o600,
  });
  passed("password reset succeeds through the deployed recovery route and UI");

  phase = "cleared-app-cookies stale SSO";
  await deviceB.clearCookies({ domain: new URL(arcade).hostname });
  await b.goto(`${arcade}/api/accounts/login`);
  await b.waitForURL(
    (url) => url.origin === accounts && url.pathname === "/sign-in",
  );
  assert.ok(
    await b.getByLabel("Password", { exact: true }).isVisible(),
    "Stale provider SSO bypassed interactive login",
  );
  await login(b, newPassword);
  assert.ok(
    (await memberState(deviceB)).ok(),
    "New password did not restore login",
  );
  passed(
    "reset plus cleared product cookies forces fresh authentication on the other device",
  );

  phase = "existing member-session revocation";
  const deadline = Date.now() + 35_000;
  let status;
  do {
    status = (await memberState(deviceA)).status();
    if (status === 401) break;
    await new Promise((resolve) => setTimeout(resolve, 1_000));
  } while (Date.now() < deadline);
  assert.ok(
    status === 401,
    "Old product session outlived its provider freshness window",
  );
  assert.ok(
    (await cookie(deviceA, "__Host-aegyo_device"))?.value === guestCookie.value,
    "Security revocation changed guest identity",
  );
  const guestAfter = await deviceA.request.post(`${arcade}/api/session`, {
    headers: { origin: arcade },
    data: { locale: "en" },
  });
  assert.ok(
    guestAfter.ok() && (await guestAfter.json()).handle === guestBefore.handle,
    "Guest history owner changed",
  );
  passed(
    "old Arcade membership expires after reset while its guest identity survives",
  );
  report.passed = true;
} catch {
  report.passed = false;
  report.failedPhase = phase;
  console.error(
    `Staging browser proof failed during ${phase}; no tokens or credentials printed.`,
  );
  process.exitCode = 1;
} finally {
  await database?.end();
  await browser?.close();
  report.finishedAt = new Date().toISOString();
  await writeFile(
    new URL("staging-browser-result.json", proofRoot),
    JSON.stringify(report, null, 2) + "\n",
    { mode: 0o600 },
  );
}
