#!/usr/bin/env node
// Synthetic local UI proof only. OIDC protocol behavior is proved separately.
import assert from "node:assert/strict";
import { createHash, randomBytes } from "node:crypto";
import { mkdir, mkdtemp, rm, writeFile } from "node:fs/promises";
import { createServer } from "node:http";
import { get as httpsGet } from "node:https";
import { tmpdir } from "node:os";
import { join, resolve } from "node:path";
import { spawn } from "node:child_process";
import { once } from "node:events";
import pg from "pg";
import { chromium } from "@playwright/test";

const repo = resolve(new URL("../..", import.meta.url).pathname);
const migrations = [
  "src/db/migrations/0000_foamy_rogue.sql",
  "src/db/migrations/0001_arcade_shared_auth.sql",
  "src/db/migrations/0002_arcade_competition.sql",
  "src/db/migrations/0003_monthly_scoring_windows.sql",
];
const proofDir = join(repo, ".auth-proof", "competition-ui");
const memberId = "10000000-0000-4000-8000-000000000001";
const roundId = "30000000-0000-4000-8000-000000000001";
const subject = "synthetic-browser-member";
const providerSid = "synthetic-browser-session";
const readerKey = randomBytes(32).toString("base64url");
const memberToken = randomBytes(32).toString("base64url");
const memberHash = createHash("sha256").update(memberToken).digest("hex");
const rules = {
  version: 1,
  mode: "synthetic",
  dailyAttempts: 3,
  attemptTtlSeconds: 900,
  games: [
    {
      gameId: "snake",
      calibration: [
        { score: 0, points: 0 },
        { score: 100, points: 1000 },
      ],
    },
    {
      gameId: "flappy",
      calibration: [
        { score: 0, points: 0 },
        { score: 100, points: 1000 },
      ],
    },
  ],
};
const report = {
  startedAt: new Date().toISOString(),
  scope: "synthetic local browser only; identity-state stub, not OIDC proof",
  checks: [],
};
let phase = "setup";
let temp;
let pgProcess;
let nextProcess;
let stub;
let pool;
let browser;

function pass(name) {
  report.checks.push(name);
  console.log(`PASS ${name}`);
}

function run(command, args, options = {}) {
  return new Promise((resolveRun, reject) => {
    const child = spawn(command, args, {
      cwd: repo,
      stdio: ["ignore", "pipe", "pipe"],
      ...options,
    });
    let stdout = "";
    let stderr = "";
    child.stdout.on("data", (chunk) => (stdout += chunk));
    child.stderr.on("data", (chunk) => (stderr += chunk));
    child.once("error", reject);
    child.once("exit", (code) =>
      code === 0
        ? resolveRun({ stdout, stderr })
        : reject(
            new Error(`${command} exited ${code}: ${stderr.slice(-1000)}`),
          ),
    );
  });
}

async function freePort() {
  const server = createServer();
  server.listen(0, "127.0.0.1");
  await once(server, "listening");
  const port = server.address().port;
  await new Promise((resolveClose) => server.close(resolveClose));
  return port;
}

async function waitFor(url, child) {
  for (let attempt = 0; attempt < 120; attempt += 1) {
    if (child.exitCode !== null)
      throw new Error(`Next exited before becoming ready (${child.exitCode})`);
    const ready = await new Promise((resolveReady) => {
      const request = httpsGet(
        url,
        { rejectUnauthorized: false },
        (response) => {
          response.resume();
          resolveReady((response.statusCode ?? 500) < 500);
        },
      );
      request.setTimeout(1_000, () => request.destroy());
      request.on("error", () => resolveReady(false));
    });
    if (ready) return;
    await new Promise((resolveWait) => setTimeout(resolveWait, 250));
  }
  throw new Error("Next did not become ready");
}

try {
  phase = "private postgres";
  temp = await mkdtemp(join(tmpdir(), "aegyo-competition-ui-"));
  const data = join(temp, "data");
  const socket = join(temp, "socket");
  await mkdir(socket, { mode: 0o700 });
  await run("initdb", [
    "-D",
    data,
    "--no-locale",
    "--encoding=UTF8",
    "--auth=trust",
  ]);
  pgProcess = spawn("postgres", ["-D", data, "-k", socket, "-h", "", "-F"], {
    stdio: "ignore",
  });
  const databaseUrl = `postgresql://${encodeURIComponent(process.env.USER ?? "postgres")}@localhost/aegyo_competition_ui?host=${encodeURIComponent(socket)}`;
  for (let attempt = 0; attempt < 80; attempt += 1) {
    try {
      await run("createdb", ["-h", socket, "aegyo_competition_ui"]);
      break;
    } catch {
      if (attempt === 79) throw new Error("private Postgres did not start");
      await new Promise((resolveWait) => setTimeout(resolveWait, 100));
    }
  }
  for (const migration of migrations) {
    await run("psql", [
      "-X",
      "-v",
      "ON_ERROR_STOP=1",
      "-h",
      socket,
      "-d",
      "aegyo_competition_ui",
      "-f",
      join(repo, migration),
    ]);
  }
  pool = new pg.Pool({ connectionString: databaseUrl, max: 2 });
  await pool.query(
    "INSERT INTO account_members(id,issuer,subject,display_name) VALUES($1,$2,$3,'Synthetic player')",
    [memberId, "http://localhost:1/api/auth", subject],
  );
  await pool.query(
    `INSERT INTO account_sessions(token_hash,member_id,provider_session_id,email_verified,authenticated_at,provider_checked_at,security_version,password_reset_state,expires_at)
       VALUES($1,$2,$3,true,date_trunc('second',now()),now(),0,$4::jsonb,now()+interval '1 hour')`,
    [
      memberHash,
      memberId,
      providerSid,
      JSON.stringify({ version: 1, kind: "database", lastPasswordReset: null }),
    ],
  );
  await pool.query(
    `INSERT INTO competition_rounds(id,slug,rules,status,opens_at,closes_at)
       VALUES($1,'synthetic-browser-round',$2::jsonb,'open',now()-interval '1 minute',now()+interval '1 hour')`,
    [roundId, JSON.stringify(rules)],
  );

  phase = "loopback identity stub";
  stub = createServer(async (request, response) => {
    if (
      request.socket.remoteAddress !== "127.0.0.1" &&
      request.socket.remoteAddress !== "::1"
    )
      return response.writeHead(403).end();
    if (
      request.method !== "POST" ||
      request.url !== "/api/internal/session-state" ||
      request.headers.authorization !== `Bearer ${readerKey}`
    )
      return response.writeHead(404).end();
    let body = "";
    for await (const chunk of request) body += chunk;
    const parsed = JSON.parse(body);
    if (parsed.subject !== subject || parsed.providerSessionId !== providerSid)
      return response.writeHead(403).end();
    response.writeHead(200, { "content-type": "application/json" });
    response.end(
      JSON.stringify({
        version: 1,
        subject,
        providerSessionId: providerSid,
        active: true,
        passwordResetState: {
          version: 1,
          kind: "database",
          lastPasswordReset: null,
        },
        operatorCutoff: null,
        securityVersion: 0,
      }),
    );
  });
  const idpPort = await freePort();
  stub.listen(idpPort, "localhost");
  await once(stub, "listening");
  // The issuer stored in the fixture must match the configured exact namespace.
  await pool.query("UPDATE account_members SET issuer=$1 WHERE id=$2", [
    `http://localhost:${idpPort}/api/auth`,
    memberId,
  ]);

  phase = "isolated next";
  const appPort = await freePort();
  const appOrigin = `https://localhost:${appPort}`;
  const cleanEnv = {
    PATH: process.env.PATH,
    HOME: process.env.HOME,
    NODE_ENV: "development",
    NEXT_TELEMETRY_DISABLED: "1",
    DATABASE_URL: databaseUrl,
    ARCADE_SHARED_AUTH_ENABLED: "true",
    ARCADE_AUTH_BASE_URL: `http://localhost:${idpPort}`,
    ARCADE_APP_ORIGIN: appOrigin,
    ARCADE_AUTH_CLIENT_ID: "synthetic-browser-client",
    ARCADE_AUTH_CLIENT_SECRET: "synthetic-browser-secret",
    ARCADE_AUTH_TRANSACTION_SECRET: randomBytes(32).toString("hex"),
    ARCADE_AUTH_STATE_READER_KEY: readerKey,
    ARCADE_COMPETITION_ENABLED: "true",
    ARCADE_COMPETITION_SEED_SECRET: randomBytes(32).toString("hex"),
    ARCADE_MATERIAL_COMPETITION_ENABLED: "false",
  };
  nextProcess = spawn(
    process.execPath,
    [
      join(repo, "node_modules", "next", "dist", "bin", "next"),
      "dev",
      "--experimental-https",
      "--port",
      String(appPort),
    ],
    { cwd: repo, env: cleanEnv, stdio: ["ignore", "pipe", "pipe"] },
  );
  let nextLog = "";
  nextProcess.stdout.on("data", (chunk) => (nextLog += chunk));
  nextProcess.stderr.on("data", (chunk) => (nextLog += chunk));
  await waitFor(`${appOrigin}/championship`, nextProcess);

  phase = "browser account and enrollment";
  await mkdir(proofDir, { recursive: true, mode: 0o700 });
  browser = await chromium.launch({ headless: true });
  for (const viewport of [
    { name: "desktop", width: 1280, height: 900 },
    { name: "mobile", width: 390, height: 844 },
  ]) {
    const context = await browser.newContext({
      viewport,
      ignoreHTTPSErrors: true,
    });
    await context.addCookies([
      {
        name: "__Host-aegyo_member",
        value: memberToken,
        url: appOrigin,
        httpOnly: true,
        secure: true,
        sameSite: "Lax",
      },
    ]);
    assert.equal(
      (await context.cookies(appOrigin)).find(
        (cookie) => cookie.name === "__Host-aegyo_member",
      )?.value,
      memberToken,
      "synthetic member cookie was not installed",
    );
    const page = await context.newPage();
    page.setDefaultTimeout(15_000);
    const guestBootstrap = page.waitForResponse(
      (response) =>
        response.url() === `${appOrigin}/api/session` &&
        response.request().method() === "POST",
    );
    await page.goto(`${appOrigin}/`);
    assert.equal((await guestBootstrap).status(), 200);
    await page
      .getByRole("link", { name: "Championship", exact: true })
      .waitFor();
    await page.getByRole("link", { name: "My account", exact: true }).waitFor();
    const guestBefore = (await context.cookies(appOrigin)).find(
      (cookie) => cookie.name === "__Host-aegyo_device",
    )?.value;
    assert.ok(guestBefore);
    const profileResponse = await context.request.get(
      `${appOrigin}/api/accounts/profile`,
    );
    assert.equal(
      profileResponse.status(),
      200,
      `profile API ${profileResponse.status()} ${await profileResponse.text()} set-cookie=${profileResponse.headers()["set-cookie"] ? "present" : "absent"}`,
    );
    await page.goto(`${appOrigin}/account`);
    if (viewport.name === "desktop") {
      await page.getByLabel(/Use 3|Usa de 3/).waitFor();
      await page
        .getByRole("textbox", { name: /Use 3|Usa de 3/ })
        .fill("desktop_fan");
      await page
        .getByRole("button", { name: /Choose username|Elegir nombre/ })
        .click();
    }
    await page.getByText("@desktop_fan").waitFor();
    await page.goto(`${appOrigin}/championship`);
    await page
      .getByText(/Test round · no prizes|Ronda de prueba · sin premios/)
      .waitFor();
    await page.addStyleTag({
      content: "nextjs-portal{display:none!important}",
    });
    await page.screenshot({
      path: join(proofDir, `championship-${viewport.name}.png`),
      fullPage: true,
    });
    assert.equal(
      await page.evaluate(
        () => document.documentElement.scrollWidth <= innerWidth,
      ),
      true,
    );
    if (viewport.name === "desktop") {
      await page.getByRole("checkbox").check();
      await page.getByRole("button", { name: "Enroll", exact: true }).click();
      await page.getByText("You’re enrolled").waitFor();
      await page.getByRole("link", { name: /Play Snake/ }).click();
      await page.getByTestId("start-championship").click();
      await page.getByText("Championship attempt in progress").waitFor();
      await page.keyboard.press("ArrowUp");
      await page
        .getByText(/Replay verified|did not qualify/, { exact: false })
        .waitFor({ timeout: 20_000 });
      await page.goto(`${appOrigin}/championship`);
      await page.getByText("Attempts left today").waitFor();
      assert.match(
        await page.getByRole("link", { name: /Play Snake/ }).textContent(),
        /· 2$/,
      );
      pass("desktop username, enrollment, official attempt and decrement");
    } else {
      pass("mobile account and championship render without overflow");
    }
    const guestAfter = (await context.cookies(appOrigin)).find(
      (cookie) => cookie.name === "__Host-aegyo_device",
    )?.value;
    assert.equal(guestAfter, guestBefore);
    if (viewport.name === "mobile") {
      await page.goto(`${appOrigin}/account`);
      await page
        .getByRole("button", {
          name: /Sign out of this arcade|Cerrar sesión en este arcade/,
        })
        .click();
      await page.waitForURL(`${appOrigin}/`);
      const cookies = await context.cookies(appOrigin);
      assert.equal(
        cookies.some((cookie) => cookie.name === "__Host-aegyo_member"),
        false,
      );
      assert.equal(
        cookies.find((cookie) => cookie.name === "__Host-aegyo_device")?.value,
        guestBefore,
      );
      pass("local member sign-out preserves the guest cookie");
    }
    await context.close();
  }
  pass("guest cookie remains unchanged across member competition journey");
  report.finishedAt = new Date().toISOString();
  await writeFile(
    join(proofDir, "report.json"),
    `${JSON.stringify(report, null, 2)}\n`,
    { mode: 0o600 },
  );
  console.log(`PASS report ${join(proofDir, "report.json")}`);
} catch (error) {
  console.error(
    `FAIL ${phase}: ${error instanceof Error ? error.message : "unknown error"}`,
  );
  process.exitCode = 1;
} finally {
  if (browser) await browser.close().catch(() => {});
  if (pool) await pool.end().catch(() => {});
  if (nextProcess && nextProcess.exitCode === null) nextProcess.kill("SIGTERM");
  if (stub)
    await new Promise((resolveClose) => stub.close(resolveClose)).catch(
      () => {},
    );
  if (pgProcess && pgProcess.exitCode === null) pgProcess.kill("SIGTERM");
  if (temp) await rm(temp, { recursive: true, force: true }).catch(() => {});
}
