/**
 * Ops: activate the claw DEMO promotion (TECH_SPEC §9.4, §14, §18).
 *
 * Demo mode is the non-prize public/test path — gameplay outcome only; it
 * cannot create inventory reservations or claim tokens. Promotion state
 * changes happen only through audited ops scripts like this one.
 *
 * Usage:
 *   DATABASE_URL=... node scripts/ops/activate-demo-claw.mjs --reason "M1 demo" --yes
 */

import { Pool } from "pg";
import { userInfo } from "node:os";

const args = process.argv.slice(2);
const yes = args.includes("--yes");
const reasonIx = args.indexOf("--reason");
const reason = reasonIx >= 0 ? args[reasonIx + 1] : null;

if (!process.env.DATABASE_URL) {
  console.error("DATABASE_URL is required");
  process.exit(1);
}
if (!reason) {
  console.error('--reason "<why>" is required (written to ops_audit)');
  process.exit(1);
}
if (!yes) {
  console.error(
    "This MUTATES promotion state. Re-run with --yes to confirm.\n" +
      `Target: ${new URL(process.env.DATABASE_URL).host}`,
  );
  process.exit(1);
}

const CONFIG = {
  weights: { win: 0.45, miss: 0.35, drop: 0.2 },
  dailyCap: null, // demo: unlimited plays; OD-1 governs counted runs, not demo drops
};

const actor = process.env.OPS_ACTOR ?? userInfo().username ?? "unknown";

const pool = new Pool({ connectionString: process.env.DATABASE_URL });
const client = await pool.connect();
try {
  await client.query("BEGIN");
  const existing = await client.query(
    "SELECT id, kind, status FROM promotions WHERE channel = 'claw' AND status = 'active'",
  );
  if (existing.rows.length > 0) {
    console.log("Active claw promotion already exists:", existing.rows[0]);
    await client.query("ROLLBACK");
    process.exit(0);
  }
  const inserted = await client.query(
    `INSERT INTO promotions
       (channel, kind, status, rules_version, eligibility_version, odds_version, config)
     VALUES ('claw', 'demo', 'active', 'demo-1', 'none', 'demo-45-35-20-v1', $1)
     RETURNING id`,
    [JSON.stringify(CONFIG)],
  );
  const promotionId = inserted.rows[0].id;
  await client.query(
    `INSERT INTO ops_audit (actor, action, target_type, target_id, reason, before_json, after_json)
     VALUES ($1, 'promotion.activate', 'promotion', $2, $3, NULL, $4)`,
    [actor, promotionId, reason, JSON.stringify({ kind: "demo", ...CONFIG })],
  );
  await client.query("COMMIT");
  console.log(
    `Demo claw promotion activated: ${promotionId} (actor: ${actor})`,
  );
} catch (error) {
  await client.query("ROLLBACK");
  throw error;
} finally {
  client.release();
  await pool.end();
}
