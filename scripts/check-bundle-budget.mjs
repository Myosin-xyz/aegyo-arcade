/**
 * First-party home-route JS transfer budget check (TECH_SPEC §15, ADR 0002).
 *
 * Starts the production server, fetches `/`, gzips every referenced script,
 * and fails if the total exceeds the budget. Run after `next build`.
 */

import { spawn } from "node:child_process";
import { gzipSync } from "node:zlib";

const BUDGET_GZ_BYTES = 175 * 1024; // ADR 0002 amendment — corrected floor 145.3 KB
const PORT = 3117;
const BASE = `http://localhost:${PORT}`;

async function waitForServer(timeoutMs = 30_000) {
  const deadline = Date.now() + timeoutMs;
  while (Date.now() < deadline) {
    try {
      const res = await fetch(BASE, { redirect: "manual" });
      if (res.status < 500) return;
    } catch {
      // not up yet
    }
    await new Promise((r) => setTimeout(r, 300));
  }
  throw new Error("server did not become ready");
}

const server = spawn("pnpm", ["start", "--port", String(PORT)], {
  stdio: "ignore",
  detached: true,
});

try {
  await waitForServer();
  const html = await (await fetch(BASE + "/")).text();
  // Only scripts a MODERN browser actually requests: skip `nomodule`
  // legacy polyfills (M0 review P1 — counting them inflated the baseline
  // by ~38 KB gz that no supported browser transfers).
  const scripts = [
    ...new Set(
      [...html.matchAll(/<script\b([^>]*)>/gi)]
        .map((m) => m[1])
        .filter((attrs) => !/\bnomodule\b/i.test(attrs))
        .map((attrs) => /src="(\/_next\/[^"]+\.js[^"]*)"/.exec(attrs)?.[1])
        .filter(Boolean),
    ),
  ];
  let totalGz = 0;
  for (const src of scripts) {
    const buf = Buffer.from(await (await fetch(BASE + src)).arrayBuffer());
    const gz = gzipSync(buf, { level: 9 }).length;
    totalGz += gz;
    console.log(`${(gz / 1024).toFixed(1).padStart(7)} KB gz  ${src}`);
  }
  const totalKb = (totalGz / 1024).toFixed(1);
  const budgetKb = (BUDGET_GZ_BYTES / 1024).toFixed(0);
  console.log(`\nHome JS total: ${totalKb} KB gz (budget ${budgetKb} KB)`);
  if (totalGz > BUDGET_GZ_BYTES) {
    console.error(
      `BUDGET EXCEEDED by ${(totalGz - BUDGET_GZ_BYTES) / 1024} KB`,
    );
    process.exitCode = 1;
  }
} finally {
  process.kill(-server.pid, "SIGTERM");
}
