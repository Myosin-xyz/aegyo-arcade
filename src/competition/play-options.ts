import { sql } from "drizzle-orm";
import type { Db } from "@/db/client";
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
