// @vitest-environment node
import { test, expect } from "vitest";
import { readFileSync, readdirSync } from "node:fs";
import { userInfo } from "node:os";
import { randomUUID } from "node:crypto";
import pg from "pg";
import { drizzle } from "drizzle-orm/node-postgres";
import * as schema from "../../src/db/schema";
import { deleteArcadeAccount } from "../../src/accounts/deletion";

test.skipIf(process.env.AEGYO_DELETION_PG_TEST !== "1")(
  "removes scores and snapshots, preserves peers and immutable evidence, rejects resurrection",
  async () => {
    const name = `arcade_delete_${randomUUID().replaceAll("-", "")}`;
    const options = { host: "/tmp", user: userInfo().username };
    const admin = new pg.Pool({ ...options, database: "postgres" });
    await admin.query(`CREATE DATABASE ${name}`);
    const pool = new pg.Pool({ ...options, database: name });
    try {
      const dir = new URL("../../src/db/migrations/", import.meta.url);
      for (const file of readdirSync(dir)
        .filter((f) => f.endsWith(".sql"))
        .sort())
        await pool.query(readFileSync(new URL(file, dir), "utf8"));
      const issuer = "https://accounts.example.test/api/auth";
      const [member, other, round, snapshot, final] = Array.from(
        { length: 5 },
        () => randomUUID(),
      );
      for (const [id, subject] of [
        [member, "deleted-subject"],
        [other, "remaining-subject"],
      ]) {
        await pool.query(
          "INSERT INTO account_members(id,issuer,subject,display_name) VALUES($1,$2,$3,$3)",
          [id, issuer, subject],
        );
        await pool.query(
          "INSERT INTO competition_profiles(member_id,username) VALUES($1,$2)",
          [id, id === member ? "deleted_fan" : "remaining_fan"],
        );
      }
      await pool.query(
        "INSERT INTO competition_rounds(id,slug,rules,opens_at,closes_at) VALUES($1,'test','{}',now()-interval '1 day',now())",
        [round],
      );
      const standings = [
        { memberId: member, points: 10, finalRank: 1 },
        { memberId: other, points: 9, finalRank: 2 },
      ];
      await pool.query(
        "INSERT INTO competition_candidate_snapshots(id,round_id,standings,game_high_scores,source_digest) VALUES($1,$2,$3,$3,$4)",
        [snapshot, round, JSON.stringify(standings), "a".repeat(64)],
      );
      await pool.query(
        "INSERT INTO competition_final_results(id,round_id,candidate_snapshot_id,standings,review,approved_by) VALUES($1,$2,$3,$4,$5,'operator')",
        [
          final,
          round,
          snapshot,
          JSON.stringify(standings),
          JSON.stringify({ awards: [{ memberId: member, awardKey: "first" }] }),
        ],
      );
      await pool.query(
        "INSERT INTO competition_attempts(round_id,member_id,provider_session_id,game_id,day_key,score_period_key,ordinal,idempotency_key,seed,issued_at,expires_at,score) VALUES($1,$2,'sid','snake','2026-10-01','2026-10-01',1,'test','seed',now(),now()+interval '1 minute',10)",
        [round, member],
      );
      for (const id of [member, other])
        await pool.query(
          "INSERT INTO competition_ledger(round_id,member_id,game_id,day_key,delta,reason) VALUES($1,$2,'snake','2026-10-01',10,'verified')",
          [round, id],
        );
      await expect(
        pool.query("UPDATE competition_candidate_snapshots SET standings='[]'"),
      ).rejects.toThrow();
      const input = {
        requestId: randomUUID(),
        issuer,
        subject: "deleted-subject",
      };
      const db = drizzle(pool, { schema });
      const receipt = await deleteArcadeAccount(db, input);
      expect(receipt.status).toBe("completed");
      expect(
        (await pool.query("SELECT * FROM competition_attempts")).rows,
      ).toHaveLength(0);
      expect(
        (await pool.query("SELECT member_id FROM competition_ledger")).rows,
      ).toEqual([{ member_id: other }]);
      await expect(
        pool.query("DELETE FROM competition_ledger"),
      ).rejects.toThrow("competition_record_immutable");
      expect(
        (
          await pool.query(
            "SELECT standings,source_digest FROM competition_candidate_snapshots",
          )
        ).rows[0],
      ).toEqual({ standings: [standings[1]], source_digest: "a".repeat(64) });
      expect(
        (await pool.query("SELECT standings FROM competition_final_results"))
          .rows[0].standings,
      ).toEqual([standings[1]]);
      expect(
        (await pool.query("SELECT subject FROM account_members")).rows,
      ).toEqual([{ subject: "remaining-subject" }]);
      expect(await deleteArcadeAccount(db, input)).toEqual(receipt);
      await expect(
        deleteArcadeAccount(db, { ...input, subject: "remaining-subject" }),
      ).rejects.toThrow("request_conflict");
      await expect(
        pool.query(
          "INSERT INTO account_members(issuer,subject) VALUES($1,$2)",
          [issuer, input.subject],
        ),
      ).rejects.toThrow("account_deleted");
      await expect(
        pool.query(
          "INSERT INTO competition_profiles(member_id,username) VALUES($1,'resurrected')",
          [member],
        ),
      ).rejects.toThrow();
      await expect(
        pool.query("UPDATE competition_candidate_snapshots SET standings='[]'"),
      ).rejects.toThrow();
      await expect(
        pool.query("DELETE FROM competition_final_results"),
      ).rejects.toThrow();
      await expect(
        pool.query("TRUNCATE competition_operation_audit"),
      ).rejects.toThrow();
      const missing = {
        requestId: randomUUID(),
        issuer,
        subject: "never-local",
      };
      expect((await deleteArcadeAccount(db, missing)).status).toBe("no_link");
      await expect(
        pool.query(
          "INSERT INTO account_members(issuer,subject) VALUES($1,$2)",
          [issuer, missing.subject],
        ),
      ).rejects.toThrow("account_deleted");
    } finally {
      await pool.end();
      await admin.query(`DROP DATABASE ${name}`);
      await admin.end();
    }
  },
  30000,
);
