// Synthetic-only current-session logout acceptance across isolated staging origins.
// Uses only the named @example.invalid fixture; never invokes email or Privy.
import "../../services/accounts/scripts/check-runtime.mjs";
import assert from "node:assert/strict";
import fs from "node:fs/promises";
import { chromium } from "@playwright/test";

assert.equal(
  process.env.ACCOUNTS_LOGOUT_PROOF_CONFIRM,
  "synthetic-staging-only",
);

const proofRoot = new URL("../../services/accounts/.proof/", import.meta.url);
const seed = JSON.parse(
  await fs.readFile(new URL("staging-seed.json", proofRoot), "utf8"),
);
const accounts = "https://aegyo-accounts-accounts-staging.up.railway.app";
const arcade = "https://arcade-auth-preview-accounts-staging.up.railway.app";
const aegyo = "https://aegyo-auth-preview-accounts-staging.up.railway.app";
const daebak = "https://daebak-auth-preview-accounts-staging.up.railway.app";
assert.equal(seed.baseURL, accounts);
assert.equal(typeof seed.member?.email, "string");
assert(seed.member.email.endsWith("@example.invalid"));
assert.equal(typeof seed.member?.password, "string");
assert(seed.member.password.length >= 12);

const providerCookieName = "__Secure-better-auth.session_token";
const products = [
  {
    name: "Arcade",
    origin: arcade,
    login: "/api/accounts/login",
    session: "/api/accounts/session",
    cookie: "__Host-aegyo_member",
    invalidStatus: 401,
  },
  {
    name: "Aegyo",
    origin: aegyo,
    login: "/api/auth/shared/login",
    session: "/api/auth/shared/session",
    cookie: "session",
    invalidStatus: 401,
  },
  {
    name: "Daebak",
    origin: daebak,
    login: "/api/accounts/login?returnTo=%2Faccount-link",
    session: "/api/accounts/session",
    cookie: "__Host-daebak-accounts-session",
    invalidStatus: 200,
  },
];
const report = {
  startedAt: new Date().toISOString(),
  fixture: "synthetic @example.invalid member",
  origins: [accounts, arcade, aegyo, daebak],
  checks: [],
  mail: "not invoked",
  privy: "not invoked",
};
const pass = (check) => {
  report.checks.push(check);
  console.log(`PASS ${check}`);
};
const safeState = async (context, product) => {
  const response = await context.request.get(product.origin + product.session, {
    timeout: 5000,
  });
  return { status: response.status(), body: await response.json() };
};
const assertActive = async (context, product) => {
  const state = await safeState(context, product);
  assert.equal(state.status, 200);
  if (product.name === "Daebak")
    assert.deepEqual(state.body, { authenticated: true });
  else assert.equal(state.body.authenticated, true);
};
const assertInactive = (state, product) => {
  assert.equal(state.status, product.invalidStatus);
  assert.deepEqual(state.body, { authenticated: false });
};
const fillLogin = async (page) => {
  await page
    .getByLabel("Email address", { exact: true })
    .fill(seed.member.email);
  await page.getByLabel("Password", { exact: true }).fill(seed.member.password);
  await page.getByRole("button", { name: "Sign in", exact: true }).click();
};

let browser;
let phase = "launch";
try {
  browser = await chromium.launch({ headless: true });
  const context = await browser.newContext({
    viewport: { width: 1280, height: 900 },
  });
  const page = await context.newPage();
  page.setDefaultTimeout(30000);

  phase = "arcade-interactive-login";
  await page.goto(arcade + "/");
  const guestResponse = await context.request.post(arcade + "/api/session", {
    headers: { origin: arcade },
    data: { locale: "en" },
  });
  assert.equal(guestResponse.status(), 200);
  const guestCookie = (await context.cookies(arcade)).find(
    (cookie) => cookie.name === "__Host-aegyo_device",
  );
  assert(guestCookie);
  await page.goto(arcade + "/api/accounts/login");
  await page.waitForURL(
    (url) => url.origin === accounts && url.pathname === "/sign-in",
  );
  await fillLogin(page);
  await page.waitForURL(arcade + "/");
  await assertActive(context, products[0]);

  phase = "arcade-local-logout";
  const arcadeLogout = await context.request.post(
    arcade + "/api/accounts/logout",
    { headers: { origin: arcade }, maxRedirects: 0 },
  );
  assert.equal(arcadeLogout.status(), 200);
  assertInactive(await safeState(context, products[0]), products[0]);
  assert.equal(
    (await context.cookies(arcade)).find(
      (cookie) => cookie.name === guestCookie.name,
    )?.value,
    guestCookie.value,
  );
  await page.goto(arcade + "/api/accounts/login");
  await page.waitForURL(arcade + "/");
  await assertActive(context, products[0]);
  pass(
    "Arcade local logout clears only its member session, preserves its guest identity and provider SSO restores it",
  );

  phase = "aegyo-local-logout";
  await page.goto(aegyo + "/api/auth/shared/login");
  await page.waitForURL(aegyo + "/");
  await assertActive(context, products[1]);
  const localLogout = await context.request.post(aegyo + "/api/auth/logout", {
    headers: { origin: aegyo },
    maxRedirects: 0,
  });
  assert.equal(localLogout.status(), 200);
  assertInactive(await safeState(context, products[1]), products[1]);
  assert(
    !(await context.cookies(aegyo)).some(
      (cookie) => cookie.name === products[1].cookie,
    ),
  );
  await page.goto(aegyo + "/api/auth/shared/login");
  await page.waitForURL(aegyo + "/");
  await assertActive(context, products[1]);
  pass(
    "Aegyo local logout clears only its local session and provider SSO restores it",
  );

  phase = "daebak-provider-sso";
  await page.goto(daebak + products[2].login);
  await page.waitForURL(daebak + "/account-link");
  await assertActive(context, products[2]);
  await page.getByText("Sign in to Daebak first", { exact: true }).waitFor();
  phase = "daebak-local-logout";
  const daebakLogout = await context.request.post(
    daebak + "/api/accounts/logout",
    { headers: { origin: daebak }, maxRedirects: 0 },
  );
  assert.equal(daebakLogout.status(), 303);
  assertInactive(await safeState(context, products[2]), products[2]);
  await page.goto(daebak + products[2].login);
  await page.waitForURL(daebak + "/account-link");
  await assertActive(context, products[2]);
  pass(
    "Daebak local logout clears only its local session and provider SSO restores it",
  );
  for (const product of products) await assertActive(context, product);
  const providerCookiesBeforeLogout = await context.cookies(accounts);
  const providerCookie = providerCookiesBeforeLogout.find(
    (cookie) => cookie.name === providerCookieName,
  );
  assert(providerCookie?.httpOnly && providerCookie.secure);
  pass("one browser holds active Arcade, Aegyo and Daebak sessions");

  phase = "independent-provider-session";
  const other = await browser.newContext();
  const otherPage = await other.newPage();
  otherPage.setDefaultTimeout(30000);
  await otherPage.goto(arcade + "/api/accounts/login");
  await otherPage.waitForURL(
    (url) => url.origin === accounts && url.pathname === "/sign-in",
  );
  await fillLogin(otherPage);
  await otherPage.waitForURL(arcade + "/");
  assert(
    (await other.cookies(accounts)).some(
      (cookie) => cookie.name === providerCookieName,
    ),
  );

  phase = "accounts-current-session-logout";
  await page.goto(accounts + "/account");
  await page
    .getByRole("heading", { name: "You’re signed in", exact: true })
    .waitFor();
  await page.screenshot({
    path: new URL("cross-app-logout-before.png", proofRoot).pathname,
  });
  await fs.chmod(new URL("cross-app-logout-before.png", proofRoot), 0o600);
  const logoutStartedAt = Date.now();
  await page.getByRole("button", { name: "Sign out", exact: true }).click();
  await page.waitForURL(accounts + "/sign-in");
  assert(
    !(await context.cookies(accounts)).some(
      (cookie) => cookie.name === providerCookieName,
    ),
  );

  phase = "retained-product-session-invalidation";
  const deadline = logoutStartedAt + 40000;
  let states;
  do {
    try {
      states = await Promise.all(
        products.map((product) => safeState(context, product)),
      );
      products.forEach((product, index) =>
        assertInactive(states[index], product),
      );
      break;
    } catch {
      if (Date.now() >= deadline)
        throw new Error("logout_invalidation_timeout");
    }
    await new Promise((resolve) => setTimeout(resolve, 1000));
  } while (Date.now() < deadline);
  products.forEach((product, index) => assertInactive(states[index], product));
  report.invalidationObservedMs = Date.now() - logoutStartedAt;
  assert(report.invalidationObservedMs <= 40000);
  assert.equal(
    (await context.cookies(arcade)).find(
      (cookie) => cookie.name === guestCookie.name,
    )?.value,
    guestCookie.value,
  );
  pass(
    "provider logout invalidates all retained product sessions within the cache bound and preserves the Arcade guest cookie",
  );

  phase = "stale-provider-cookie-rejection";
  for (const product of products) {
    const stale = await browser.newContext();
    await stale.addCookies(providerCookiesBeforeLogout);
    assert(
      !(await stale.cookies(product.origin)).some(
        (cookie) => cookie.name === product.cookie,
      ),
    );
    const stalePage = await stale.newPage();
    stalePage.setDefaultTimeout(30000);
    await stalePage.goto(product.origin + product.login);
    await stalePage.waitForURL(
      (url) => url.origin === accounts && url.pathname === "/sign-in",
    );
    assert(
      !(await stale.cookies(product.origin)).some(
        (cookie) => cookie.name === product.cookie,
      ),
    );
    await stale.close();
  }
  pass(
    "restored pre-logout provider cookies require interactive Accounts login and mint no product session",
  );

  phase = "other-provider-session-survives";
  await otherPage.goto(accounts + "/account");
  await otherPage
    .getByRole("heading", { name: "You’re signed in", exact: true })
    .waitFor();
  assert(
    (await other.cookies(accounts)).some(
      (cookie) => cookie.name === providerCookieName,
    ),
  );
  await otherPage.screenshot({
    path: new URL("cross-app-logout-other-session.png", proofRoot).pathname,
  });
  await fs.chmod(
    new URL("cross-app-logout-other-session.png", proofRoot),
    0o600,
  );
  pass(
    "Accounts sign-out revokes the current provider session without revoking another browser session",
  );
  await other.close();

  report.completedAt = new Date().toISOString();
  report.passed = true;
} catch (error) {
  report.passed = false;
  report.phase = phase;
  report.failure =
    error instanceof assert.AssertionError
      ? "assertion_failed"
      : "proof_failed";
  console.error(JSON.stringify({ failed: true, phase, error: report.failure }));
  process.exitCode = 1;
} finally {
  await browser?.close();
  await fs.writeFile(
    new URL("cross-app-logout-report.json", proofRoot),
    JSON.stringify(report, null, 2) + "\n",
    { mode: 0o600 },
  );
  await fs.chmod(new URL("cross-app-logout-report.json", proofRoot), 0o600);
}
