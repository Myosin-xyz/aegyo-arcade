#!/usr/bin/env node
/**
 * Real shared-auth competition proof against the four isolated staging apps.
 * Uses the existing synthetic @example.invalid member and never injects an app
 * session cookie, sends email, creates an identity, or touches a wallet.
 */
import assert from "node:assert/strict";
import { createHash } from "node:crypto";
import fs from "node:fs/promises";
import { chromium } from "@playwright/test";

assert.equal(
  process.env.ARCADE_COMPETITION_STAGING_CONFIRM,
  "synthetic-staging-only",
);
const roundSlug = process.env.ARCADE_COMPETITION_STAGING_ROUND;
assert.match(roundSlug ?? "", /^[a-z0-9](?:[a-z0-9-]{0,62}[a-z0-9])?$/);
const gameId = process.env.ARCADE_COMPETITION_STAGING_GAME ?? "snake";
assert(["snake", "flappy"].includes(gameId));
const inspectOnly =
  process.env.ARCADE_COMPETITION_STAGING_INSPECT_ONLY === "true";
const expectedRemaining = inspectOnly
  ? Number(process.env.ARCADE_COMPETITION_STAGING_EXPECT_REMAINING)
  : 3;
assert(
  Number.isInteger(expectedRemaining) &&
    expectedRemaining >= 0 &&
    expectedRemaining <= 3,
);

const proofRoot = new URL("../../services/accounts/.proof/", import.meta.url);
const evidenceRoot = new URL("../../.auth-proof/", import.meta.url);
const readProof = async (name) =>
  JSON.parse(await fs.readFile(new URL(name, proofRoot), "utf8"));
const [infra, seed, fixture] = await Promise.all([
  readProof("railway-staging.json"),
  readProof("staging-seed.json"),
  readProof("cross-app-fixture.json"),
]);

const origins = Object.freeze({
  accounts: "https://aegyo-accounts-accounts-staging.up.railway.app",
  arcade: "https://arcade-auth-preview-accounts-staging.up.railway.app",
  aegyo: "https://aegyo-auth-preview-accounts-staging.up.railway.app",
  daebak: "https://daebak-auth-preview-accounts-staging.up.railway.app",
});
const allowedOrigins = new Set(Object.values(origins));
for (const origin of allowedOrigins) {
  const parsed = new URL(origin);
  assert.equal(parsed.protocol, "https:");
  assert.match(parsed.hostname, /-accounts-staging\.up\.railway\.app$/);
  assert(!parsed.hostname.includes("aegyoarena.com"));
  assert(!parsed.hostname.includes("daebakmarkets.com"));
}
assert.equal(infra.projectId, "8229f87c-908d-426d-9562-4b01b0e89a50");
assert.equal(infra.environmentId, "279e0a09-8ba3-42dc-8d44-a2598d1f3fe9");
assert.equal(infra.baseURL, origins.accounts);
assert.equal(seed.baseURL, origins.accounts);
assert.equal(fixture.issuer, origins.accounts + "/api/auth");
const member = fixture.new;
assert(member.email.endsWith("@example.invalid"));
assert.equal(typeof member.password, "string");
assert(member.password.length >= 12);
assert.equal(typeof member.subject, "string");

const report = {
  startedAt: new Date().toISOString(),
  scope: "existing synthetic staging member; real Accounts OIDC",
  origins: Object.values(origins),
  roundSlug,
  gameId,
  runMode: inspectOnly ? "inspect-existing-attempt" : "play-one-attempt",
  checks: [],
  mail: "not invoked",
  privy: "not invoked",
};
const pass = (name) => {
  report.checks.push(name);
  console.log(`PASS ${name}`);
};
const json = async (response) => ({
  status: response.status(),
  body: await response.json(),
});
const productState = (context, origin, path) =>
  context.request.get(origin + path, { timeout: 10_000 }).then(json);
const fillLogin = async (page) => {
  await page.getByLabel("Email address", { exact: true }).fill(member.email);
  await page.getByLabel("Password", { exact: true }).fill(member.password);
  await page.getByRole("button", { name: "Sign in", exact: true }).click();
};

let browser;
let phase = "launch";
try {
  browser = await chromium.launch({ headless: true });
  const context = await browser.newContext({
    viewport: { width: 1280, height: 900 },
    locale: "en-US",
  });
  const page = await context.newPage();
  page.setDefaultTimeout(30_000);
  await page.route("**/*", async (route) => {
    const request = route.request();
    const origin = new URL(request.url()).origin;
    if (allowedOrigins.has(origin)) return route.continue();
    if (request.isNavigationRequest() || request.method() !== "GET") {
      throw new Error(`unexpected active browser origin: ${origin}`);
    }
    // Third-party analytics/assets are outside this proof and receive no request.
    return route.abort("blockedbyclient");
  });

  phase = "synthetic-round-preflight";
  const roundResponse = await productState(
    context,
    origins.arcade,
    `/api/competition?round=${encodeURIComponent(roundSlug)}`,
  );
  assert.equal(roundResponse.status, 200);
  assert.equal(roundResponse.body.round?.slug, roundSlug);
  assert.equal(roundResponse.body.round?.mode, "synthetic");
  assert.equal(roundResponse.body.round?.status, "open");
  assert(
    roundResponse.body.round.rules.games.some((game) => game.gameId === gameId),
  );
  pass("allowlisted open synthetic round is available");

  phase = "guest-then-real-accounts-login";
  const guestBootstrap = page.waitForResponse(
    (response) =>
      response.url() === origins.arcade + "/api/session" &&
      response.request().method() === "POST",
  );
  await page.goto(origins.arcade + "/");
  const guestResponse = await guestBootstrap;
  assert.equal(guestResponse.status(), 200);
  const guestBefore = (await context.cookies(origins.arcade)).find(
    (cookie) => cookie.name === "__Host-aegyo_device",
  );
  assert(guestBefore?.httpOnly && guestBefore.secure);
  assert(
    !(await context.cookies(origins.arcade)).some(
      (cookie) => cookie.name === "__Host-aegyo_member",
    ),
  );
  await page.goto(origins.arcade + "/api/accounts/login?returnTo=%2Faccount");
  await page.waitForURL(
    (url) => url.origin === origins.accounts && url.pathname === "/sign-in",
  );
  await fillLogin(page);
  await page.waitForURL(origins.arcade + "/account");
  assert.equal(
    (await productState(context, origins.arcade, "/api/accounts/session")).body
      .authenticated,
    true,
  );
  const providerCookie = (await context.cookies(origins.accounts)).find(
    (cookie) => cookie.name === "__Secure-better-auth.session_token",
  );
  assert(providerCookie?.httpOnly && providerCookie.secure);
  assert.equal(
    (await context.cookies(origins.arcade)).find(
      (cookie) => cookie.name === guestBefore.name,
    )?.value,
    guestBefore.value,
  );
  pass("real Accounts login preserves the preexisting guest device");

  phase = "competition-profile";
  let profile = await productState(
    context,
    origins.arcade,
    "/api/accounts/profile",
  );
  assert.equal(profile.status, 200);
  assert.equal(profile.body.emailVerified, true);
  if (profile.body.username === null) {
    const suffix = createHash("sha256")
      .update(member.email)
      .digest("hex")
      .slice(0, 10);
    const chosen = `stg_${suffix}`;
    profile = await context.request
      .post(origins.arcade + "/api/accounts/profile", {
        headers: { origin: origins.arcade },
        data: { username: chosen },
      })
      .then(json);
    assert.equal(profile.status, 201);
    assert.equal(profile.body.username, chosen);
  }
  assert.match(profile.body.username, /^[a-z0-9_]{3,20}$/);
  pass("verified synthetic member has a stable competition username");

  phase = "enrollment-and-official-snake";
  await page.goto(
    `${origins.arcade}/championship?round=${encodeURIComponent(roundSlug)}`,
  );
  await page.getByText("Test round · no prizes", { exact: true }).waitFor();
  let memberState = await productState(
    context,
    origins.arcade,
    `/api/competition/me?roundId=${encodeURIComponent(roundResponse.body.round.id)}`,
  );
  assert.equal(memberState.status, 200);
  const remainingBefore = memberState.body.remaining[gameId];
  assert.equal(remainingBefore, expectedRemaining);
  if (!memberState.body.enrolled) {
    await page.getByRole("checkbox").check();
    const enrollmentResponse = page.waitForResponse(
      (response) =>
        response.url() === origins.arcade + "/api/competition/enroll" &&
        response.request().method() === "POST",
    );
    await page.getByRole("button", { name: "Enroll", exact: true }).click();
    const enrollment = await enrollmentResponse;
    if (!enrollment.ok()) {
      const body = await enrollment.json().catch(() => ({}));
      report.enrollmentFailure = {
        status: enrollment.status(),
        code: typeof body.code === "string" ? body.code : "unknown",
      };
    }
    assert.equal(enrollment.status(), 200);
    await page.getByText("You’re enrolled", { exact: true }).waitFor();
  }
  if (!inspectOnly) {
    await page
      .getByRole("link", {
        name: gameId === "snake" ? /Play Snake/ : /Play Flappy Bird/,
      })
      .click();
    await page.getByTestId("start-championship").click();
    await page.getByText("Championship attempt in progress").waitFor();
    if (gameId === "snake") {
      await page.keyboard.press("ArrowUp");
    } else {
      await page.keyboard.press("Escape");
      await page.keyboard.press("Enter");
    }
    await page
      .getByText(/Replay verified|did not qualify/, { exact: false })
      .waitFor({ timeout: 30_000 });
  }
  memberState = await productState(
    context,
    origins.arcade,
    `/api/competition/me?roundId=${encodeURIComponent(roundResponse.body.round.id)}`,
  );
  assert.equal(memberState.status, 200);
  assert.equal(
    memberState.body.remaining[gameId],
    inspectOnly ? remainingBefore : remainingBefore - 1,
  );
  const verifiedAttempt = memberState.body.attempts.find(
    (attempt) => attempt.gameId === gameId,
  );
  assert.equal(verifiedAttempt?.status, "verified");
  assert.equal(typeof verifiedAttempt?.score, "number");
  assert.equal(typeof verifiedAttempt?.points, "number");
  report.verifiedAttempt = {
    gameId,
    status: "verified",
    score: verifiedAttempt.score,
    points: verifiedAttempt.points,
    remainingBefore,
    remainingAfter: memberState.body.remaining[gameId],
  };
  pass(
    inspectOnly
      ? `existing official ${gameId} trace remains verified`
      : `official ${gameId} trace verifies and consumes exactly one daily quota`,
  );

  phase = "public-standings-privacy";
  const publicAfter = await productState(
    context,
    origins.arcade,
    `/api/competition?round=${encodeURIComponent(roundSlug)}`,
  );
  assert.equal(publicAfter.status, 200);
  assert(Array.isArray(publicAfter.body.standings));
  assert(Array.isArray(publicAfter.body.gameHighScores));
  for (const standing of publicAfter.body.standings) {
    assert.deepEqual(Object.keys(standing).sort(), [
      "maxDailyPoints",
      "rank",
      "totalPoints",
      "username",
    ]);
    assert.equal(typeof standing.username, "string");
  }
  for (const highScore of publicAfter.body.gameHighScores) {
    assert.deepEqual(Object.keys(highScore).sort(), [
      "gameId",
      "score",
      "username",
    ]);
  }
  assert(
    publicAfter.body.gameHighScores.some(
      (score) =>
        score.gameId === gameId && score.username === profile.body.username,
    ),
  );
  const forbiddenPublicKeys = new Set([
    "email",
    "memberId",
    "providerSessionId",
    "seed",
    "subject",
    "trace",
    "traceHash",
  ]);
  const inspectPublic = (value) => {
    if (!value || typeof value !== "object") return;
    for (const [key, child] of Object.entries(value)) {
      assert(!forbiddenPublicKeys.has(key), `private public key: ${key}`);
      inspectPublic(child);
    }
  };
  inspectPublic(publicAfter.body);
  assert(!JSON.stringify(publicAfter.body).includes("@example.invalid"));
  report.publicStandings = {
    rows: publicAfter.body.standings.length,
    fields: ["username", "rank", "totalPoints", "maxDailyPoints"],
    gameHighScoreRows: publicAfter.body.gameHighScores.length,
    gameHighScoreFields: ["gameId", "username", "score"],
  };
  pass("public standings expose usernames and scores without private identity");

  phase = "cross-product-provider-session";
  const providerCookieValue = providerCookie.value;
  await page.goto(origins.aegyo + "/api/auth/shared/login");
  await page.waitForURL(origins.aegyo + "/");
  const aegyoState = await productState(
    context,
    origins.aegyo,
    "/api/auth/shared/session",
  );
  assert.equal(aegyoState.status, 200);
  assert.equal(typeof aegyoState.body.user.id, "string");
  await page.goto(
    origins.daebak + "/api/accounts/login?returnTo=%2Faccount-link",
  );
  await page.waitForURL(origins.daebak + "/account-link");
  assert.deepEqual(
    (await productState(context, origins.daebak, "/api/accounts/session")).body,
    { authenticated: true },
  );
  await page.goto(origins.aegyo + "/api/auth/shared/login");
  await page.waitForURL(origins.aegyo + "/");
  assert.equal(
    (await productState(context, origins.aegyo, "/api/auth/shared/session"))
      .body.user.id,
    aegyoState.body.user.id,
  );
  assert.equal(
    (await context.cookies(origins.accounts)).find(
      (cookie) => cookie.name === providerCookie.name,
    )?.value,
    providerCookieValue,
  );
  pass("Aegyo and Daebak reuse the same real Accounts provider session");

  phase = "arcade-member-signout";
  await page.goto(origins.arcade + "/account");
  await page
    .getByRole("button", { name: "Sign out of this arcade", exact: true })
    .click();
  await page.waitForURL(origins.arcade + "/");
  assert.equal(
    (await context.cookies(origins.arcade)).find(
      (cookie) => cookie.name === guestBefore.name,
    )?.value,
    guestBefore.value,
  );
  assert.equal(
    (await productState(context, origins.arcade, "/api/accounts/session"))
      .status,
    401,
  );
  assert.equal(
    (await productState(context, origins.aegyo, "/api/auth/shared/session"))
      .status,
    200,
  );
  assert.deepEqual(
    (await productState(context, origins.daebak, "/api/accounts/session")).body,
    { authenticated: true },
  );
  pass("Arcade member signout preserves its guest cookie and sibling sessions");

  report.completedAt = new Date().toISOString();
  report.passed = true;
} catch (error) {
  report.passed = false;
  report.phase = phase;
  report.failure =
    error instanceof assert.AssertionError
      ? "assertion_failed"
      : "proof_failed";
  report.failureLocation = error?.stack?.match(
    /staging-browser-proof\.mjs:\d+:\d+/,
  )?.[0];
  console.error(JSON.stringify({ failed: true, phase, error: report.failure }));
  process.exitCode = 1;
} finally {
  await browser?.close();
  await fs.mkdir(evidenceRoot, { recursive: true, mode: 0o700 });
  const reportPath = new URL(
    "competition-staging-browser-report.json",
    evidenceRoot,
  );
  await fs.writeFile(reportPath, JSON.stringify(report, null, 2) + "\n", {
    mode: 0o600,
  });
  await fs.chmod(reportPath, 0o600);
}
