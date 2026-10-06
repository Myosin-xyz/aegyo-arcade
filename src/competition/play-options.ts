import { sql } from "drizzle-orm";
import type { Db } from "@/db/client";
import { competitionAttemptDayKey, parseRules } from "./rules";
/** A small read for the game intro; standings and attempt history are not needed. */
export async function activeRoundForGame(db: Db, gameId: string) {
  const materialVisible =
    process.env.ARCADE_MATERIAL_COMPETITION_ENABLED === "true";
  const row = (
    await db.execute(sql`
      SELECT id FROM competition_rounds
       WHERE status = 'open'
         AND opens_at <= statement_timestamp()
         AND closes_at > statement_timestamp()
         AND (rules->>'mode' IN ('synthetic', 'community') OR ${materialVisible})
         AND rules->'games' @> jsonb_build_array(jsonb_build_object('gameId', ${gameId}::text))
       ORDER BY opens_at DESC
       LIMIT 1
    `)
  ).rows[0];
  return row ? String(row.id) : null;
}

export async function isEnrolledForRound(
  db: Db,
  roundId: string,
  memberId: string,
) {
  const result = await db.execute(sql`
    SELECT 1 FROM competition_enrollments
     WHERE round_id = ${roundId}::uuid AND member_id = ${memberId}::uuid
     LIMIT 1
  `);
  return result.rows.length > 0;
}

/** Match the issuer's day key and count, so a game never invites a spent attempt. */
export async function remainingAttemptsForGame(
  db: Db,
  roundId: string,
  memberId: string,
  gameId: string,
) {
  const round = (
    await db.execute(sql`
      SELECT rules, statement_timestamp() AS server_now
        FROM competition_rounds WHERE id = ${roundId}::uuid
    `)
  ).rows[0];
  if (!round) return 0;
  const rules = parseRules(round.rules);
  const day = competitionAttemptDayKey(
    rules,
    new Date(round.server_now as Date | string),
  );
  const used = Number(
    (
      await db.execute(sql`
        SELECT count(*)::int AS count FROM competition_attempts
         WHERE round_id = ${roundId}::uuid
           AND member_id = ${memberId}::uuid
           AND game_id = ${gameId}
           AND day_key = ${day}
      `)
    ).rows[0].count,
  );
  return Math.max(0, rules.dailyAttempts - used);
}
