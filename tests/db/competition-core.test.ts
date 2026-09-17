// @vitest-environment node
import { afterAll, beforeAll, beforeEach, describe, expect, it } from "vitest";
import { drizzle } from "drizzle-orm/node-postgres";
import { Pool } from "pg";
import * as schema from "@/db/schema";
import {
  digest,
  enroll,
  issueAttempt,
  receiveTrace,
  recomputeDailyBestTx,
  verifyAttempt,
} from "@/competition/store";
import { publicRound } from "@/competition/read";
import {
  positiveSnakeTraceFixture,
  zeroScoreFlappyTraceFixture,
} from "@/../tests/fixtures/competition-traces";

const url = process.env.TEST_DATABASE_URL;
if (!url) throw new Error("competition DB proof requires TEST_DATABASE_URL");

const A = "10000000-0000-4000-8000-000000000001";
const B = "10000000-0000-4000-8000-000000000002";
const DEVICE = "20000000-0000-4000-8000-000000000001";
const ROUND = "30000000-0000-4000-8000-000000000001";
const SECRET = "synthetic-competition-secret-32-bytes-minimum";
const actor = (memberId = A, sid = `sid-${memberId}`) => ({
  memberId,
  providerSessionId: sid,
  emailVerified: true,
});
const rules = {
  version: 1 as const,
  mode: "synthetic" as const,
  dailyAttempts: 3 as const,
  attemptTtlSeconds: 300,
  games: [
    {
      gameId: "snake" as const,
      calibration: [
        { score: 0, points: 0 },
        { score: 50, points: 500 },
        { score: 100, points: 1000 },
      ],
    },
    {
      gameId: "flappy" as const,
      calibration: [
        { score: 0, points: 0 },
        { score: 10, points: 1000 },
      ],
    },
  ],
};

let pool: Pool;
let db: ReturnType<typeof drizzle<typeof schema>>;

async function scalar(query: string) {
  return Number((await pool.query(query)).rows[0].n);
}
async function seed() {
  await pool.query(
    `INSERT INTO account_members(id,issuer,subject) VALUES ($1,'https://accounts.test/api/auth','a'),($2,'https://accounts.test/api/auth','b')`,
    [A, B],
  );
  await pool.query(
    `INSERT INTO account_sessions(token_hash,member_id,provider_session_id,authenticated_at,provider_checked_at,security_version,password_reset_state,expires_at,email_verified) VALUES ('ta',$1,'sid-${A}',now(),now(),0,'null',now()+interval '1 hour',true),('tb',$2,'sid-${B}',now(),now(),0,'null',now()+interval '1 hour',true)`,
    [A, B],
  );
  await pool.query(
    `INSERT INTO competition_profiles(member_id,username) VALUES ($1,'member_a'),($2,'member_b')`,
    [A, B],
  );
  await pool.query(
    `INSERT INTO competition_rounds(id,slug,rules,status,opens_at,closes_at) VALUES ($1,'synthetic', $2,'open',now()-interval '1 hour',now()+interval '1 hour')`,
    [ROUND, rules],
  );
  await pool.query(
    `INSERT INTO devices(id,generated_handle) VALUES ($1,'guest_untouched')`,
    [DEVICE],
  );
  await pool.query(
    `INSERT INTO device_sessions(token_hash,device_id,expires_at) VALUES ('guest-token',$1,now()+interval '1 day')`,
    [DEVICE],
  );
}
async function enrollActor(memberId = A) {
  await enroll(db, actor(memberId), ROUND, digest(rules));
}
async function manualAttempt(
  memberId: string,
  sid: string,
  fixture:
    | ReturnType<typeof positiveSnakeTraceFixture>
    | ReturnType<typeof zeroScoreFlappyTraceFixture>,
  ordinal = 1,
  expired = false,
) {
  const id = crypto.randomUUID();
  const issued = new Date(Date.now() - Math.ceil(fixture.durationMs) - 250);
  await pool.query(
    `INSERT INTO competition_attempts(id,round_id,member_id,provider_session_id,game_id,day_key,ordinal,idempotency_key,seed,issued_at,expires_at) VALUES($1,$2,$3,$4,$5,to_char(now() at time zone 'UTC','YYYY-MM-DD'),$6,$7,$8,$9,now()+($10::text)::interval)`,
    [
      id,
      ROUND,
      memberId,
      sid,
      fixture.trace.gameId,
      ordinal,
      `manual_fixture_${ordinal}`,
      fixture.trace.seed,
      issued,
      expired ? "-1 second" : "5 minutes",
    ],
  );
  return id;
}

beforeAll(async () => {
  process.env.ARCADE_COMPETITION_ENABLED = "true";
  pool = new Pool({ connectionString: url, max: 35 });
  db = drizzle(pool, { schema });
  await pool.query("SELECT 1");
});
afterAll(async () => {
  await pool.end();
});
it("a scheduled next month cannot hide the currently playable round", async () => {
  const near = crypto.randomUUID();
  const far = crypto.randomUUID();
  await pool.query(
    `INSERT INTO competition_rounds(id,slug,rules,status,opens_at,closes_at) VALUES
    ($1,'next-round',$3,'open',now()+interval '2 days',now()+interval '3 days'),
    ($2,'later-round',$3,'open',now()+interval '4 days',now()+interval '5 days')`,
    [near, far, rules],
  );
  const current = await publicRound(db);
  expect(current.round?.id).toBe(ROUND);
  expect(current.rounds.map((item) => item.slug)).toEqual([
    "later-round",
    "next-round",
    "synthetic",
  ]);
  expect(JSON.stringify(current.rounds)).not.toContain(ROUND);
  expect(Math.abs(Date.parse(current.serverNow!) - Date.now())).toBeLessThan(
    5000,
  );
  await pool.query(
    "UPDATE competition_rounds SET status='closing' WHERE id=$1",
    [ROUND],
  );
  expect((await publicRound(db)).round?.id).toBe(near);
  expect((await publicRound(db, "synthetic")).round?.id).toBe(ROUND);
});
beforeEach(async () => {
  await pool.query(
    `ALTER TABLE competition_ledger DISABLE TRIGGER competition_ledger_no_truncate;
     ALTER TABLE competition_candidate_snapshots DISABLE TRIGGER competition_candidate_snapshots_no_truncate;
     ALTER TABLE competition_final_results DISABLE TRIGGER competition_final_results_no_truncate;
     ALTER TABLE competition_operation_audit DISABLE TRIGGER competition_operation_audit_no_truncate;
     TRUNCATE competition_ledger,competition_daily_best,competition_attempts,competition_challenges,competition_enrollments,competition_rounds,competition_profiles,account_sessions,account_members,device_sessions,devices CASCADE;
     ALTER TABLE competition_ledger ENABLE TRIGGER competition_ledger_no_truncate;
     ALTER TABLE competition_candidate_snapshots ENABLE TRIGGER competition_candidate_snapshots_no_truncate;
     ALTER TABLE competition_final_results ENABLE TRIGGER competition_final_results_no_truncate;
     ALTER TABLE competition_operation_audit ENABLE TRIGGER competition_operation_audit_no_truncate`,
  );
  await seed();
});

describe("competition store on PostgreSQL", () => {
  it("caps 25 concurrent issue requests at three and makes a shared daily challenge", async () => {
    await enrollActor(A);
    await enrollActor(B);
    const settled = await Promise.allSettled(
      Array.from({ length: 25 }, (_, i) =>
        issueAttempt(
          db,
          actor(),
          {
            roundId: ROUND,
            gameId: "snake",
            idempotencyKey: `concurrent_key_${String(i).padStart(2, "0")}`,
          },
          SECRET,
        ),
      ),
    );
    expect(settled.filter((x) => x.status === "fulfilled")).toHaveLength(3);
    expect(
      settled
        .filter((x): x is PromiseRejectedResult => x.status === "rejected")
        .map((x) => x.reason?.code),
    ).toEqual(Array(22).fill("daily_limit_reached"));
    expect(
      await scalar(
        `SELECT count(*) n FROM competition_attempts WHERE member_id='${A}'`,
      ),
    ).toBe(3);
    const b = await issueAttempt(
      db,
      actor(B),
      { roundId: ROUND, gameId: "snake", idempotencyKey: "member_b_shared_01" },
      SECRET,
    );
    const seeds = (
      await pool.query(`SELECT DISTINCT seed FROM competition_attempts`)
    ).rows;
    expect(seeds).toEqual([{ seed: b.seed }]);
    expect(await scalar("SELECT count(*) n FROM competition_challenges")).toBe(
      1,
    );
  });

  it("collapses concurrent idempotent issuance and rejects identity/session misuse", async () => {
    await enrollActor();
    const issued = await Promise.all(
      Array.from({ length: 25 }, () =>
        issueAttempt(
          db,
          actor(),
          {
            roundId: ROUND,
            gameId: "snake",
            idempotencyKey: "same_idempotency_01",
          },
          SECRET,
        ),
      ),
    );
    expect(new Set(issued.map((x) => x.attemptId)).size).toBe(1);
    await expect(
      receiveTrace(
        db,
        actor(B),
        issued[0].attemptId,
        zeroScoreFlappyTraceFixture().trace,
        true,
      ),
    ).rejects.toMatchObject({ code: "attempt_not_found" });
    await expect(
      receiveTrace(
        db,
        actor(A, "other-sid"),
        issued[0].attemptId,
        zeroScoreFlappyTraceFixture().trace,
        true,
      ),
    ).rejects.toMatchObject({ code: "attempt_session_changed" });
    await expect(
      issueAttempt(
        db,
        { ...actor(), emailVerified: false },
        {
          roundId: ROUND,
          gameId: "snake",
          idempotencyKey: "unverified_user_01",
        },
        SECRET,
      ),
    ).rejects.toMatchObject({ code: "email_verification_required" });
  });

  it("quarantines a genuine trace until security confirmation, then awards computed points", async () => {
    await enrollActor();
    const fixture = positiveSnakeTraceFixture();
    const id = await manualAttempt(A, actor().providerSessionId, fixture);
    await receiveTrace(db, actor(), id, fixture.trace, false);
    expect(await verifyAttempt(db, id)).toMatchObject({ status: "pending" });
    expect(await scalar("SELECT count(*) n FROM competition_ledger")).toBe(0);
    const changed = structuredClone(fixture.trace);
    changed.terminal.reason = "quit";
    await expect(
      receiveTrace(db, actor(), id, changed, true),
    ).rejects.toMatchObject({ code: "different_trace_retry" });
    await receiveTrace(db, actor(), id, fixture.trace, true);
    expect(await verifyAttempt(db, id)).toMatchObject({
      status: "verified",
      score: fixture.expectedScore,
      points: 1000,
      dailyPoints: 1000,
    });
    expect(
      await scalar("SELECT coalesce(sum(delta),0) n FROM competition_ledger"),
    ).toBe(1000);
    const publicJson = JSON.stringify(await publicRound(db, "synthetic"));
    expect(publicJson).toContain("member_a");
    expect(publicJson).not.toContain(A);
    expect(publicJson).not.toContain(actor().providerSessionId);
    expect(publicJson).not.toContain("evidenceHash");
  });

  it("recomputes the daily best by delta when a higher result is disqualified", async () => {
    const fixture = zeroScoreFlappyTraceFixture();
    const low = await manualAttempt(A, actor().providerSessionId, fixture, 1);
    const high = await manualAttempt(A, actor().providerSessionId, fixture, 2);
    await pool.query(
      `UPDATE competition_attempts SET status='verified',score=1,points=500,received_at=now() WHERE id=$1`,
      [low],
    );
    await pool.query(
      `UPDATE competition_attempts SET status='verified',score=2,points=1000,received_at=now()+interval '1 second' WHERE id=$1`,
      [high],
    );
    const day = (
      await pool.query(`SELECT day_key FROM competition_attempts WHERE id=$1`, [
        low,
      ])
    ).rows[0].day_key;
    expect(
      await db.transaction((tx) =>
        recomputeDailyBestTx(tx, {
          roundId: ROUND,
          memberId: A,
          gameId: "flappy",
          dayKey: day,
          reason: "proof",
        }),
      ),
    ).toMatchObject({ points: 1000, delta: 1000 });
    await pool.query(
      `UPDATE competition_attempts SET status='void' WHERE id=$1`,
      [high],
    );
    expect(
      await db.transaction((tx) =>
        recomputeDailyBestTx(tx, {
          roundId: ROUND,
          memberId: A,
          gameId: "flappy",
          dayKey: day,
          reason: "dq",
        }),
      ),
    ).toMatchObject({ points: 500, delta: -500 });
    expect(await scalar("SELECT sum(delta) n FROM competition_ledger")).toBe(
      500,
    );
  });

  it("rejects round cutoff/attempt expiry and never mutates guest identity", async () => {
    await enrollActor();
    const fixture = zeroScoreFlappyTraceFixture();
    const id = await manualAttempt(
      A,
      actor().providerSessionId,
      fixture,
      1,
      true,
    );
    await expect(
      receiveTrace(db, actor(), id, fixture.trace, true),
    ).rejects.toMatchObject({ code: "attempt_expired" });
    await pool.query(
      `UPDATE competition_rounds SET status='closing' WHERE id=$1`,
      [ROUND],
    );
    await expect(
      issueAttempt(
        db,
        actor(),
        {
          roundId: ROUND,
          gameId: "snake",
          idempotencyKey: "after_round_cutoff_1",
        },
        SECRET,
      ),
    ).rejects.toMatchObject({ code: "round_not_open" });
    expect(
      (await pool.query("SELECT id,generated_handle FROM devices")).rows,
    ).toEqual([{ id: DEVICE, generated_handle: "guest_untouched" }]);
    expect(
      await scalar(
        "SELECT count(*) n FROM device_sessions WHERE token_hash='guest-token'",
      ),
    ).toBe(1);
  });
});
