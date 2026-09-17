// @vitest-environment node
/**
 * Account/device continuity acceptance proof.
 *
 * Anonymous Arcade progress is owned by the device namespace, while the
 * championship is owned by the shared-account member namespace. This test
 * exercises the real persistence APIs against PostgreSQL so a sign-in,
 * account switch, feature-flag change, or guest privacy reset cannot merge
 * or erase those independent histories.
 */

import { afterAll, beforeAll, describe, expect, it } from "vitest";
import { sql } from "drizzle-orm";
import { drizzle } from "drizzle-orm/node-postgres";
import { Pool } from "pg";
import type { Db } from "@/db/client";
import {
  createMemberSession,
  resolveMemberSession,
  revokeMemberSession,
} from "@/accounts/sessions";
import { memberRound, publicRound } from "@/competition/read";
import { digest, enroll, issueAttempt } from "@/competition/store";
import type { RoundRulesV1 } from "@/competition/rules";
import {
  createDeviceSession,
  resolveSession,
  tombstoneDeviceTx,
} from "@/server/identity";
import { issueCountedAttempt, submitCountedResult } from "@/server/runs";

const TEST_URL = process.env.TEST_DATABASE_URL;
const integration = TEST_URL ? describe : describe.skip;
const ROUND = "a0000000-0000-4000-8000-000000000001";
const COMPETITION_SECRET = "continuity-proof-secret-is-at-least-32-bytes";

const rules: RoundRulesV1 = {
  version: 1,
  mode: "synthetic",
  dailyAttempts: 3,
  attemptTtlSeconds: 300,
  games: [
    {
      gameId: "snake",
      calibration: [
        { score: 0, points: 0 },
        { score: 10, points: 1000 },
      ],
    },
  ],
};

integration("account and device namespace continuity", () => {
  let pool: Pool;
  let db: Db;
  const originalCompetitionFlag = process.env.ARCADE_COMPETITION_ENABLED;

  beforeAll(async () => {
    process.env.ARCADE_COMPETITION_ENABLED = "true";
    pool = new Pool({ connectionString: TEST_URL, max: 4 });
    db = drizzle(pool) as unknown as Db;
    await db.execute(sql`
      ALTER TABLE competition_ledger
        DISABLE TRIGGER competition_ledger_no_truncate;
      ALTER TABLE competition_candidate_snapshots
        DISABLE TRIGGER competition_candidate_snapshots_no_truncate;
      ALTER TABLE competition_final_results
        DISABLE TRIGGER competition_final_results_no_truncate;
      ALTER TABLE competition_operation_audit
        DISABLE TRIGGER competition_operation_audit_no_truncate;
      TRUNCATE
        competition_operation_audit,
        competition_award_claims,
        competition_final_results,
        competition_candidate_snapshots,
        competition_ledger,
        competition_period_bonuses,
        competition_period_best,
        competition_daily_best,
        competition_attempts,
        competition_challenges,
        competition_enrollments,
        competition_rounds,
        competition_profiles,
        account_sessions,
        account_members,
        claw_plays,
        prize_claims,
        prize_inventory,
        promotions,
        leaderboard_scores,
        run_attempts,
        daily_slots,
        streaks,
        device_sessions,
        devices,
        ops_audit,
        analytics_outbox
      CASCADE;
      ALTER TABLE competition_ledger
        ENABLE TRIGGER competition_ledger_no_truncate;
      ALTER TABLE competition_candidate_snapshots
        ENABLE TRIGGER competition_candidate_snapshots_no_truncate;
      ALTER TABLE competition_final_results
        ENABLE TRIGGER competition_final_results_no_truncate;
      ALTER TABLE competition_operation_audit
        ENABLE TRIGGER competition_operation_audit_no_truncate;
    `);
  });

  afterAll(async () => {
    if (originalCompetitionFlag === undefined)
      delete process.env.ARCADE_COMPETITION_ENABLED;
    else process.env.ARCADE_COMPETITION_ENABLED = originalCompetitionFlag;
    await pool?.end();
  });

  async function logIn(subject: string, providerSessionId: string) {
    const now = new Date();
    const created = await createMemberSession(db, {
      issuer: "https://accounts.test/api/auth",
      subject,
      providerSessionId,
      emailVerified: true,
      name: subject,
      picture: null,
      authenticatedAtMs: now.getTime(),
      securityVersion: 1,
      resetState: {
        version: 1,
        kind: "database",
        lastPasswordReset: null,
      },
      now,
    });
    const session = await resolveMemberSession(db, created.token, now);
    if (!session) throw new Error(`member session was not created: ${subject}`);
    return { ...created, session };
  }

  async function guestHistory(deviceId: string) {
    const result = await db.execute(sql`
      SELECT
        (SELECT privacy_state FROM devices WHERE id=${deviceId}::uuid) AS "privacyState",
        ARRAY(SELECT id::text FROM run_attempts WHERE device_id=${deviceId}::uuid ORDER BY id) AS "runIds",
        ARRAY(SELECT run_id::text FROM leaderboard_scores WHERE device_id=${deviceId}::uuid ORDER BY run_id) AS "scoreRunIds",
        (SELECT current FROM streaks WHERE device_id=${deviceId}::uuid) AS "currentStreak",
        (SELECT best FROM streaks WHERE device_id=${deviceId}::uuid) AS "bestStreak"
    `);
    return result.rows[0];
  }

  async function competitionEvidence() {
    const result = await db.execute(sql`
      SELECT
        (SELECT count(*)::int FROM account_members) AS members,
        (SELECT count(*)::int FROM competition_profiles) AS profiles,
        (SELECT count(*)::int FROM competition_enrollments WHERE round_id=${ROUND}::uuid) AS enrollments,
        (SELECT count(*)::int FROM competition_attempts WHERE round_id=${ROUND}::uuid) AS attempts,
        (SELECT count(*)::int FROM competition_period_best WHERE round_id=${ROUND}::uuid) AS "periodBests",
        (SELECT count(*)::int FROM competition_ledger WHERE round_id=${ROUND}::uuid) AS "ledgerRows"
    `);
    return result.rows[0];
  }

  async function seedMemberScore(
    memberId: string,
    providerSessionId: string,
    username: string,
    points: number,
    idempotencyKey: string,
  ) {
    await db.execute(sql`
      INSERT INTO competition_profiles(member_id,username)
      VALUES (${memberId}::uuid,${username})
    `);
    const actor = { memberId, providerSessionId, emailVerified: true };
    await enroll(db, actor, ROUND, digest(rules));
    const attempt = await issueAttempt(
      db,
      actor,
      { roundId: ROUND, gameId: "snake", idempotencyKey },
      COMPETITION_SECRET,
    );
    await db.transaction(async (tx) => {
      await tx.execute(sql`
        UPDATE competition_attempts
           SET status='verified', received_at=now(), security_confirmed=true,
               score=${points}, points=${points}
         WHERE id=${attempt.attemptId}::uuid
      `);
      await tx.execute(sql`
        INSERT INTO competition_period_best
          (round_id,member_id,game_id,period_key,attempt_id,points,received_at)
        SELECT round_id,member_id,game_id,score_period_key,id,${points},now()
          FROM competition_attempts WHERE id=${attempt.attemptId}::uuid
      `);
      await tx.execute(sql`
        INSERT INTO competition_ledger
          (round_id,member_id,attempt_id,game_id,day_key,delta,reason)
        SELECT round_id,member_id,id,game_id,day_key,${points},'continuity_acceptance'
          FROM competition_attempts WHERE id=${attempt.attemptId}::uuid
      `);
    });
    return attempt.attemptId;
  }

  it("keeps guest history device-scoped and member history account-scoped across switches, flags, and reset", async () => {
    const guest = await createDeviceSession(db, { timeZone: "Asia/Seoul" });
    const issuedGuestRun = await issueCountedAttempt(db, {
      deviceId: guest.device.deviceId,
      timeZone: guest.device.timeZone,
      gameId: "snake",
    });
    expect(issuedGuestRun.kind).toBe("issued");
    if (issuedGuestRun.kind !== "issued") return;
    await expect(
      submitCountedResult(db, {
        deviceId: guest.device.deviceId,
        attemptId: issuedGuestRun.attemptId,
        score: 7,
      }),
    ).resolves.toMatchObject({ kind: "accepted", streak: { current: 1 } });
    const guestBeforeAccounts = await guestHistory(guest.device.deviceId);

    await db.execute(sql`
      INSERT INTO competition_rounds(id,slug,rules,status,opens_at,closes_at)
      VALUES (${ROUND}::uuid,'account-device-continuity',${JSON.stringify(rules)}::jsonb,
              'open',now()-interval '1 hour',now()+interval '1 hour')
    `);

    const memberAFirstLogin = await logIn("member-a", "provider-session-a1");
    const attemptA = await seedMemberScore(
      memberAFirstLogin.session.memberId,
      memberAFirstLogin.session.providerSessionId,
      "member_a",
      100,
      "continuity-member-a-0001",
    );
    await revokeMemberSession(db, memberAFirstLogin.token);
    expect(await resolveMemberSession(db, memberAFirstLogin.token)).toBeNull();
    expect(await resolveSession(db, guest.token)).toMatchObject({
      deviceId: guest.device.deviceId,
    });
    expect(await guestHistory(guest.device.deviceId)).toEqual(
      guestBeforeAccounts,
    );

    const memberBLogin = await logIn("member-b", "provider-session-b1");
    const attemptB = await seedMemberScore(
      memberBLogin.session.memberId,
      memberBLogin.session.providerSessionId,
      "member_b",
      250,
      "continuity-member-b-0001",
    );
    const memberBView = await memberRound(
      db,
      memberBLogin.session.memberId,
      true,
      ROUND,
    );
    expect(memberBView).toMatchObject({
      username: "member_b",
      totalPoints: 250,
      attempts: [expect.objectContaining({ id: attemptB })],
    });
    expect(memberBView.attempts).not.toEqual(
      expect.arrayContaining([expect.objectContaining({ id: attemptA })]),
    );
    await revokeMemberSession(db, memberBLogin.token);

    const memberASecondLogin = await logIn("member-a", "provider-session-a2");
    expect(memberASecondLogin.session.memberId).toBe(
      memberAFirstLogin.session.memberId,
    );
    const memberAView = await memberRound(
      db,
      memberASecondLogin.session.memberId,
      true,
      ROUND,
    );
    expect(memberAView).toMatchObject({
      username: "member_a",
      totalPoints: 100,
      attempts: [expect.objectContaining({ id: attemptA })],
    });
    expect(memberAView.attempts).not.toEqual(
      expect.arrayContaining([expect.objectContaining({ id: attemptB })]),
    );
    expect(await guestHistory(guest.device.deviceId)).toEqual(
      guestBeforeAccounts,
    );

    const guestBeforeFlagToggle = await guestHistory(guest.device.deviceId);
    const membersBeforeFlagToggle = await competitionEvidence();
    process.env.ARCADE_COMPETITION_ENABLED = "false";
    await expect(
      publicRound(db, "account-device-continuity"),
    ).rejects.toMatchObject({ code: "not_found", status: 404 });
    expect(await guestHistory(guest.device.deviceId)).toEqual(
      guestBeforeFlagToggle,
    );
    expect(await competitionEvidence()).toEqual(membersBeforeFlagToggle);

    process.env.ARCADE_COMPETITION_ENABLED = "true";
    await expect(
      publicRound(db, "account-device-continuity"),
    ).resolves.toMatchObject({
      standings: [
        expect.objectContaining({ username: "member_b", totalPoints: 250 }),
        expect.objectContaining({ username: "member_a", totalPoints: 100 }),
      ],
    });
    expect(await guestHistory(guest.device.deviceId)).toEqual(
      guestBeforeFlagToggle,
    );
    expect(await competitionEvidence()).toEqual(membersBeforeFlagToggle);

    await db.transaction(async (tx) => {
      await tombstoneDeviceTx(tx, guest.device.deviceId);
    });
    expect(await resolveSession(db, guest.token)).toBeNull();
    expect(
      await resolveMemberSession(db, memberASecondLogin.token),
    ).toMatchObject({ memberId: memberASecondLogin.session.memberId });
    expect(await competitionEvidence()).toEqual(membersBeforeFlagToggle);

    const replacementGuest = await createDeviceSession(db, {
      timeZone: "Asia/Seoul",
    });
    expect(replacementGuest.device.deviceId).not.toBe(guest.device.deviceId);
    expect(await guestHistory(replacementGuest.device.deviceId)).toMatchObject({
      privacyState: "active",
      runIds: [],
      scoreRunIds: [],
      currentStreak: null,
      bestStreak: null,
    });
    expect(await guestHistory(guest.device.deviceId)).toMatchObject({
      privacyState: "tombstoned",
      runIds: [issuedGuestRun.attemptId],
      scoreRunIds: [issuedGuestRun.attemptId],
      currentStreak: 1,
      bestStreak: 1,
    });
  }, 20_000);
});
