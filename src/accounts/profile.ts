import { sql } from "drizzle-orm";
import type { Db } from "@/db/client";

const USERNAME_PATTERN = /^[a-z0-9_]{3,20}$/;
const RESERVED_USERNAMES = new Set([
  "admin",
  "administrator",
  "aegyo",
  "aegyoarena",
  "arcade",
  "moderator",
  "official",
  "root",
  "staff",
  "support",
  "system",
]);

export type UsernameValidation =
  { ok: true; username: string } | { ok: false; reason: "format" | "reserved" };

export function validateUsername(value: unknown): UsernameValidation {
  if (typeof value !== "string" || !USERNAME_PATTERN.test(value)) {
    return { ok: false, reason: "format" };
  }
  if (RESERVED_USERNAMES.has(value)) {
    return { ok: false, reason: "reserved" };
  }
  return { ok: true, username: value };
}

type ProfileRow = { username: string };

function rowsOf(result: unknown): ProfileRow[] {
  if (!result || typeof result !== "object" || !("rows" in result)) return [];
  const rows = (result as { rows?: unknown }).rows;
  if (!Array.isArray(rows)) return [];
  return rows.filter((row): row is ProfileRow =>
    Boolean(
      row &&
      typeof row === "object" &&
      "username" in row &&
      typeof row.username === "string",
    ),
  );
}

export async function getCompetitionProfile(
  db: Db,
  memberId: string,
): Promise<{ username: string } | null> {
  const result = await db.execute(sql`
    SELECT username
    FROM competition_profiles
    WHERE member_id = ${memberId}::uuid
    LIMIT 1
  `);
  const row = rowsOf(result)[0];
  return row ? { username: row.username } : null;
}

export type CreateProfileResult =
  | { kind: "created"; username: string }
  | { kind: "existing"; username: string }
  | { kind: "member_already_named"; username: string }
  | { kind: "username_unavailable" };

/** Assign a competition username once. Both uniqueness boundaries are atomic. */
export async function createCompetitionProfile(
  db: Db,
  memberId: string,
  username: string,
): Promise<CreateProfileResult> {
  const inserted = await db.execute(sql`
    INSERT INTO competition_profiles (member_id, username)
    VALUES (${memberId}::uuid, ${username})
    ON CONFLICT DO NOTHING
    RETURNING username
  `);
  const created = rowsOf(inserted)[0];
  if (created) return { kind: "created", username: created.username };

  const current = await getCompetitionProfile(db, memberId);
  if (!current) return { kind: "username_unavailable" };
  if (current.username === username)
    return { kind: "existing", username: current.username };
  return { kind: "member_already_named", username: current.username };
}
