/**
 * Ops-smoke cleanup regression (M4 ops review P1): the production smoke
 * must leave the database at baseline on EVERY exit path. Three runs of
 * the real script against the real server + database:
 *
 * 1. `SMOKE_ABORT_AFTER=first-submit` crashes the smoke right after its
 *    first server commit — the try/finally cleanup must still restore
 *    the device-count baseline (and exit non-zero).
 * 2. A full green run must pass 12/12 AND restore the baseline.
 * 3. An unresolvable seeded session must fail in the read-only preflight,
 *    never reach a mutating request, and restore the baseline.
 *
 * The script pre-seeds devices with locally generated UUIDs and cleans
 * by exact UUID, so baseline restoration is provable regardless of
 * where the flow died.
 */

import { execFile } from "node:child_process";
import { promisify } from "node:util";
import { readFileSync } from "node:fs";
import path from "node:path";
import { expect, test } from "@playwright/test";
import pg from "pg";

const run = promisify(execFile);
const REPO_ROOT = path.resolve(__dirname, "../..");
const SCRIPT = path.join(REPO_ROOT, "scripts/ops/prod-smoke.mjs");

/** DATABASE_URL from the environment (CI) or .env.local (local dev). */
function resolveDbUrl(): string | null {
  if (process.env.DATABASE_URL) return process.env.DATABASE_URL;
  try {
    const envFile = readFileSync(path.join(REPO_ROOT, ".env.local"), "utf8");
    const match = envFile.match(/^DATABASE_URL=(.+)$/m);
    return match ? match[1].trim().replace(/^["']|["']$/g, "") : null;
  } catch {
    return null;
  }
}

const dbUrl = resolveDbUrl();

/** UUIDs the script pre-seeded, parsed from its own SEEDED line. */
function seededIds(stdout: string): string[] {
  const match = stdout.match(
    /^SEEDED\s+([0-9a-f-]{36}) \(A\), ([0-9a-f-]{36}) \(B\)/m,
  );
  if (!match) throw new Error(`no SEEDED line in output:\n${stdout}`);
  return [match[1], match[2]];
}

/**
 * Baseline proof that is safe under parallel e2e workers (which create
 * their own devices concurrently): every row tied to the smoke's exact
 * device UUIDs is gone — devices, sessions, attempts, scores, slots,
 * streaks, claw plays.
 */
async function rowsForDevices(url: string, ids: string[]): Promise<number> {
  const client = new pg.Client({ connectionString: url });
  await client.connect();
  try {
    const result = await client.query(
      `SELECT (SELECT count(*) FROM devices WHERE id = ANY($1::uuid[]))
            + (SELECT count(*) FROM device_sessions WHERE device_id = ANY($1::uuid[]))
            + (SELECT count(*) FROM run_attempts WHERE device_id = ANY($1::uuid[]))
            + (SELECT count(*) FROM leaderboard_scores WHERE device_id = ANY($1::uuid[]))
            + (SELECT count(*) FROM daily_slots WHERE device_id = ANY($1::uuid[]))
            + (SELECT count(*) FROM streaks WHERE device_id = ANY($1::uuid[]))
            + (SELECT count(*) FROM claw_plays WHERE device_id = ANY($1::uuid[]))
              AS n`,
      [ids],
    );
    return Number(result.rows[0].n);
  } finally {
    await client.end();
  }
}

function smokeEnv(url: string, extra: Record<string, string> = {}) {
  return {
    ...process.env,
    SMOKE_URL: "http://localhost:3105",
    SMOKE_DATABASE_URL: url,
    ...extra,
  };
}

test.describe("prod-smoke cleanup", () => {
  test.skip(!dbUrl, "requires DATABASE_URL (env or .env.local)");

  test("abort after the first server commit still restores baseline", async () => {
    // execFile rejects on non-zero exit — the expected shape here.
    const result = await run("node", [SCRIPT], {
      env: smokeEnv(dbUrl!, { SMOKE_ABORT_AFTER: "first-submit" }),
    }).then(
      (ok) => ({ code: 0, stdout: ok.stdout }),
      (error: { code?: number; stdout?: string }) => ({
        code: error.code ?? 1,
        stdout: error.stdout ?? "",
      }),
    );
    expect(result.code).not.toBe(0);
    expect(result.stdout).toContain("CLEANUP");
    expect(await rowsForDevices(dbUrl!, seededIds(result.stdout))).toBe(0);
  });

  test("full green run passes and restores baseline", async () => {
    const { stdout } = await run("node", [SCRIPT], {
      env: smokeEnv(dbUrl!),
    });
    expect(stdout).toContain("SMOKE GREEN");
    expect(stdout).toContain("CLEANUP");
    expect(stdout).not.toContain("FAIL");
    expect(await rowsForDevices(dbUrl!, seededIds(stdout))).toBe(0);
  });

  test("preflight aborts BEFORE any mutation when the server cannot resolve the seeded session", async () => {
    // SMOKE_SEED_EXPIRED seeds sessions the server will reject — the
    // same observable class as a mismatched SMOKE_URL/SMOKE_DATABASE_URL
    // pair (resolveSession → null → 401). The smoke must stop at the
    // read-only preflight, never reach POST /api/session (which would
    // mint an uncleanable identity in the deployment's database), and
    // still clean its seeds.
    const result = await run("node", [SCRIPT], {
      env: smokeEnv(dbUrl!, { SMOKE_SEED_EXPIRED: "1" }),
    }).then(
      (ok) => ({ code: 0, stdout: ok.stdout, stderr: ok.stderr }),
      (error: { code?: number; stdout?: string; stderr?: string }) => ({
        code: error.code ?? 1,
        stdout: error.stdout ?? "",
        stderr: error.stderr ?? "",
      }),
    );
    const output = result.stdout + result.stderr;
    expect(result.code).not.toBe(0);
    expect(output).toContain("PREFLIGHT FAILED");
    // No check ran, so no session POST fired — nothing to fall through.
    expect(output).not.toContain("pre-seeded session resolved");
    expect(output).not.toContain("STRAY");
    expect(output).toContain("CLEANUP");
    expect(await rowsForDevices(dbUrl!, seededIds(result.stdout))).toBe(0);
  });
});
