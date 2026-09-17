#!/usr/bin/env node
/**
 * HTTP-only member proof for an isolated synthetic Railway staging round.
 * Operator lifecycle steps remain in scripts/competition/operator.ts.
 */
import assert from "node:assert/strict";
import { randomUUID } from "node:crypto";
import fs from "node:fs/promises";
import {
  CompetitionTraceCapture,
  COMPETITION_STEP_MS,
} from "../../src/competition/replay.ts";
import { seededRandom } from "../../src/shell/rng.ts";
import {
  continueFromLevelBreak,
  createSnakeState,
  queueDirection,
  step,
  tickMs,
} from "../../src/games/snake/logic.ts";

assert.equal(
  process.env.ARCADE_COMPETITION_STAGING_CONFIRM,
  "synthetic-staging-only",
);
const mode = process.argv[2];
assert(["play", "claim"].includes(mode), "mode must be play or claim");
const roundSlug = process.env.ARCADE_COMPETITION_STAGING_ROUND;
assert.match(roundSlug ?? "", /^[a-z0-9](?:[a-z0-9-]{0,62}[a-z0-9])?$/);

const accounts = "https://aegyo-accounts-accounts-staging.up.railway.app";
const arcade = "https://arcade-auth-preview-accounts-staging.up.railway.app";
const proofPath = new URL(
  "../../.auth-proof/competition-staging-lifecycle-report.json",
  import.meta.url,
);
const proofRoot = new URL("../../services/accounts/.proof/", import.meta.url);
const [infra, fixtureFile] = await Promise.all([
  fs
    .readFile(new URL("railway-staging.json", proofRoot), "utf8")
    .then(JSON.parse),
  fs
    .readFile(new URL("cross-app-fixture.json", proofRoot), "utf8")
    .then(JSON.parse),
]);
assert.equal(infra.projectId, "8229f87c-908d-426d-9562-4b01b0e89a50");
assert.equal(infra.environmentId, "279e0a09-8ba3-42dc-8d44-a2598d1f3fe9");
assert.equal(infra.databaseServiceId, "950e29c3-1592-4b09-be95-572ce43030c5");
assert.equal(infra.baseURL, accounts);
const fixture = fixtureFile.new;
assert(fixture.email.endsWith("@example.invalid"));
assert.equal(typeof fixture.password, "string");

class CookieJar {
  cookies = [];
  receive(response, requestUrl) {
    for (const line of response.headers.getSetCookie()) {
      const parts = line.split(";").map((part) => part.trim());
      const [name, ...rawValue] = parts[0].split("=");
      const attrs = Object.fromEntries(
        parts.slice(1).map((part) => {
          const [key, ...value] = part.split("=");
          return [key.toLowerCase(), value.join("=") || true];
        }),
      );
      const cookie = {
        name,
        value: rawValue.join("="),
        domain: String(attrs.domain ?? new URL(requestUrl).hostname).replace(
          /^\./,
          "",
        ),
        path: String(attrs.path ?? "/"),
        secure: Boolean(attrs.secure),
      };
      this.cookies = this.cookies.filter(
        (item) =>
          !(
            item.name === cookie.name &&
            item.domain === cookie.domain &&
            item.path === cookie.path
          ),
      );
      if (attrs["max-age"] !== "0") this.cookies.push(cookie);
    }
  }
  header(url) {
    const parsed = new URL(url);
    return this.cookies
      .filter(
        (cookie) =>
          (parsed.hostname === cookie.domain ||
            parsed.hostname.endsWith(`.${cookie.domain}`)) &&
          parsed.pathname.startsWith(cookie.path) &&
          (!cookie.secure || parsed.protocol === "https:"),
      )
      .map((cookie) => `${cookie.name}=${cookie.value}`)
      .join("; ");
  }
}

const jar = new CookieJar();
async function request(url, init = {}) {
  const headers = new Headers(init.headers);
  const cookie = jar.header(url);
  if (cookie) headers.set("cookie", cookie);
  const response = await fetch(url, { ...init, headers, redirect: "manual" });
  jar.receive(response, url);
  return response;
}
async function jsonRequest(url, init = {}) {
  const response = await request(url, init);
  const body = await response.json();
  return { response, body };
}
async function authenticate() {
  let url = `${arcade}/api/accounts/login?returnTo=${encodeURIComponent(`/championship?round=${roundSlug}`)}`;
  for (let step = 0; step < 8; step++) {
    const response = await request(url);
    if (response.status >= 300 && response.status < 400) {
      url = new URL(response.headers.get("location"), url).href;
      continue;
    }
    if (new URL(url).pathname === "/sign-in") break;
    const body = await response.json();
    assert.equal(body.redirect, true);
    url = new URL(body.url, url).href;
  }
  const signIn = new URL(url);
  assert.equal(signIn.origin, accounts);
  assert.equal(signIn.pathname, "/sign-in");
  const login = await jsonRequest(`${accounts}/api/auth/sign-in/email`, {
    method: "POST",
    headers: { "content-type": "application/json", origin: accounts },
    body: JSON.stringify({
      email: fixture.email,
      password: fixture.password,
      callbackURL: `${accounts}/account`,
      oauth_query: signIn.searchParams.toString(),
    }),
  });
  assert.equal(login.response.status, 200);
  url = login.body.url;
  for (let step = 0; step < 4; step++) {
    const response = await request(url);
    if (!(response.status >= 300 && response.status < 400)) break;
    url = new URL(response.headers.get("location"), url).href;
  }
  assert.equal((await request(`${arcade}/api/accounts/session`)).status, 200);
}
const mutation = (body) => ({
  method: "POST",
  headers: { "content-type": "application/json", origin: arcade },
  body: JSON.stringify(body),
});
const directionAction = (direction) =>
  direction.y < 0
    ? "snake:up"
    : direction.y > 0
      ? "snake:down"
      : direction.x < 0
        ? "snake:left"
        : "snake:right";
function pathToFood(state) {
  const start = state.snake[0];
  const queue = [{ cell: start, first: null }];
  const seen = new Set([`${start.x},${start.y}`]);
  const occupied = new Set(state.snake.map((cell) => `${cell.x},${cell.y}`));
  const directions = [
    { x: 1, y: 0 },
    { x: 0, y: 1 },
    { x: -1, y: 0 },
    { x: 0, y: -1 },
  ];
  while (queue.length) {
    const current = queue.shift();
    for (const direction of directions) {
      if (
        !current.first &&
        direction.x === -state.dir.x &&
        direction.y === -state.dir.y
      )
        continue;
      const next = {
        x: current.cell.x + direction.x,
        y: current.cell.y + direction.y,
      };
      const key = `${next.x},${next.y}`;
      if (
        next.x < 0 ||
        next.y < 0 ||
        next.x >= 13 ||
        next.y >= 13 ||
        seen.has(key) ||
        occupied.has(key)
      )
        continue;
      const first = current.first ?? direction;
      if (next.x === state.food.x && next.y === state.food.y) return first;
      seen.add(key);
      queue.push({ cell: next, first });
    }
  }
  return null;
}
function snakeTrace(seed, targetScore) {
  const rng = seededRandom(seed);
  const state = createSnakeState(rng);
  const capture = new CompetitionTraceCapture("snake", seed);
  let armed = false;
  for (let frame = 0; frame < 54_000 && state.status !== "lost"; frame++) {
    if (state.status === "levelBreak") {
      capture.record("snake:continue");
      continueFromLevelBreak(state, rng);
    }
    if (
      state.score < targetScore &&
      state.status === "playing" &&
      (!armed || state.tickAccumulatorMs + COMPETITION_STEP_MS >= tickMs(state))
    ) {
      const direction = pathToFood(state);
      if (direction && queueDirection(state, direction)) {
        capture.record(directionAction(direction));
        armed = true;
      }
    }
    if (armed) step(state, COMPETITION_STEP_MS, rng);
    capture.advanceTick();
  }
  assert.equal(state.status, "lost");
  assert(state.score > 0);
  return { trace: capture.finish("lost", "lost"), score: state.score };
}

await authenticate();
const publicState = await jsonRequest(
  `${arcade}/api/competition?round=${roundSlug}`,
);
assert.equal(publicState.response.status, 200);
assert.equal(publicState.body.round.mode, "synthetic");
const roundId = publicState.body.round.id;

if (mode === "play") {
  const meBefore = await jsonRequest(
    `${arcade}/api/competition/me?roundId=${roundId}`,
  );
  assert.equal(meBefore.response.status, 200);
  assert.equal(meBefore.body.emailVerified, true);
  if (!meBefore.body.enrolled) {
    const enrolled = await jsonRequest(
      `${arcade}/api/competition/enroll`,
      mutation({
        roundId,
        acceptedRulesDigest: publicState.body.round.rulesDigest,
      }),
    );
    assert.equal(enrolled.response.status, 200);
  }
  const issue = async (key) =>
    jsonRequest(
      `${arcade}/api/competition/attempts`,
      mutation({ roundId, gameId: "snake", idempotencyKey: key }),
    );
  const key1 = `staging-low-${randomUUID()}`;
  const first = await issue(key1);
  assert.equal(first.response.status, 200);
  const reissue = await issue(key1);
  assert.equal(reissue.response.status, 200);
  assert.equal(reissue.body.attemptId, first.body.attemptId);
  assert.equal(reissue.body.reissued, true);
  const candidates = [10, 20, 30, 40, 50, 60, 70, 80, 90].map((target) =>
    snakeTrace(first.body.seed, target),
  );
  const low = candidates[0];
  const high = candidates.find((candidate) => candidate.score > low.score);
  assert(high, "seed did not produce two distinct positive Snake scores");
  const submit = async (attemptId, trace) =>
    jsonRequest(`${arcade}/api/competition/attempts/${attemptId}`, {
      method: "PUT",
      headers: { "content-type": "application/json", origin: arcade },
      body: JSON.stringify({ trace }),
    });
  const waitForPlausibleDuration = async (trace, issuedAtMs) => {
    const traceDurationMs = (trace.terminal.tick * 1000) / trace.tickRate;
    const remainingMs = traceDurationMs - (Date.now() - issuedAtMs) + 250;
    if (remainingMs > 0)
      await new Promise((resolve) => setTimeout(resolve, remainingMs));
  };
  const firstIssuedAtMs = Date.now();
  await waitForPlausibleDuration(low.trace, firstIssuedAtMs);
  const lowResult = await submit(first.body.attemptId, low.trace);
  assert.equal(lowResult.response.status, 200);
  assert.equal(lowResult.body.status, "verified");
  assert.equal(lowResult.body.score, low.score);
  assert(lowResult.body.points > 0);
  const lowRetry = await submit(first.body.attemptId, low.trace);
  assert.equal(lowRetry.response.status, 200);
  assert.equal(lowRetry.body.points, lowResult.body.points);
  const second = await issue(`staging-high-${randomUUID()}`);
  assert.equal(second.response.status, 200);
  assert.equal(second.body.seed, first.body.seed);
  const secondIssuedAtMs = Date.now();
  await waitForPlausibleDuration(high.trace, secondIssuedAtMs);
  const highResult = await submit(second.body.attemptId, high.trace);
  assert.equal(highResult.response.status, 200);
  assert.equal(highResult.body.score, high.score);
  assert(highResult.body.points > lowResult.body.points);
  const after = await jsonRequest(
    `${arcade}/api/competition?round=${roundSlug}`,
  );
  const username = meBefore.body.username;
  const standing = after.body.standings.find(
    (row) => row.username === username,
  );
  assert.equal(standing.totalPoints, highResult.body.points);
  assert.equal(standing.maxDailyPoints, highResult.body.points);
  assert(
    after.body.gameHighScores.some(
      (row) =>
        row.username === username &&
        row.gameId === "snake" &&
        row.score === high.score,
    ),
  );
  const report = {
    scope:
      "isolated synthetic accounts-staging round; real Accounts OIDC; no material awards",
    projectId: "8229f87c-908d-426d-9562-4b01b0e89a50",
    environmentId: "279e0a09-8ba3-42dc-8d44-a2598d1f3fe9",
    roundId,
    roundSlug,
    play: {
      low: {
        attemptId: first.body.attemptId,
        score: lowResult.body.score,
        points: lowResult.body.points,
      },
      high: {
        attemptId: second.body.attemptId,
        score: highResult.body.score,
        points: highResult.body.points,
      },
      exactIssueRetry: true,
      exactSubmissionRetry: true,
      dailyBestReplacedWithoutSumming: true,
      publicPositiveStanding: true,
      publicHighScore: true,
    },
    mail: "not invoked",
    privy: "not invoked",
  };
  await fs.writeFile(proofPath, `${JSON.stringify(report, null, 2)}\n`, {
    mode: 0o600,
  });
  await fs.chmod(proofPath, 0o600);
  console.log(
    JSON.stringify({
      passed: true,
      phase: "play",
      roundId,
      lowScore: low.score,
      highScore: high.score,
    }),
  );
} else {
  const prior = JSON.parse(await fs.readFile(proofPath, "utf8"));
  assert.equal(prior.roundId, roundId);
  const me = await jsonRequest(
    `${arcade}/api/competition/me?roundId=${roundId}`,
  );
  assert.equal(me.response.status, 200);
  assert.equal(me.body.awards.length, 1);
  const award = me.body.awards[0];
  assert.equal(award.status, "unclaimed");
  const idempotencyKey = `staging-claim-${randomUUID()}`;
  const claim = () =>
    jsonRequest(
      `${arcade}/api/competition/awards/${award.id}/claim`,
      mutation({ acceptedInstructions: true, idempotencyKey }),
    );
  const first = await claim();
  assert.equal(first.response.status, 200);
  assert.deepEqual(first.body, { status: "claimed", repeated: false });
  const retry = await claim();
  assert.equal(retry.response.status, 200);
  assert.deepEqual(retry.body, { status: "claimed", repeated: true });
  prior.claim = { awardId: award.id, exactRetry: true, status: "claimed" };
  await fs.writeFile(proofPath, `${JSON.stringify(prior, null, 2)}\n`, {
    mode: 0o600,
  });
  console.log(
    JSON.stringify({ passed: true, phase: "claim", awardId: award.id }),
  );
}
