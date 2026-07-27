/**
 * Frogger envelope preflight (review P1, 2026-07-27).
 *
 * The Frogger maximum drops 60 → 30 (five-level cut). Production is
 * reachable and has taken real runs, so the code change is only safe to
 * DEPLOY if no historical Frogger score above 30 exists — such a row
 * would sit on the board forever, impossible to beat under the new
 * envelope, and an old acceptance receipt above 30 would replay a score
 * the server now rejects.
 *
 * READ-ONLY: two SELECT COUNTs, nothing else. Run against production
 * BEFORE deploying the 5-level Frogger, and paste the output into
 * docs/games/frogger.md ("Envelope preflight record").
 *
 * USAGE:
 *   PREFLIGHT_DATABASE_URL=postgres://... \
 *     node scripts/ops/preflight-frogger-envelope.mjs
 *
 * Exit 0: nothing above 30 — deploy freely, record the evidence.
 * Exit 1: rows exist — version the season/game or migrate/archive them
 *         explicitly before deploying (do NOT just ship the new cap).
 */

import pg from "pg";

// EXCLUSIVELY the explicit preflight variable (review P2): falling back
// to SMOKE_DATABASE_URL could silently validate a staging database and
// print a false CLEAR for production.
const DB_URL = process.env.PREFLIGHT_DATABASE_URL ?? "";
if (!DB_URL) {
  console.error(
    "usage: PREFLIGHT_DATABASE_URL=postgres://... " +
      "node scripts/ops/preflight-frogger-envelope.mjs",
  );
  process.exit(1);
}

const NEW_MAX = 30;
const client = new pg.Client({ connectionString: DB_URL });
await client.connect();

try {
  const boards = await client.query(
    `SELECT count(*)::int AS n, coalesce(max(score), 0)::int AS worst
       FROM leaderboard_scores
      WHERE game_id = 'frogger' AND score > $1`,
    [NEW_MAX],
  );
  const receipts = await client.query(
    `SELECT count(*)::int AS n,
            coalesce(max((result_snapshot ->> 'score')::int), 0)::int AS worst
       FROM run_attempts
      WHERE game_id = 'frogger'
        AND result_snapshot ->> 'score' IS NOT NULL
        AND (result_snapshot ->> 'score')::int > $1`,
    [NEW_MAX],
  );
  const total = await client.query(
    `SELECT
       (SELECT count(*)::int FROM leaderboard_scores
         WHERE game_id = 'frogger') AS board_rows,
       (SELECT count(*)::int FROM run_attempts
         WHERE game_id = 'frogger') AS attempts`,
  );

  const stamp = new Date().toISOString();
  console.log(`frogger envelope preflight @ ${stamp} (new max ${NEW_MAX})`);
  console.log(
    `  board rows total: ${total.rows[0].board_rows}, ` +
      `attempts total: ${total.rows[0].attempts}`,
  );
  console.log(
    `  board rows > ${NEW_MAX}: ${boards.rows[0].n}` +
      (boards.rows[0].n ? ` (worst ${boards.rows[0].worst})` : ""),
  );
  console.log(
    `  receipts   > ${NEW_MAX}: ${receipts.rows[0].n}` +
      (receipts.rows[0].n ? ` (worst ${receipts.rows[0].worst})` : ""),
  );

  if (boards.rows[0].n > 0 || receipts.rows[0].n > 0) {
    console.error(
      "BLOCKED: historical Frogger scores exceed the new maximum — " +
        "version the season/game or migrate these rows before deploying.",
    );
    process.exit(1);
  }
  console.log(
    "CLEAR: no Frogger score above the new maximum. Record this " +
      "output in docs/games/frogger.md before deploying.",
  );
} finally {
  await client.end();
}
