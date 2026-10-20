import { createHash, timingSafeEqual, randomUUID } from "node:crypto";
import { sql } from "drizzle-orm";
import type { Db } from "@/db/client";

export type DeletionInput = {
  requestId: string;
  issuer: string;
  subject: string;
};
export function deletionAuthorized(header: string | null): boolean {
  const key = process.env.AEGYO_ACCOUNT_DELETION_KEY;
  if (!key || key.length < 32 || !header || header.length > 1024) return false;
  const hash = (v: string) => createHash("sha256").update(v).digest();
  return timingSafeEqual(hash(header), hash(`Bearer ${key}`));
}
export function deletionInput(value: unknown): DeletionInput | null {
  if (!value || typeof value !== "object") return null;
  const v = value as Record<string, unknown>;
  const base = process.env.ARCADE_AUTH_BASE_URL;
  return typeof v.requestId === "string" &&
    /^[0-9a-f]{8}-[0-9a-f]{4}-[1-8][0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/i.test(
      v.requestId,
    ) &&
    Boolean(base) &&
    v.issuer === `${base}/api/auth` &&
    typeof v.subject === "string" &&
    v.subject.length > 0 &&
    v.subject.length <= 200
    ? (v as DeletionInput)
    : null;
}

export async function deleteArcadeAccount(db: Db, input: DeletionInput) {
  return db.transaction(async (tx) => {
    await tx.execute(sql`SET LOCAL statement_timeout='12s'`);
    await tx.execute(
      sql`SELECT pg_advisory_xact_lock(hashtext(${input.issuer + ":" + input.subject}))`,
    );
    const prior = (
      await tx.execute(sql`SELECT * FROM account_deletion_receipts
      WHERE request_id=${input.requestId}::uuid OR (issuer=${input.issuer} AND subject=${input.subject})`)
    ).rows[0];
    if (prior) {
      if (prior.issuer !== input.issuer || prior.subject !== input.subject)
        throw new Error("request_conflict");
      return {
        ...(prior.manifest as { status: string; [key: string]: unknown }),
        requestId: input.requestId,
      };
    }
    // Lock rounds before the member, matching competition writers. This also serializes snapshot creation.
    const rounds = (
      await tx.execute(sql`SELECT id FROM competition_rounds ORDER BY id`)
    ).rows;
    for (const round of rounds)
      await tx.execute(
        sql`SELECT pg_advisory_xact_lock(hashtextextended(${`competition-round:${round.id}`},0))`,
      );
    const member = (
      await tx.execute(
        sql`SELECT id FROM account_members WHERE issuer=${input.issuer} AND subject=${input.subject} FOR UPDATE`,
      )
    ).rows[0];
    const removed: Record<string, number> = {};
    // The receipt authorizes only exact competitor redaction in the immutable snapshot trigger.
    await tx.execute(sql`INSERT INTO account_deletion_receipts(request_id,issuer,subject,member_id,manifest)
      VALUES(${input.requestId}::uuid,${input.issuer},${input.subject},${member?.id ?? null}::uuid,'{}')`);
    if (member) {
      for (const [table, fields] of [
        ["competition_candidate_snapshots", ["standings", "game_high_scores"]],
        ["competition_final_results", ["standings", "review"]],
        ["competition_operation_audit", ["payload"]],
      ] as const) {
        const assignments = fields
          .map(
            (f) =>
              `${f}=COALESCE(aegyo_redact_deleted_competitors(${f}),'null'::jsonb)`,
          )
          .join(",");
        const changed = fields
          .map(
            (f) =>
              `${f} IS DISTINCT FROM COALESCE(aegyo_redact_deleted_competitors(${f}),'null'::jsonb)`,
          )
          .join(" OR ");
        removed[`${table}_redacted`] =
          (
            await tx.execute(
              sql.raw(`UPDATE ${table} SET ${assignments} WHERE ${changed}`),
            )
          ).rowCount ?? 0;
      }
      for (const table of [
        "competition_award_claims",
        "competition_daily_best",
        "competition_period_best",
        "competition_period_bonuses",
        "competition_ledger",
        "competition_attempts",
        "competition_enrollments",
        "competition_profiles",
        "account_sessions",
      ]) {
        removed[table] =
          (
            await tx.execute(
              sql`DELETE FROM ${sql.identifier(table)} WHERE member_id=${member.id}::uuid`,
            )
          ).rowCount ?? 0;
      }
      removed.account_members =
        (
          await tx.execute(
            sql`DELETE FROM account_members WHERE id=${member.id}::uuid`,
          )
        ).rowCount ?? 0;
      for (const round of rounds)
        await tx.execute(sql`INSERT INTO competition_operation_audit(id,round_id,operation,actor,idempotency_key,payload)
        VALUES(${randomUUID()}::uuid,${round.id}::uuid,'account_deletion_redaction','account-deletion',${input.requestId},
        ${JSON.stringify({ requestId: input.requestId, originalSourceDigestPreserved: true })}::jsonb)`);
    }
    const manifest = {
      requestId: input.requestId,
      status: member ? "completed" : "no_link",
      removed,
      retained: [
        "deletion_receipt",
        "original_snapshot_digest",
        "unlinked_anonymous_device_history",
      ],
    };
    await tx.execute(
      sql`UPDATE account_deletion_receipts SET manifest=${JSON.stringify(manifest)}::jsonb WHERE request_id=${input.requestId}::uuid`,
    );
    return manifest;
  });
}
