/**
 * Counted-API smoke (ADR 0004 provisioning checklist, final step).
 *
 * FAILURE-SAFE DESIGN (M4 ops review, 2nd round): the smoke never
 * relies on capturing identifiers from HTTP responses. It PRE-SEEDS
 * two devices + sessions with locally generated UUIDs/tokens directly
 * in the database, drives the HTTP flow with those session cookies,
 * and deletes by EXACT device UUID in a `finally` block — cleanup runs
 * no matter which check, fetch, or parse step throws. If the server
 * ever mints a fresh session (fall-through on a bad cookie), the
 * Set-Cookie value is captured and that device is resolved via its
 * token HASH — display handles are never used as identifiers (they
 * are neither unique nor high-entropy).
 *
 * SAFETY RAILS (ops review round 3):
 * - Both devices AND sessions are seeded in ONE transaction, and their
 *   UUIDs are registered for cleanup BEFORE the first insert — a
 *   partial seed can never escape the finally block.
 * - PREFLIGHT: before any mutating request, `GET /api/streak` must
 *   return 200 with each seeded cookie. That proves SMOKE_URL and
 *   SMOKE_DATABASE_URL refer to the SAME database; on a mismatched
 *   pair the preflight 401s and the smoke aborts WITHOUT creating
 *   anything in the deployment's database.
 * - Every request carries a bounded timeout so a hung fetch still
 *   reaches cleanup. Cleanup is unconditional — there is no opt-out.
 *
 * USAGE (SMOKE_DATABASE_URL is REQUIRED — it is used for pre-seeding
 * as well as cleanup, so there is no DB-less mode):
 *
 *   SMOKE_URL=https://<host> SMOKE_DATABASE_URL=postgresql://... \
 *     node scripts/ops/prod-smoke.mjs
 *
 * Env:
 * - `VERCEL_AUTOMATION_BYPASS_SECRET`: sent as the
 *   `x-vercel-protection-bypass` header so SSO-protected previews are
 *   reachable (Vercel's documented automation-bypass mechanism).
 * - Regression hooks (e2e only): `SMOKE_ABORT_AFTER=first-submit`
 *   crashes right after the first server commit;
 *   `SMOKE_SEED_EXPIRED=1` seeds already-expired sessions so the
 *   server cannot resolve them — the preflight must abort before any
 *   mutation.
 *
 * Device A: generic counted loop — session touch → issue → submit →
 * idempotent replay → OD-1 slot consumed → board + streak. Device B:
 * claw game-owned loop — issue → play → same-key replay returns the
 * ORIGINAL outcome. Exits non-zero if any check fails.
 */

import { createHash, randomBytes, randomUUID } from "node:crypto";
import pg from "pg";

const BASE = (process.env.SMOKE_URL ?? process.argv[2] ?? "").replace(
  /\/$/,
  "",
);
const DB_URL =
  process.env.SMOKE_DATABASE_URL ?? process.env.CLEANUP_DATABASE_URL ?? "";
if (!BASE || !DB_URL) {
  console.error(
    "usage: SMOKE_URL=https://host SMOKE_DATABASE_URL=postgres://... " +
      "node scripts/ops/prod-smoke.mjs",
  );
  process.exit(1);
}
const BYPASS_SECRET = process.env.VERCEL_AUTOMATION_BYPASS_SECRET ?? "";
const ABORT_AFTER = process.env.SMOKE_ABORT_AFTER ?? "";
const SEED_EXPIRED = process.env.SMOKE_SEED_EXPIRED === "1";
const FETCH_TIMEOUT_MS = 15_000;

const SESSION_COOKIE = "__Host-aegyo_device";
const sha256 = (value) => createHash("sha256").update(value).digest("hex");

let failures = 0;
function check(label, ok, detail = "") {
  if (ok) console.log(`PASS  ${label}`);
  else {
    failures++;
    console.error(`FAIL  ${label}${detail ? ` — ${detail}` : ""}`);
  }
}

/** Cookie jar seeded with a pre-provisioned session token. */
function jar(sessionToken) {
  const cookies = new Map([[SESSION_COOKIE, sessionToken]]);
  return {
    absorb(response) {
      for (const line of response.headers.getSetCookie?.() ?? []) {
        const [pair] = line.split(";");
        const eq = pair.indexOf("=");
        if (eq > 0) {
          const name = pair.slice(0, eq).trim();
          const value = pair.slice(eq + 1);
          // A session value DIFFERENT from ours means the server fell
          // through to a fresh identity — record it so cleanup can
          // resolve that device by token hash (exact, not by handle).
          if (name === SESSION_COOKIE && value !== sessionToken) {
            strayTokenHashes.add(sha256(value));
          }
          cookies.set(name, value);
        }
      }
    },
    header() {
      return [...cookies.entries()].map(([k, v]) => `${k}=${v}`).join("; ");
    },
  };
}

/** Token hashes of any sessions the server created underneath us. */
const strayTokenHashes = new Set();

async function call(cookieJar, method, path, body) {
  const headers = {
    "content-type": "application/json",
    cookie: cookieJar.header(),
  };
  if (BYPASS_SECRET) headers["x-vercel-protection-bypass"] = BYPASS_SECRET;
  const response = await fetch(`${BASE}${path}`, {
    method,
    headers,
    body: body === undefined ? undefined : JSON.stringify(body),
    // A hung request must still reach the cleanup block.
    signal: AbortSignal.timeout(FETCH_TIMEOUT_MS),
  });
  cookieJar.absorb(response);
  let json = null;
  try {
    json = await response.json();
  } catch {
    // Non-JSON body — callers assert on status alone.
  }
  return { status: response.status, json };
}

const timeZone = "America/Mexico_City";
const client = new pg.Client({
  connectionString: DB_URL,
  connectionTimeoutMillis: FETCH_TIMEOUT_MS,
});
await client.connect();

// ---------- Pre-seed: known UUIDs + tokens, BEFORE any HTTP ----------
// UUIDs are registered for cleanup BEFORE the first insert, and both
// devices + sessions land in ONE transaction — a partial seed cannot
// escape the finally block (a rolled-back seed just makes the deletes
// no-ops).
const seedA = {
  id: randomUUID(),
  handle: `SmokeCheckA-${Date.now()}`,
  token: randomBytes(32).toString("base64url"),
};
const seedB = {
  id: randomUUID(),
  handle: `SmokeCheckB-${Date.now()}`,
  token: randomBytes(32).toString("base64url"),
};
const seeded = [
  { id: seedA.id, handle: seedA.handle },
  { id: seedB.id, handle: seedB.handle },
];

let exitCode = 1;
try {
  const expiresSql = SEED_EXPIRED
    ? "now() - interval '1 day'"
    : "now() + interval '90 days'";
  await client.query("BEGIN");
  for (const seed of [seedA, seedB]) {
    await client.query(
      "INSERT INTO devices (id, locale, generated_handle, time_zone) VALUES ($1, $2, $3, $4)",
      [seed.id, "en", seed.handle, timeZone],
    );
    await client.query(
      `INSERT INTO device_sessions (token_hash, device_id, expires_at) VALUES ($1, $2, ${expiresSql})`,
      [sha256(seed.token), seed.id],
    );
  }
  await client.query("COMMIT");
  console.log(`SEEDED  ${seedA.id} (A), ${seedB.id} (B)`);

  // ---------- Preflight: prove SMOKE_URL ⇄ SMOKE_DATABASE_URL ----------
  // GET /api/streak is authenticated and read-only. 200 with a seeded
  // cookie proves the deployment reads the SAME database we seeded; on
  // a mismatched pair this 401s and we abort BEFORE any request that
  // could create rows in the deployment's database.
  for (const [label, seed] of [
    ["A", seedA],
    ["B", seedB],
  ]) {
    const probe = await call(jar(seed.token), "GET", "/api/streak");
    if (probe.status !== 200) {
      throw new Error(
        `PREFLIGHT FAILED (device ${label}): GET /api/streak returned ` +
          `${probe.status} — the deployment cannot resolve the seeded ` +
          "session. SMOKE_URL and SMOKE_DATABASE_URL likely point at " +
          "DIFFERENT databases; aborting before any mutation.",
      );
    }
  }

  // ---------- Device A: generic counted loop ----------
  const a = jar(seedA.token);
  {
    const session = await call(a, "POST", "/api/session", {
      timeZone,
      locale: "es-419",
    });
    check(
      "A pre-seeded session resolved (no fall-through identity)",
      session.status === 200 && session.json?.handle === seedA.handle,
      `status ${session.status} handle ${session.json?.handle}`,
    );
    check(
      "A locale update persisted to es-419 (§12.1)",
      session.json?.locale === "es-419",
      JSON.stringify(session.json),
    );

    const issued = await call(a, "POST", "/api/runs", { gameId: "snake" });
    check(
      "A snake attempt issued",
      issued.status === 200 && typeof issued.json?.attemptId === "string",
      `status ${issued.status}`,
    );
    const attemptId = issued.json?.attemptId;

    const submit = await call(a, "PUT", `/api/runs/${attemptId}`, {
      score: 7,
      clientDurationMs: 30_000,
    });
    check(
      "A submit accepted (rank + streak, not a replay)",
      submit.status === 200 &&
        submit.json?.replay === false &&
        submit.json?.score === 7 &&
        typeof submit.json?.rank === "number",
      JSON.stringify(submit.json),
    );

    if (ABORT_AFTER === "first-submit") {
      throw new Error(
        "SMOKE_ABORT_AFTER=first-submit — deliberate crash after the first " +
          "server commit (cleanup regression)",
      );
    }

    const replay = await call(a, "PUT", `/api/runs/${attemptId}`, {
      score: 999, // hostile overwrite attempt
      clientDurationMs: 1,
    });
    check(
      "A replay returns the ORIGINAL result",
      replay.status === 200 &&
        replay.json?.replay === true &&
        replay.json?.score === 7,
      JSON.stringify(replay.json),
    );

    const second = await call(a, "POST", "/api/runs", { gameId: "claw" });
    check(
      "A day consumed portal-wide (OD-1): second issue → daily_slot_used",
      second.status === 409 && second.json?.code === "daily_slot_used",
      `status ${second.status} ${JSON.stringify(second.json)}`,
    );

    const board = await call(a, "GET", "/api/leaderboards/snake");
    check(
      "A snake board readable with a season key",
      board.status === 200 && typeof board.json?.seasonKey === "string",
      `status ${board.status}`,
    );

    const streak = await call(a, "GET", "/api/streak");
    check(
      "A streak advanced to 1",
      streak.status === 200 && streak.json?.current >= 1,
      JSON.stringify(streak.json),
    );
  }

  // ---------- Device B: claw game-owned loop ----------
  const b = jar(seedB.token);
  {
    const session = await call(b, "POST", "/api/session", { timeZone });
    check(
      "B pre-seeded session resolved (no fall-through identity)",
      session.status === 200 && session.json?.handle === seedB.handle,
      `status ${session.status} handle ${session.json?.handle}`,
    );

    const issued = await call(b, "POST", "/api/runs", { gameId: "claw" });
    check(
      "B claw attempt issued",
      issued.status === 200 && typeof issued.json?.attemptId === "string",
      `status ${issued.status} ${JSON.stringify(issued.json)}`,
    );
    const attemptId = issued.json?.attemptId;
    const idempotencyKey = randomUUID();

    const play = await call(b, "POST", "/api/claw/plays", {
      idempotencyKey,
      attemptId,
    });
    check(
      "B claw play committed (demo promotion active)",
      play.status === 200 &&
        ["win", "drop", "miss"].includes(play.json?.outcome),
      `status ${play.status} ${JSON.stringify(play.json)} — if promotion_inactive, run activate-demo-claw.mjs first`,
    );

    const replay = await call(b, "POST", "/api/claw/plays", {
      idempotencyKey,
      attemptId,
    });
    check(
      "B same-key replay returns the ORIGINAL outcome",
      replay.status === 200 &&
        replay.json?.replay === true &&
        replay.json?.outcome === play.json?.outcome,
      JSON.stringify(replay.json),
    );
  }

  exitCode = failures === 0 ? 0 : 1;
} catch (error) {
  failures++;
  console.error("SMOKE CRASHED:", error.message);
} finally {
  // ---------- Cleanup by EXACT UUID — runs on every path ----------
  try {
    // The seed transaction may have died mid-flight; clear any aborted
    // transaction state so cleanup queries can run.
    await client.query("ROLLBACK").catch(() => {});
    if (strayTokenHashes.size > 0) {
      const stray = await client.query(
        "SELECT device_id FROM device_sessions WHERE token_hash = ANY($1::text[])",
        [[...strayTokenHashes]],
      );
      for (const row of stray.rows) {
        console.error(`STRAY DEVICE detected via Set-Cookie: ${row.device_id}`);
        seeded.push({ id: row.device_id, handle: "(stray)" });
      }
    }
    const ids = seeded.map((entry) => entry.id);
    {
      await client.query("BEGIN");
      const attempts = await client.query(
        "SELECT id FROM run_attempts WHERE device_id = ANY($1::uuid[])",
        [ids],
      );
      const plays = await client.query(
        "SELECT id FROM claw_plays WHERE device_id = ANY($1::uuid[])",
        [ids],
      );
      const aggregates = [
        ...attempts.rows.map((row) => row.id),
        ...plays.rows.map((row) => row.id),
      ];
      await client.query(
        "DELETE FROM analytics_outbox WHERE aggregate_id = ANY($1::text[])",
        [aggregates],
      );
      await client.query(
        "DELETE FROM prize_claims WHERE play_id = ANY($1::uuid[])",
        [plays.rows.map((row) => row.id)],
      );
      await client.query(
        "DELETE FROM leaderboard_scores WHERE device_id = ANY($1::uuid[])",
        [ids],
      );
      // slots ↔ runs reference each other; break the cycle first.
      await client.query(
        "UPDATE daily_slots SET completed_run_id = NULL WHERE device_id = ANY($1::uuid[])",
        [ids],
      );
      await client.query(
        "DELETE FROM run_attempts WHERE device_id = ANY($1::uuid[])",
        [ids],
      );
      await client.query(
        "DELETE FROM claw_plays WHERE device_id = ANY($1::uuid[])",
        [ids],
      );
      await client.query(
        "DELETE FROM daily_slots WHERE device_id = ANY($1::uuid[])",
        [ids],
      );
      await client.query(
        "DELETE FROM streaks WHERE device_id = ANY($1::uuid[])",
        [ids],
      );
      await client.query(
        "DELETE FROM device_sessions WHERE device_id = ANY($1::uuid[])",
        [ids],
      );
      await client.query("DELETE FROM devices WHERE id = ANY($1::uuid[])", [
        ids,
      ]);
      await client.query("COMMIT");
      console.log(`CLEANUP  removed ${ids.length} smoke devices by UUID`);
    }
  } catch (cleanupError) {
    try {
      await client.query("ROLLBACK");
    } catch {
      // No open transaction — nothing to roll back.
    }
    failures++;
    exitCode = 1;
    console.error(
      `CLEANUP FAILED (rolled back) — remove manually by UUID: ${seeded
        .map((entry) => entry.id)
        .join(", ")} — ${cleanupError.message}`,
    );
  } finally {
    await client.end();
  }
}

console.log(failures === 0 ? "\nSMOKE GREEN" : `\nSMOKE RED (${failures})`);
process.exit(exitCode);
