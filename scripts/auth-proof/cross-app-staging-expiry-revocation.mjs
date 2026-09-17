#!/usr/bin/env node
// Synthetic-only forced-expiry and all-device revocation proof on isolated staging.
import "../../services/accounts/scripts/check-runtime.mjs";
import assert from "node:assert/strict";
import { execFile } from "node:child_process";
import fs from "node:fs/promises";
import { promisify } from "node:util";
import { chromium } from "@playwright/test";

assert.equal(
  process.env.ACCOUNTS_REVOCATION_PROOF_CONFIRM,
  "reserved-synthetic-staging-only",
);
const run = promisify(execFile);
const project = "8229f87c-908d-426d-9562-4b01b0e89a50";
const environment = "279e0a09-8ba3-42dc-8d44-a2598d1f3fe9";
const postgresService = "950e29c3-1592-4b09-be95-572ce43030c5";
const proofRoot = new URL("../../services/accounts/.proof/", import.meta.url);
const read = async (name) =>
  JSON.parse(await fs.readFile(new URL(name, proofRoot), "utf8"));
const [infra, seed, fixture] = await Promise.all([
  read("railway-staging.json"),
  read("staging-seed.json"),
  read("cross-app-fixture.json"),
]);
const origins = Object.freeze({
  accounts: "https://aegyo-accounts-accounts-staging.up.railway.app",
  arcade: "https://arcade-auth-preview-accounts-staging.up.railway.app",
  aegyo: "https://aegyo-auth-preview-accounts-staging.up.railway.app",
  daebak: "https://daebak-auth-preview-accounts-staging.up.railway.app",
});
assert.equal(infra.projectId, project);
assert.equal(infra.environmentId, environment);
assert.equal(infra.databaseServiceId, postgresService);
assert.equal(infra.baseURL, origins.accounts);
assert.equal(seed.member.email, fixture.existing.email);
assert(seed.member.email.endsWith("@example.invalid"));
assert(fixture.new.email.endsWith("@example.invalid"));
for (const value of [
  fixture.issuer,
  fixture.existing.subject,
  fixture.new.subject,
])
  assert.equal(typeof value, "string");

const sqlText = (value) =>
  `convert_from(decode('${Buffer.from(value).toString("base64")}','base64'),'UTF8')`;
async function ownerSql(sql) {
  const encoded = Buffer.from(sql).toString("base64");
  const { stdout } = await run(
    "railway",
    [
      "ssh",
      "-p",
      project,
      "-e",
      environment,
      "-s",
      postgresService,
      "echo",
      encoded,
      "|",
      "base64",
      "-d",
      "|",
      "psql",
      '"$DATABASE_URL"',
      "-X",
      "-Atq",
      "-v",
      "ON_ERROR_STOP=1",
    ],
    { maxBuffer: 1024 * 1024, timeout: 30_000 },
  );
  const lines = stdout
    .trim()
    .split("\n")
    .filter((value) => value.startsWith("{"));
  if (!lines.length)
    throw new Error("staging database proof returned no aggregate result");
  return lines.map((line) => JSON.parse(line));
}

const target = fixture.existing;
const unaffected = fixture.new;
const expirySql = String.raw`
\connect arcade_auth_staging
DO $guard$ BEGIN
 IF current_database()<>'arcade_auth_staging' THEN RAISE EXCEPTION 'wrong_database'; END IF;
 IF (SELECT count(*) FROM account_members WHERE issuer=${sqlText(fixture.issuer)} AND subject=${sqlText(target.subject)})<>1 THEN RAISE EXCEPTION 'wrong_arcade_identity'; END IF;
END $guard$;
WITH changed AS (
 UPDATE account_sessions SET expires_at=now()-interval '1 second'
 WHERE member_id=(SELECT id FROM account_members WHERE issuer=${sqlText(fixture.issuer)} AND subject=${sqlText(target.subject)})
   AND revoked_at IS NULL AND expires_at>now() RETURNING 1
) SELECT json_build_object('databaseOk',current_database()='arcade_auth_staging','expired',count(*)) FROM changed;
\connect aegyo_auth_staging
DO $guard$ BEGIN
 IF current_database()<>'aegyo_auth_staging' THEN RAISE EXCEPTION 'wrong_database'; END IF;
 IF (SELECT count(*) FROM "SharedAuthIdentity" i JOIN "User" u ON u.id=i."userId" WHERE i.issuer=${sqlText(fixture.issuer)} AND i.subject=${sqlText(target.subject)} AND lower(btrim(u.email))=${sqlText(target.email.toLowerCase())})<>1 THEN RAISE EXCEPTION 'wrong_aegyo_identity'; END IF;
END $guard$;
WITH changed AS (
 UPDATE "Session" SET "expiresAt"=now()-interval '1 second'
 WHERE "userId"=(SELECT "userId" FROM "SharedAuthIdentity" WHERE issuer=${sqlText(fixture.issuer)} AND subject=${sqlText(target.subject)})
   AND "expiresAt">now() RETURNING 1
) SELECT json_build_object('databaseOk',current_database()='aegyo_auth_staging','expired',count(*)) FROM changed;`;

const revokeSql = String.raw`
\connect railway
BEGIN;
DO $guard$ BEGIN
 IF current_database()<>'railway' THEN RAISE EXCEPTION 'wrong_database'; END IF;
 IF (SELECT count(*) FROM public."user" WHERE id=${sqlText(target.subject)} AND lower(btrim(email))=${sqlText(target.email.toLowerCase())})<>1 THEN RAISE EXCEPTION 'wrong_target_identity'; END IF;
 IF (SELECT count(*) FROM public."user" WHERE id=${sqlText(unaffected.subject)} AND lower(btrim(email))=${sqlText(unaffected.email.toLowerCase())})<>1 THEN RAISE EXCEPTION 'wrong_control_identity'; END IF;
END $guard$;
CREATE TEMP TABLE proof_before AS SELECT id,"securityVersion" FROM public."user" WHERE id IN (${sqlText(target.subject)},${sqlText(unaffected.subject)});
SELECT public.aegyo_revoke_user(${sqlText(target.subject)},false);
SELECT json_build_object(
 'databaseOk',current_database()='railway',
 'targetAdvanced',(SELECT u."securityVersion"=b."securityVersion"+1 FROM public."user" u JOIN proof_before b USING(id) WHERE u.id=${sqlText(target.subject)}),
 'controlUnchanged',(SELECT u."securityVersion"=b."securityVersion" FROM public."user" u JOIN proof_before b USING(id) WHERE u.id=${sqlText(unaffected.subject)}),
 'targetSessions',(SELECT count(*) FROM public."session" WHERE "userId"=${sqlText(target.subject)}),
 'targetBlocked',(SELECT banned FROM public."user" WHERE id=${sqlText(target.subject)})
);
COMMIT;`;

const products = [
  {
    name: "Arcade",
    origin: origins.arcade,
    login: "/api/accounts/login",
    session: "/api/accounts/session",
    cookie: "__Host-aegyo_member",
    inactive: 401,
  },
  {
    name: "Aegyo",
    origin: origins.aegyo,
    login: "/api/auth/shared/login",
    session: "/api/auth/shared/session",
    cookie: "session",
    inactive: 401,
  },
  {
    name: "Daebak",
    origin: origins.daebak,
    login: "/api/accounts/login?returnTo=%2Faccount-link",
    session: "/api/accounts/session",
    cookie: "__Host-daebak-accounts-session",
    inactive: 200,
  },
];
const report = {
  startedAt: new Date().toISOString(),
  scope: "reserved synthetic @example.invalid staging identities",
  checks: [],
  expiry: "forced database expiry, not a natural TTL wait",
  mail: "not invoked",
  privy: "not invoked",
};
const pass = (name) => {
  report.checks.push(name);
  console.log(`PASS ${name}`);
};
const state = async (context, product) => {
  const response = await context.request.get(product.origin + product.session, {
    timeout: 10_000,
  });
  return { status: response.status(), body: await response.json() };
};
const active = async (context, product) => {
  const value = await state(context, product);
  assert.equal(value.status, 200);
  if (product.name === "Daebak")
    assert.deepEqual(value.body, { authenticated: true });
  else assert.equal(value.body.authenticated, true);
};
const inactive = (value, product) => {
  assert.equal(value.status, product.inactive);
  assert.deepEqual(value.body, { authenticated: false });
};
async function login(context, credentials, product, interactive = false) {
  const page = await context.newPage();
  page.setDefaultTimeout(30_000);
  await page.goto(product.origin + product.login);
  if (interactive) {
    await page.waitForURL(
      (url) => url.origin === origins.accounts && url.pathname === "/sign-in",
    );
    await page
      .getByLabel("Email address", { exact: true })
      .fill(credentials.email);
    await page
      .getByLabel("Password", { exact: true })
      .fill(credentials.password);
    await page.getByRole("button", { name: "Sign in", exact: true }).click();
  }
  await page.waitForURL((url) => url.origin === product.origin);
  await active(context, product);
  await page.close();
}
async function loginAll(context, credentials, interactive = true) {
  for (let i = 0; i < products.length; i++)
    await login(context, credentials, products[i], interactive && i === 0);
}

let browser;
let phase = "launch";
try {
  browser = await chromium.launch({ headless: true });
  phase = "forced-product-expiry";
  const expiring = await browser.newContext();
  await loginAll(expiring, seed.member);
  const cookiePresence = Object.fromEntries(
    await Promise.all(
      products
        .slice(0, 2)
        .map(async (p) => [
          p.name,
          (await expiring.cookies(p.origin)).some((c) => c.name === p.cookie),
        ]),
    ),
  );
  assert.deepEqual(cookiePresence, { Arcade: true, Aegyo: true });
  const expired = await ownerSql(expirySql);
  assert.equal(expired.length, 2);
  for (const result of expired) {
    assert.equal(result.databaseOk, true);
    assert(result.expired > 0);
  }
  for (const product of products.slice(0, 2))
    inactive(await state(expiring, product), product);
  await active(expiring, products[2]);
  await login(expiring, seed.member, products[0]);
  await login(expiring, seed.member, products[1]);
  pass(
    "forced Arcade and Aegyo local-session expiry rejects retained cookies and provider SSO renews both; Daebak remains active",
  );

  phase = "all-device-operator-revocation";
  const first = expiring,
    second = await browser.newContext(),
    control = await browser.newContext();
  phase = "second-target-browser-login";
  await loginAll(second, seed.member, true);
  phase = "unaffected-control-login";
  await login(control, unaffected, products[0], true);
  phase = "all-device-operator-revocation";
  const staleProviderCookies = await first.cookies(origins.accounts);
  const revokedAt = Date.now();
  const [revoked] = await ownerSql(revokeSql);
  assert.deepEqual(revoked, {
    databaseOk: true,
    targetAdvanced: true,
    controlUnchanged: true,
    targetSessions: 0,
    targetBlocked: false,
  });
  const deadline = revokedAt + 40_000;
  let denied = false;
  do {
    try {
      for (const context of [first, second])
        for (const product of products)
          inactive(await state(context, product), product);
      denied = true;
      break;
    } catch {
      await new Promise((r) => setTimeout(r, 1000));
    }
  } while (Date.now() < deadline);
  assert(denied);
  report.revocationObservedMs = Date.now() - revokedAt;
  await active(control, products[0]);
  pass(
    "operator cutoff revokes every retained product session in two browsers while a different synthetic user remains active",
  );

  phase = "stale-provider-and-recovery";
  for (const product of products) {
    const stale = await browser.newContext();
    await stale.addCookies(staleProviderCookies);
    const page = await stale.newPage();
    await page.goto(product.origin + product.login);
    await page.waitForURL(
      (u) => u.origin === origins.accounts && u.pathname === "/sign-in",
    );
    assert(
      !(await stale.cookies(product.origin)).some(
        (c) => c.name === product.cookie,
      ),
    );
    await stale.close();
  }
  pass(
    "pre-revocation provider cookies cannot mint a fresh session on any product",
  );
  const recovered = await browser.newContext();
  await loginAll(recovered, seed.member, true);
  for (const product of products) await active(recovered, product);
  pass(
    "non-banning operator revocation permits fresh authentication and leaves the fixture usable",
  );
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
    /cross-app-staging-expiry-revocation\.mjs:\d+:\d+/,
  )?.[0];
  console.error(JSON.stringify({ failed: true, phase, error: report.failure }));
  process.exitCode = 1;
} finally {
  await browser?.close();
  const path = new URL("cross-app-expiry-revocation-report.json", proofRoot);
  await fs.writeFile(path, JSON.stringify(report, null, 2) + "\n", {
    mode: 0o600,
  });
  await fs.chmod(path, 0o600);
}
