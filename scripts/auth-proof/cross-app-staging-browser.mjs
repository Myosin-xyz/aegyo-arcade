// Synthetic-only browser acceptance against the four isolated Railway origins.
// Resets only the named @example.invalid fixture; never sends a real email.
import "../../services/accounts/scripts/check-runtime.mjs";
import fs from "node:fs/promises";
import assert from "node:assert/strict";
import { randomBytes } from "node:crypto";
import { chromium } from "@playwright/test";
import pg from "pg";
import { databaseOptions } from "../../services/accounts/src/database-options.mjs";
import { createAccountsProvider } from "../../services/accounts/src/provider-core.mjs";

assert.equal(process.env.ACCOUNTS_CROSS_APP_CONFIRM, "synthetic-staging-only");
const root = new URL("../../services/accounts/.proof/", import.meta.url);
const read = async (name) =>
  JSON.parse(await fs.readFile(new URL(name, root), "utf8"));
const infra = await read("railway-staging.json");
const proxy = await read("preview-proxy.json");
const seed = await read("staging-seed.json");
const fixture = await read("cross-app-fixture.json");
const accounts = "https://aegyo-accounts-accounts-staging.up.railway.app";
const arcade = "https://arcade-auth-preview-accounts-staging.up.railway.app";
const aegyo = "https://aegyo-auth-preview-accounts-staging.up.railway.app";
const daebak = "https://daebak-auth-preview-accounts-staging.up.railway.app";
assert.equal(infra.projectId, "8229f87c-908d-426d-9562-4b01b0e89a50");
assert.equal(infra.environmentId, "279e0a09-8ba3-42dc-8d44-a2598d1f3fe9");
assert.equal(proxy.environmentId, infra.environmentId);
assert.equal(proxy.serviceId, "950e29c3-1592-4b09-be95-572ce43030c5");
assert.equal(seed.baseURL, accounts);
assert.equal(infra.baseURL, accounts);
assert.equal(fixture.issuer, accounts + "/api/auth");
assert(seed.member.email.endsWith("@example.invalid"));
assert(fixture.new.email.endsWith("@example.invalid"));
const pools = [];
const pool = (database, runtime = false) => {
  const url = new URL(infra.DATABASE_URL);
  url.hostname = proxy.domain;
  url.port = String(proxy.proxyPort);
  url.pathname = "/" + database;
  url.search = "";
  if (runtime) {
    url.username = infra.appRole;
    url.password = infra.appPassword;
  }
  const p = new pg.Pool({
    ...databaseOptions(url.href, {
      caCertificate: infra.databaseCA,
      serverSHA256: infra.databaseServerSHA256,
    }),
    max: 1,
    connectionTimeoutMillis: 10000,
  });
  pools.push(p);
  return p;
};
const report = {
  startedAt: new Date().toISOString(),
  origins: [accounts, aegyo, arcade, daebak],
  checks: [],
  mail: "local recorder; no delivery proof",
  privy: "no Privy authentication, wallets or grants requested",
};
const pass = (name) => {
  report.checks.push(name);
  console.log("PASS " + name);
};
let phase = "launch";
let browser;
try {
  const aegyoDB = pool("aegyo_auth_staging"),
    daebakDB = pool("daebak_auth_staging");
  const existingRow = async () =>
    (
      await aegyoDB.query(
        'SELECT id,email,"displayName",role,"passwordHash" FROM public."User" WHERE id=$1',
        [fixture.existing.localUserId],
      )
    ).rows[0];
  const before = await existingRow();
  assert(before);
  assert.equal(before.role, "moderator");
  const daebakCounts = async () =>
    (
      await daebakDB.query(
        "SELECT (SELECT count(*)::int FROM users) AS users,(SELECT count(*)::int FROM shared_identity_bindings) AS bindings,(SELECT count(*)::int FROM daebuks_grants) AS grants",
      )
    ).rows[0];
  const daebakBefore = await daebakCounts();
  assert.deepEqual(daebakBefore, { users: 0, bindings: 0, grants: 0 });
  browser = await chromium.launch({ headless: true });
  const context = await browser.newContext({
    viewport: { width: 1280, height: 900 },
  });
  const page = await context.newPage();
  page.setDefaultTimeout(30000);
  const fillLogin = async (p, member) => {
    await p.getByLabel("Email address", { exact: true }).fill(member.email);
    await p.getByLabel("Password", { exact: true }).fill(member.password);
    await p.getByRole("button", { name: "Sign in", exact: true }).click();
  };
  const productState = async (ctx, origin, path) => {
    const r = await ctx.request.get(origin + path);
    return { status: r.status(), body: await r.json() };
  };
  phase = "guest-preservation";
  await page.goto(arcade + "/");
  const guest = await context.request.post(arcade + "/api/session", {
    headers: { origin: arcade },
    data: { locale: "en" },
  });
  assert(guest.ok());
  const guestCookie = (await context.cookies(arcade)).find(
    (c) => c.name === "__Host-aegyo_device",
  );
  assert(guestCookie);
  await page.goto(arcade + "/api/accounts/login");
  await page.waitForURL(
    (u) => u.origin === accounts && u.pathname === "/sign-in",
  );
  await fillLogin(page, seed.member);
  await page.waitForURL(arcade + "/");
  assert.equal(
    (await productState(context, arcade, "/api/accounts/session")).status,
    200,
  );
  assert.equal(
    (await context.cookies(arcade)).find(
      (c) => c.name === "__Host-aegyo_device",
    )?.value,
    guestCookie.value,
  );
  pass("Arcade login preserves the same guest device cookie");
  phase = "aegyo-mapped-login";
  await page.goto(aegyo + "/api/auth/shared/login");
  await page.waitForURL(aegyo + "/");
  const existing = await productState(
    context,
    aegyo,
    "/api/auth/shared/session",
  );
  assert.equal(existing.status, 200);
  assert.equal(existing.body.user.id, fixture.existing.localUserId);
  assert.equal(existing.body.user.displayName, fixture.existing.displayName);
  assert.deepEqual(await existingRow(), before);
  await page.goto(aegyo + "/admin");
  await page
    .getByRole("heading", { name: "Content moderation & roles", exact: true })
    .waitFor();
  assert.match(await page.locator("main").innerText(), /role Moderator/);
  await page.screenshot({
    path: new URL("cross-app-aegyo-moderator.png", root).pathname,
  });
  pass(
    "Aegyo reuses provider SSO and preserves existing local ID, profile, password sentinel and moderator role",
  );
  phase = "daebak-central-login";
  const empty = await productState(context, daebak, "/api/accounts/session");
  assert.equal(empty.status, 200);
  assert.equal(empty.body.authenticated, false);
  await page.goto(daebak + "/api/accounts/login?returnTo=%2Faccount-link");
  await page.waitForURL(daebak + "/account-link");
  const central = await productState(context, daebak, "/api/accounts/session");
  assert.equal(central.status, 200);
  assert.deepEqual(central.body, { authenticated: true });
  await page.getByText("Sign in to Daebak first", { exact: true }).waitFor();
  assert.equal(
    await page
      .getByRole("button", { name: "Link accounts", exact: true })
      .count(),
    0,
  );
  const daebakCookie = (await context.cookies(daebak)).find(
    (c) => c.name === "__Host-daebak-accounts-session",
  );
  assert(
    daebakCookie?.httpOnly &&
      daebakCookie.secure &&
      daebakCookie.sameSite === "Lax",
  );
  assert.deepEqual(await daebakCounts(), daebakBefore);
  await page.screenshot({
    path: new URL("cross-app-daebak-link-required.png", root).pathname,
  });
  pass(
    "Daebak accepts Accounts SSO while requiring separate Privy ownership; zero users, wallets, grants or bindings created",
  );
  phase = "product-logout";
  const out = await context.request.post(daebak + "/api/accounts/logout", {
    headers: { origin: daebak },
    maxRedirects: 0,
  });
  assert.equal(out.status(), 303);
  assert.equal(
    (await productState(context, daebak, "/api/accounts/session")).body
      .authenticated,
    false,
  );
  await page.goto(daebak + "/api/accounts/login?returnTo=%2Faccount-link");
  await page.waitForURL(daebak + "/account-link");
  assert.equal(
    (await productState(context, daebak, "/api/accounts/session")).body
      .authenticated,
    true,
  );
  pass(
    "Daebak local logout clears its session and subsequent sign-in reuses provider SSO",
  );
  phase = "new-verified-aegyo-user";
  const newContext = await browser.newContext({
    viewport: { width: 390, height: 844 },
  });
  const np = await newContext.newPage();
  np.setDefaultTimeout(30000);
  await np.goto(aegyo + "/api/auth/shared/login");
  await np.waitForURL(
    (u) => u.origin === accounts && u.pathname === "/sign-in",
  );
  assert(
    await np.evaluate(() => document.documentElement.scrollWidth <= innerWidth),
  );
  await fillLogin(np, fixture.new);
  await np.waitForURL(aegyo + "/");
  const newState = await productState(
    newContext,
    aegyo,
    "/api/auth/shared/session",
  );
  assert.equal(newState.status, 200);
  assert.notEqual(newState.body.user.id, fixture.existing.localUserId);
  assert.notEqual(newState.body.user.id, fixture.new.subject);
  const newRows = (
    await aegyoDB.query(
      'SELECT u.id,u."emailVerified",u."passwordHash",i.issuer,i.subject FROM public."User" u JOIN public."SharedAuthIdentity" i ON i."userId"=u.id WHERE i.issuer=$1 AND i.subject=$2',
      [fixture.issuer, fixture.new.subject],
    )
  ).rows;
  assert.equal(newRows.length, 1);
  assert.equal(newRows[0].emailVerified, true);
  assert.equal(newRows[0].passwordHash, "!shared-auth-only!");
  await np.goto(aegyo + "/api/auth/shared/login");
  await np.waitForURL(aegyo + "/");
  assert.equal(
    (await productState(newContext, aegyo, "/api/auth/shared/session")).body
      .user.id,
    newState.body.user.id,
  );
  assert.deepEqual(await existingRow(), before);
  pass(
    "A fresh mobile user receives exactly one verified Aegyo user/mapping; repeat sign-in preserves that ID",
  );
  phase = "second-device-before-reset";
  const second = await browser.newContext();
  const sp = await second.newPage();
  sp.setDefaultTimeout(30000);
  await sp.goto(arcade + "/api/accounts/login");
  await sp.waitForURL(
    (u) => u.origin === accounts && u.pathname === "/sign-in",
  );
  await fillLogin(sp, seed.member);
  await sp.waitForURL(arcade + "/");
  const oldProviderCookies = await second.cookies(accounts);
  assert(
    oldProviderCookies.some(
      (cookie) =>
        cookie.name === "__Secure-better-auth.session_token" &&
        cookie.httpOnly &&
        cookie.secure,
    ),
  );
  phase = "synthetic-recovery";
  const recorder = [];
  const { auth } = createAccountsProvider({
    database: pool("railway", true),
    baseURL: accounts,
    secret: infra.secret,
    legacyPepper: infra.legacyPepper,
    mail: async (kind, message) => {
      if (kind === "reset") recorder.push(message);
    },
  });
  await auth.api.requestPasswordReset({
    body: {
      email: seed.member.email,
      redirectTo: accounts + "/reset-password",
    },
    headers: new Headers({
      origin: accounts,
      "x-aegyo-client-ip": "192.0.2.95",
    }),
  });
  assert.equal(recorder.length, 1);
  await page.goto(recorder[0].url);
  const password = randomBytes(30).toString("base64url");
  const recoveryPath = new URL("cross-app-pending-recovery.json", root);
  await fs.writeFile(
    recoveryPath,
    JSON.stringify({
      environment: "staging",
      email: seed.member.email,
      password,
      createdAt: new Date().toISOString(),
    }),
    { flag: "wx", mode: 0o600 },
  );
  await page.getByLabel("New password", { exact: true }).fill(password);
  await page.getByLabel("Confirm new password", { exact: true }).fill(password);
  await page
    .getByRole("button", { name: "Save new password", exact: true })
    .click();
  await page.waitForURL(accounts + "/reset-password?status=success");
  const resetCompletedAt = Date.now();
  seed.member.password = password;
  await fs.writeFile(
    new URL("staging-seed.next.json", root),
    JSON.stringify(seed, null, 2) + "\n",
    { mode: 0o600 },
  );
  await fs.rename(
    new URL("staging-seed.next.json", root),
    new URL("staging-seed.json", root),
  );
  pass("Synthetic password recovery succeeds through the deployed Accounts UI");
  phase = "retained-product-session-revocation";
  const deadline = resetCompletedAt + 40000;
  let states;
  do {
    states = await Promise.all([
      productState(context, arcade, "/api/accounts/session"),
      productState(context, aegyo, "/api/auth/shared/session"),
      productState(context, daebak, "/api/accounts/session"),
    ]);
    if (
      states[0].status === 401 &&
      states[1].status === 401 &&
      states[2].status === 200 &&
      states[2].body.authenticated === false
    )
      break;
    await new Promise((r) => setTimeout(r, 1000));
  } while (Date.now() < deadline);
  assert.equal(states[0].status, 401);
  assert.equal(states[1].status, 401);
  assert.equal(states[2].status, 200);
  assert.deepEqual(states[0].body, { authenticated: false });
  assert.deepEqual(states[1].body, { authenticated: false });
  assert.deepEqual(states[2].body, { authenticated: false });
  report.revocationObservedMs = Date.now() - resetCompletedAt;
  assert(
    report.revocationObservedMs <= 40000,
    "Revocation exceeded 30-second cache plus 10-second network margin",
  );
  pass(
    "All three retained product sessions stop authorizing after password reset within the state-cache bound",
  );
  phase = "stale-provider-cookie-after-reset";
  for (const [origin, login] of [
    [arcade, "/api/accounts/login"],
    [aegyo, "/api/auth/shared/login"],
    [daebak, "/api/accounts/login?returnTo=%2Faccount-link"],
  ]) {
    const stale = await browser.newContext();
    await stale.addCookies(oldProviderCookies);
    const productCookie =
      origin === aegyo
        ? "session"
        : origin === arcade
          ? "__Host-aegyo_member"
          : "__Host-daebak-accounts-session";
    assert(
      !(await stale.cookies(origin)).some(
        (cookie) => cookie.name === productCookie,
      ),
    );
    const p = await stale.newPage();
    p.setDefaultTimeout(30000);
    await p.goto(origin + login);
    await p.waitForURL(
      (u) => u.origin === accounts && u.pathname === "/sign-in",
    );
    assert(
      !(await stale.cookies(origin)).some(
        (cookie) => cookie.name === productCookie,
      ),
    );
    pass(
      new URL(origin).hostname.split("-auth-preview")[0] +
        " rejects stale provider cookies after reset with no product cookies",
    );
    await stale.close();
  }
  phase = "fresh-login-after-reset";
  const fresh = await browser.newContext();
  const fp = await fresh.newPage();
  fp.setDefaultTimeout(30000);
  await fp.goto(arcade + "/api/accounts/login");
  await fp.waitForURL(
    (u) => u.origin === accounts && u.pathname === "/sign-in",
  );
  await fillLogin(fp, seed.member);
  await fp.waitForURL(arcade + "/");
  assert.equal(
    (await productState(fresh, arcade, "/api/accounts/session")).status,
    200,
  );
  await fs.unlink(recoveryPath);
  pass("The persisted new password signs in successfully from a fresh browser");
  assert.deepEqual(await existingRow(), before);
  assert.deepEqual(await daebakCounts(), daebakBefore);
  report.completedAt = new Date().toISOString();
  report.passed = true;
} catch (error) {
  report.passed = false;
  report.phase = phase;
  report.failure =
    error instanceof assert.AssertionError ? "assertion_failed" : error.name;
  console.error(JSON.stringify({ failed: true, phase, error: report.failure }));
  process.exitCode = 1;
} finally {
  await browser?.close();
  for (const p of pools) await p.end();
  await fs.writeFile(
    new URL("cross-app-browser-report.json", root),
    JSON.stringify(report, null, 2) + "\n",
    { mode: 0o600 },
  );
}
