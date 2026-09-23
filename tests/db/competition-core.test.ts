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
import type { RoundRules } from "@/competition/rules";
import { publicRound } from "@/competition/read";
import { finalizeRound, settleAttempt } from "@/competition/operations-store";
import { competitionOperatorDashboard } from "@/competition/operator-dashboard";
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
const monthlyRules = {
  ...rules,
  version: 2 as const,
  dailyAttempts: 2 as const,
  games: rules.games.map((game) => ({
    gameId: game.gameId,
    calibration: [
      { score: 0, points: 0 },
      { score: 1, points: 5 },
      { score: 50, points: 10 },
      { score: 100, points: 20 },
    ],
  })),
  cadence: "monthly" as const,
  winnerCount: 3 as const,
  scoring: {
    bestPerGame: "week" as const,
    timeZone: "America/New_York",
    fullArenaBonusPoints: 25,
  },
};
const communityRules = {
  ...monthlyRules,
  mode: "community" as const,
  games: [
    ...monthlyRules.games,
    {
      gameId: "perfect-toss" as const,
      calibration: [
        { score: 0, points: 0 },
        { score: 1, points: 20 },
      ],
    },
  ],
  scoring: { ...monthlyRules.scoring, fullArenaBonusPoints: 0 },
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
async function enrollActor(memberId = A, acceptedRules: RoundRules = rules) {
  await enroll(db, actor(memberId), ROUND, digest(acceptedRules));
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
    `INSERT INTO competition_attempts(id,round_id,member_id,provider_session_id,game_id,day_key,score_period_key,ordinal,idempotency_key,seed,issued_at,expires_at) VALUES($1,$2,$3,$4,$5,to_char(now() at time zone 'UTC','YYYY-MM-DD'),to_char(now() at time zone 'UTC','YYYY-MM-DD'),$6,$7,$8,$9,now()+($10::text)::interval)`,
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
it("selects a public community round and marks it as no-prize", async () => {
  await pool.query(
    "UPDATE competition_rounds SET status='closing' WHERE id=$1",
    [ROUND],
  );
  const communityId = crypto.randomUUID();
  await pool.query(
    `INSERT INTO competition_rounds(id,slug,rules,status,opens_at,closes_at)
     VALUES ($1,'community-monthly',$2,'open',now()-interval '1 hour',now()+interval '1 day')`,
    [communityId, communityRules],
  );
  const published = await publicRound(db);
  expect(published.round?.id).toBe(communityId);
  expect(published.round?.mode).toBe("community");
  expect(published.round?.rules.mode).toBe("community");
});
it("does not expose a disabled material round through an explicit slug", async () => {
  const hiddenId = crypto.randomUUID();
  await pool.query(
    `INSERT INTO competition_rounds(id,slug,rules,status,opens_at,closes_at)
     VALUES ($1,'hidden-prize-round',$2,'open',now()-interval '1 hour',now()+interval '1 day')`,
    [hiddenId, { ...monthlyRules, mode: "material_prize" }],
  );
  expect((await publicRound(db, "hidden-prize-round")).round).toBeNull();
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
  it("refuses awards for a public community round", async () => {
    const communityId = crypto.randomUUID();
    await pool.query(
      `INSERT INTO competition_rounds(id,slug,rules,status,opens_at,closes_at)
       VALUES ($1,'community-award-guard',$2,'review',now()-interval '2 days',now()-interval '1 day')`,
      [communityId, communityRules],
    );
    await expect(
      finalizeRound(db, {
        roundId: communityId,
        approvedBy: "operator",
        idempotencyKey: "community-award-guard-01",
        tieDecisions: [],
        awards: [
          {
            memberId: A,
            awardKey: "rank-1",
            allocationRationale: "Should be rejected",
          },
        ],
      }),
    ).rejects.toMatchObject({ code: "community_round_has_no_prizes" });
  });
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
    await expect(
      settleAttempt(db, {
        roundId: ROUND,
        attemptId: id,
        actor: "accounts:operator",
        idempotencyKey: "settle-unconfirmed-0001",
      }),
    ).rejects.toMatchObject({ code: "security_confirmation_required" });
    expect(
      await scalar(
        "SELECT count(*) n FROM competition_operation_audit WHERE operation='settle'",
      ),
    ).toBe(0);
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

  it("settles confirmed evidence and its operator audit atomically", async () => {
    await enrollActor();
    const fixture = positiveSnakeTraceFixture();
    const attemptId = await manualAttempt(
      A,
      actor().providerSessionId,
      fixture,
    );
    await receiveTrace(db, actor(), attemptId, fixture.trace, true);
    const input = {
      roundId: ROUND,
      attemptId,
      actor: "accounts:operator",
      idempotencyKey: "settle-confirmed-0001",
    };
    await expect(settleAttempt(db, input)).resolves.toMatchObject({
      attemptId,
      status: "verified",
      repeated: false,
    });
    await expect(settleAttempt(db, input)).resolves.toMatchObject({
      attemptId,
      status: "verified",
      repeated: true,
    });
    const audit = await pool.query(
      `SELECT actor,payload FROM competition_operation_audit
        WHERE round_id=$1 AND operation='settle'`,
      [ROUND],
    );
    expect(audit.rows).toEqual([
      expect.objectContaining({
        actor: "accounts:operator",
        payload: expect.objectContaining({ attemptId }),
      }),
    ]);
    expect(JSON.stringify(audit.rows)).not.toContain("evidenceHash");
    const dashboard = await competitionOperatorDashboard(db, ROUND);
    expect(dashboard.selected?.attempts).toContainEqual(
      expect.objectContaining({ id: attemptId, status: "verified" }),
    );

    const otherAttempt = await manualAttempt(
      A,
      actor().providerSessionId,
      zeroScoreFlappyTraceFixture(),
      2,
    );
    const otherFixture = zeroScoreFlappyTraceFixture();
    await receiveTrace(db, actor(), otherAttempt, otherFixture.trace, true);
    await expect(
      settleAttempt(db, { ...input, attemptId: otherAttempt }),
    ).rejects.toThrow("Settlement idempotency conflict");
    expect(
      (
        await pool.query(
          "SELECT status FROM competition_attempts WHERE id=$1",
          [otherAttempt],
        )
      ).rows[0].status,
    ).toBe("pending");
  });

  it("never hides pending evidence behind the verified-attempt review limit", async () => {
    const pendingBefore = Number(
      (
        await pool.query(
          "SELECT count(*)::int AS n FROM competition_attempts WHERE round_id=$1 AND status='pending'",
          [ROUND],
        )
      ).rows[0].n,
    );
    await pool.query(
      `INSERT INTO competition_attempts
         (id,round_id,member_id,provider_session_id,game_id,day_key,
          score_period_key,ordinal,idempotency_key,seed,status,score,points,
          issued_at,expires_at,received_at)
       SELECT md5('verified-history-' || series)::uuid,$1,$2,'sid-history',
              'snake',to_char(current_date-series,'YYYY-MM-DD'),
              to_char(current_date-series,'YYYY-MM-DD'),1,
              'verified-history-' || series,'seed','verified',1,1,
              now()-series*interval '1 day',now()+interval '1 day',
              now()+series*interval '1 second'
         FROM generate_series(1,201) AS series`,
      [ROUND, A],
    );
    await pool.query(
      `INSERT INTO competition_attempts
         (id,round_id,member_id,provider_session_id,game_id,day_key,
          score_period_key,ordinal,idempotency_key,seed,status,issued_at,
          expires_at,received_at)
       SELECT md5('pending-history-' || series)::uuid,$1,$2,'sid-pending',
              'snake',to_char(date '2024-01-01'+series,'YYYY-MM-DD'),
              to_char(date '2024-01-01'+series,'YYYY-MM-DD'),2,
              'pending-history-' || series,'seed','pending',
              now()-interval '2 years'+series*interval '1 second',
              now()+interval '1 day',
              now()-interval '2 years'+series*interval '1 second'
         FROM generate_series(1,101) AS series`,
      [ROUND, B],
    );

    const first = await competitionOperatorDashboard(db, ROUND);
    expect(first.selected?.attempts).toHaveLength(300);
    expect(
      first.selected?.attempts.filter(
        (attempt) => attempt.status === "pending",
      ),
    ).toHaveLength(100);
    expect(first.selected?.pendingNextCursor).not.toBeNull();

    const second = await competitionOperatorDashboard(
      db,
      ROUND,
      first.selected?.pendingNextCursor ?? undefined,
    );
    expect(
      second.selected?.attempts.filter(
        (attempt) => attempt.status === "pending",
      ),
    ).toHaveLength(pendingBefore + 1);
    expect(second.selected?.pendingNextCursor).toBeNull();
    expect(
      new Set(
        [
          ...(first.selected?.attempts ?? []),
          ...(second.selected?.attempts ?? []),
        ]
          .filter((attempt) => attempt.status === "pending")
          .map((attempt) => attempt.id),
      ).size,
    ).toBe(pendingBefore + 101);
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

  it("awards and reverses the dynamic full-arena bonus for a weekly scoring period", async () => {
    await pool.query(`DELETE FROM competition_rounds WHERE id=$1`, [ROUND]);
    await pool.query(
      `INSERT INTO competition_rounds(id,slug,rules,status,opens_at,closes_at)
       VALUES ($1,'synthetic',$2,'open',now()-interval '1 hour',now()+interval '1 hour')`,
      [ROUND, monthlyRules],
    );
    const snake = await manualAttempt(
      A,
      actor().providerSessionId,
      positiveSnakeTraceFixture(),
      1,
    );
    const flappy = await manualAttempt(
      A,
      actor().providerSessionId,
      zeroScoreFlappyTraceFixture(),
      2,
    );
    await pool.query(
      `UPDATE competition_attempts SET status='verified',score=50,points=500,received_at=now() WHERE id=$1`,
      [snake],
    );
    await pool.query(
      `UPDATE competition_attempts SET status='verified',score=10,points=1000,received_at=now()+interval '1 second' WHERE id=$1`,
      [flappy],
    );
    const period = (
      await pool.query(
        `SELECT score_period_key FROM competition_attempts WHERE id=$1`,
        [snake],
      )
    ).rows[0].score_period_key;

    await db.transaction((tx) =>
      recomputeDailyBestTx(tx, {
        roundId: ROUND,
        memberId: A,
        gameId: "snake",
        scorePeriodKey: period,
        reason: "monthly-proof-snake",
        rules: monthlyRules,
      }),
    );
    expect(
      await db.transaction((tx) =>
        recomputeDailyBestTx(tx, {
          roundId: ROUND,
          memberId: A,
          gameId: "flappy",
          scorePeriodKey: period,
          reason: "monthly-proof-flappy",
          rules: monthlyRules,
        }),
      ),
    ).toMatchObject({ bonus: { points: 25, delta: 25 } });
    expect(
      await scalar("SELECT coalesce(sum(delta),0) n FROM competition_ledger"),
    ).toBe(1525);

    await pool.query(
      `UPDATE competition_attempts SET status='void' WHERE id=$1`,
      [flappy],
    );
    expect(
      await db.transaction((tx) =>
        recomputeDailyBestTx(tx, {
          roundId: ROUND,
          memberId: A,
          gameId: "flappy",
          scorePeriodKey: period,
          reason: "monthly-proof-disqualification",
          rules: monthlyRules,
        }),
      ),
    ).toMatchObject({ points: 0, bonus: { points: 0, delta: -25 } });
    expect(
      await scalar(
        "SELECT count(*) n FROM competition_period_bonuses WHERE round_id='" +
          ROUND +
          "'",
      ),
    ).toBe(0);
    expect(
      await scalar("SELECT coalesce(sum(delta),0) n FROM competition_ledger"),
    ).toBe(500);
  });

  it("enforces Dai Dai's two-play local-day allowance for monthly rounds", async () => {
    await pool.query(`DELETE FROM competition_rounds WHERE id=$1`, [ROUND]);
    await pool.query(
      `INSERT INTO competition_rounds(id,slug,rules,status,opens_at,closes_at)
       VALUES ($1,'synthetic',$2,'open',now()-interval '1 hour',now()+interval '1 hour')`,
      [ROUND, monthlyRules],
    );
    await enrollActor(A, monthlyRules);
    await expect(
      issueAttempt(
        db,
        actor(),
        {
          roundId: ROUND,
          gameId: "snake",
          idempotencyKey: "monthly_attempt_01",
        },
        SECRET,
      ),
    ).resolves.toMatchObject({ remaining: 1 });
    await expect(
      issueAttempt(
        db,
        actor(),
        {
          roundId: ROUND,
          gameId: "snake",
          idempotencyKey: "monthly_attempt_02",
        },
        SECRET,
      ),
    ).resolves.toMatchObject({ remaining: 0 });
    await expect(
      issueAttempt(
        db,
        actor(),
        {
          roundId: ROUND,
          gameId: "snake",
          idempotencyKey: "monthly_attempt_03",
        },
        SECRET,
      ),
    ).rejects.toMatchObject({ code: "daily_limit_reached" });
  });

  it("blocks direct enrollment and issuance for a restored open material round with unresolved terms", async () => {
    const unresolvedMaterialRules: RoundRules = {
      ...monthlyRules,
      mode: "material_prize",
      rulesUrl: "https://example.test/draft-rules",
      approval: {
        sponsor: "Fixture sponsor",
        operator: "Fixture operator",
        eligibility: "[REQUIRED: geography and age]",
        prizes: "TBD",
        claims: "Pending",
        approvedBy: "Fixture approver",
        schedule: "Pending",
        ties: "Pending",
        engagementSources: "Pending",
      },
    };
    await pool.query(`DELETE FROM competition_rounds WHERE id=$1`, [ROUND]);
    await pool.query(
      `INSERT INTO competition_rounds(id,slug,rules,status,opens_at,closes_at)
       VALUES ($1,'restored-unresolved-material',$2,'open',now()-interval '1 hour',now()+interval '1 hour')`,
      [ROUND, unresolvedMaterialRules],
    );
    process.env.ARCADE_MATERIAL_COMPETITION_ENABLED = "true";
    process.env.ARCADE_COMPETITION_OPERATIONS_ENABLED = "true";
    try {
      await expect(
        enroll(db, actor(), ROUND, digest(unresolvedMaterialRules)),
      ).rejects.toMatchObject({ code: "material_launch_not_ready" });
      await expect(
        issueAttempt(
          db,
          actor(),
          {
            roundId: ROUND,
            gameId: "snake",
            idempotencyKey: "blocked_material_attempt_01",
          },
          SECRET,
        ),
      ).rejects.toMatchObject({ code: "material_launch_not_ready" });
      await pool.query(
        `UPDATE competition_rounds SET status='review' WHERE id=$1`,
        [ROUND],
      );
      await expect(
        finalizeRound(db, {
          roundId: ROUND,
          approvedBy: "fixture-operator",
          idempotencyKey: "blocked-material-finalization-01",
          tieDecisions: [],
          awards: [],
        }),
      ).rejects.toMatchObject({ code: "material_launch_not_ready" });
    } finally {
      delete process.env.ARCADE_MATERIAL_COMPETITION_ENABLED;
      delete process.env.ARCADE_COMPETITION_OPERATIONS_ENABLED;
    }
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
