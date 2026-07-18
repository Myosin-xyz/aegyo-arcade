// @vitest-environment node
/**
 * Database invariant tests against a REAL Postgres (TECH_SPEC §16.2):
 * counted-attempt consumption, idempotency (incl. a deterministic race
 * barrier), monotonic OD-1 cap windows, delete-vs-play atomicity, rolling
 * sessions, and DST/timezone-change day-boundary vectors.
 * Never run against a production database.
 */

import { randomUUID } from "node:crypto";
import { afterAll, beforeAll, beforeEach, describe, expect, it } from "vitest";
import { drizzle, type NodePgDatabase } from "drizzle-orm/node-postgres";
import { Pool } from "pg";
import { eq, sql } from "drizzle-orm";
import * as schema from "@/db/schema";
import {
  analyticsOutbox,
  clawPlays,
  dailySlots,
  devices,
  deviceSessions,
  promotions,
  runAttempts,
} from "@/db/schema";
import { parseConfig, recordClawPlay } from "@/server/claw-play";
import {
  createDeviceSession,
  dayKeyFor,
  deviceLockKey,
  nextLocalMidnight,
  resolveSession,
  tombstoneDeviceTx,
  touchSession,
  validateTimeZone,
} from "@/server/identity";

const TEST_URL =
  process.env.TEST_DATABASE_URL ??
  "postgres://localhost:5432/aegyo_arcade_test";

type Db = NodePgDatabase<typeof schema>;

let pool: Pool;
let db: Db;

beforeAll(async () => {
  pool = new Pool({ connectionString: TEST_URL, max: 10 });
  db = drizzle(pool, { schema });
  await pool.query("SELECT 1"); // fail loudly if the test DB is missing
});

afterAll(async () => {
  await pool.end();
});

beforeEach(async () => {
  await pool.query(
    `TRUNCATE claw_plays, prize_claims, prize_inventory, promotions,
              leaderboard_scores, run_attempts, daily_slots, streaks,
              device_sessions, devices, ops_audit, analytics_outbox CASCADE`,
  );
});

async function seedDemoPromotion(
  overrides: Partial<{
    kind: string;
    status: string;
    dailyCap: number | null;
  }> = {},
) {
  const [row] = await db
    .insert(promotions)
    .values({
      channel: "claw",
      kind: overrides.kind ?? "demo",
      status: overrides.status ?? "active",
      rulesVersion: "demo-1",
      eligibilityVersion: "none",
      oddsVersion: "demo-45-35-20-v1",
      config: {
        weights: { win: 0.45, miss: 0.35, drop: 0.2 },
        dailyCap: overrides.dailyCap === undefined ? null : overrides.dailyCap,
      },
    })
    .returning({ id: promotions.id });
  return row.id;
}

async function seedDevice(timeZone = "America/Mexico_City") {
  return createDeviceSession(db, { timeZone });
}

async function createEntitlementSlot(
  deviceId: string,
  timeZone = "America/Mexico_City",
) {
  // Distinct scope per slot so multi-attempt tests don't collide on the
  // (device, day, scope) unique index — issuance policy is M2's concern;
  // consumption only requires a valid, unused slot.
  const [row] = await db
    .insert(dailySlots)
    .values({
      deviceId,
      dayKey: dayKeyFor(timeZone),
      scopeKey: `test-entitlement:${randomUUID()}`,
      timeZone,
      eligibleAfterAt: nextLocalMidnight(timeZone, new Date()),
    })
    .returning({ id: dailySlots.id });
  return row.id;
}

async function createAttempt(
  deviceId: string,
  overrides: Partial<{
    status: string;
    expiresAt: Date;
    slotId: string | null;
    deviceId: string;
  }> = {},
) {
  const slotId =
    overrides.slotId === undefined
      ? await createEntitlementSlot(overrides.deviceId ?? deviceId)
      : overrides.slotId;
  const [row] = await db
    .insert(runAttempts)
    .values({
      deviceId: overrides.deviceId ?? deviceId,
      gameId: "claw",
      mode: "counted",
      seed: "test-seed",
      status: overrides.status ?? "issued",
      expiresAt: overrides.expiresAt ?? new Date(Date.now() + 10 * 60 * 1000),
      idempotencyKey: `attempt-issue-${randomUUID()}`,
      slotId,
    })
    .returning({ id: runAttempts.id });
  return row.id;
}

interface PlayOptions {
  attemptId?: string;
  timeZone?: string;
}

async function play(
  device: { deviceId: string; timeZone: string },
  idempotencyKey: string,
  options: PlayOptions = {},
) {
  const attemptId = options.attemptId ?? (await createAttempt(device.deviceId));
  return recordClawPlay(db, {
    deviceId: device.deviceId,
    timeZone: options.timeZone ?? device.timeZone,
    idempotencyKey,
    attemptId,
  });
}

describe("counted-attempt consumption (§9.4, B1)", () => {
  it("a play consumes its issued attempt and records the outbox event once", async () => {
    await seedDemoPromotion();
    const { device } = await seedDevice();
    const attemptId = await createAttempt(device.deviceId);
    const result = await play(device, "key-consume-00001", { attemptId });
    expect(result.kind).toBe("played");

    const [attempt] = await db
      .select()
      .from(runAttempts)
      .where(eq(runAttempts.id, attemptId));
    expect(attempt.status).toBe("submitted");
    expect(attempt.submittedAt).not.toBeNull();

    const outbox = await db
      .select()
      .from(analyticsOutbox)
      .where(eq(analyticsOutbox.aggregateId, attemptId));
    expect(outbox).toHaveLength(1);
    expect(outbox[0].eventName).toBe("counted_submit_result");
  });

  it("a consumed attempt cannot back a NEW key; replay of the old key still works", async () => {
    await seedDemoPromotion();
    const { device } = await seedDevice();
    const attemptId = await createAttempt(device.deviceId);
    const first = await play(device, "key-reuse-000001", { attemptId });
    expect(first.kind).toBe("played");

    const reused = await play(device, "key-reuse-000002", { attemptId });
    expect(reused.kind).toBe("invalid_attempt");

    const replay = await play(device, "key-reuse-000001", { attemptId });
    expect(replay.kind).toBe("played");
    if (first.kind === "played" && replay.kind === "played") {
      expect(replay.outcome).toBe(first.outcome);
      expect(replay.replay).toBe(true);
    }
  });

  it("expired, foreign, and non-issued attempts are rejected with no rows", async () => {
    await seedDemoPromotion();
    const { device } = await seedDevice();
    const { device: other } = await seedDevice();

    const expired = await createAttempt(device.deviceId, {
      expiresAt: new Date(Date.now() - 1000),
    });
    expect(
      (await play(device, "key-exp-0000001", { attemptId: expired })).kind,
    ).toBe("invalid_attempt");

    const foreign = await createAttempt(other.deviceId);
    expect(
      (await play(device, "key-for-0000001", { attemptId: foreign })).kind,
    ).toBe("invalid_attempt");

    const voided = await createAttempt(device.deviceId, { status: "void" });
    expect(
      (await play(device, "key-void-000001", { attemptId: voided })).kind,
    ).toBe("invalid_attempt");

    expect(await db.select().from(clawPlays)).toHaveLength(0);
  });

  it("a SLOTLESS counted attempt is rejected (OD-1 cannot be bypassed)", async () => {
    await seedDemoPromotion();
    const { device } = await seedDevice();
    const slotless = await createAttempt(device.deviceId, { slotId: null });
    const result = await play(device, "key-noslot-0001", {
      attemptId: slotless,
    });
    expect(result.kind).toBe("invalid_attempt");
    expect(await db.select().from(clawPlays)).toHaveLength(0);
  });

  it("a second attempt on an already-completed slot returns slot_used", async () => {
    await seedDemoPromotion();
    const { device } = await seedDevice();
    const slotId = await createEntitlementSlot(device.deviceId);
    const first = await createAttempt(device.deviceId, { slotId });
    expect(
      (await play(device, "key-slotused-01", { attemptId: first })).kind,
    ).toBe("played");

    const second = await createAttempt(device.deviceId, { slotId });
    const result = await play(device, "key-slotused-02", {
      attemptId: second,
    });
    expect(result.kind).toBe("slot_used");
    expect(await db.select().from(clawPlays)).toHaveLength(1);
  });

  it("completes the attempt's slot when it has one", async () => {
    await seedDemoPromotion();
    const { device } = await seedDevice();
    const [slot] = await db
      .insert(dailySlots)
      .values({
        deviceId: device.deviceId,
        dayKey: dayKeyFor(device.timeZone),
        scopeKey: "portal",
        timeZone: device.timeZone,
        eligibleAfterAt: nextLocalMidnight(device.timeZone, new Date()),
      })
      .returning({ id: dailySlots.id });
    const attemptId = await createAttempt(device.deviceId, {
      slotId: slot.id,
    });
    await play(device, "key-slot-000001", { attemptId });
    const [updated] = await db
      .select()
      .from(dailySlots)
      .where(eq(dailySlots.id, slot.id));
    expect(updated.completedRunId).toBe(attemptId);
  });
});

describe("idempotency and races (§9.4, B2)", () => {
  it("same key returns the original outcome; one row", async () => {
    await seedDemoPromotion();
    const { device } = await seedDevice();
    const attemptId = await createAttempt(device.deviceId);
    const input = { attemptId };
    const first = await play(device, "key-idem-000001", input);
    const second = await play(device, "key-idem-000001", input);
    expect(first.kind).toBe("played");
    expect(second.kind).toBe("played");
    if (first.kind === "played" && second.kind === "played") {
      expect(second.outcome).toBe(first.outcome);
      expect(second.ordinal).toBe(first.ordinal);
      expect(second.replay).toBe(true);
    }
    expect(await db.select().from(clawPlays)).toHaveLength(1);
  });

  it("concurrent submits with the SAME key produce one row, one outcome", async () => {
    await seedDemoPromotion();
    const { device } = await seedDevice();
    const attemptId = await createAttempt(device.deviceId);
    const results = await Promise.all(
      Array.from({ length: 8 }, () =>
        play(device, "key-race-000001", { attemptId }),
      ),
    );
    const outcomes = new Set(
      results.map((r) => (r.kind === "played" ? r.outcome : r.kind)),
    );
    expect(outcomes.size).toBe(1);
    expect([...outcomes][0]).not.toBe("invalid_attempt");
    expect(await db.select().from(clawPlays)).toHaveLength(1);
  });

  it("DETERMINISTIC race: loser of the advisory lock takes the post-lock replay path", async () => {
    const promotionId = await seedDemoPromotion();
    const { device } = await seedDevice();
    const attemptId = await createAttempt(device.deviceId);
    const key = "key-barrier-0001";

    // Raw client simulates the race winner: holds the device advisory lock
    // with the play already inserted but NOT yet committed.
    const raw = await pool.connect();
    try {
      await raw.query("BEGIN");
      await raw.query("SELECT pg_advisory_xact_lock(hashtextextended($1, 0))", [
        deviceLockKey(device.deviceId),
      ]);
      await raw.query(
        `INSERT INTO claw_plays
           (promotion_id, attempt_id, device_id, day_key, ordinal, outcome, idempotency_key)
         VALUES ($1, $2, $3, $4, 1, 'miss', $5)`,
        [promotionId, attemptId, device.deviceId, "2026-01-01", key],
      );

      // The loser arrives while the lock is held: its PRE-lock check sees
      // nothing (uncommitted row), then it blocks on the advisory lock.
      const loser = play(device, key, { attemptId });
      await new Promise((r) => setTimeout(r, 150)); // ensure it's blocked
      await raw.query("COMMIT"); // winner commits, lock releases

      const result = await loser;
      expect(result.kind).toBe("played");
      if (result.kind === "played") {
        expect(result.outcome).toBe("miss"); // the WINNER's outcome
        expect(result.ordinal).toBe(1);
        expect(result.replay).toBe(true);
      }
      expect(await db.select().from(clawPlays)).toHaveLength(1);
    } finally {
      raw.release();
    }
  });

  it("retry after promotion pause still returns the original outcome", async () => {
    const promotionId = await seedDemoPromotion();
    const { device } = await seedDevice();
    const attemptId = await createAttempt(device.deviceId);
    const first = await play(device, "key-pause-000001", { attemptId });
    await db
      .update(promotions)
      .set({ status: "paused" })
      .where(eq(promotions.id, promotionId));
    const second = await play(device, "key-pause-000001", { attemptId });
    expect(second.kind).toBe("played");
    if (first.kind === "played" && second.kind === "played") {
      expect(second.outcome).toBe(first.outcome);
      expect(second.replay).toBe(true);
    }
    const fresh = await play(device, "key-pause-000002");
    expect(fresh.kind).toBe("no_active_promotion");
  });
});

describe("caps and monotonic windows (§9.4, OD-1, B4)", () => {
  it("daily cap is enforced; concurrent different keys get gap-free ordinals", async () => {
    await seedDemoPromotion();
    const { device } = await seedDevice();
    const results = await Promise.all(
      Array.from({ length: 8 }, (_, i) =>
        play(device, `key-multi-${String(i).padStart(6, "0")}`),
      ),
    );
    const ordinals = results
      .map((r) => (r.kind === "played" ? r.ordinal : -1))
      .sort((a, b) => a - b);
    expect(ordinals).toEqual([1, 2, 3, 4, 5, 6, 7, 8]);
  });

  it("dailyCap 0 blocks every play (distinct from unlimited)", async () => {
    await seedDemoPromotion({ dailyCap: 0 });
    const { device } = await seedDevice();
    const result = await play(device, "key-cap0-000001");
    expect(result.kind).toBe("cap_reached");
    if (result.kind === "cap_reached") expect(result.cap).toBe(0);
    expect(await db.select().from(clawPlays)).toHaveLength(0);
  });

  it("dailyCap 2 stops the third play", async () => {
    await seedDemoPromotion({ dailyCap: 2 });
    const { device } = await seedDevice();
    expect((await play(device, "key-cap-000001")).kind).toBe("played");
    expect((await play(device, "key-cap-000002")).kind).toBe("played");
    expect((await play(device, "key-cap-000003")).kind).toBe("cap_reached");
    expect(await db.select().from(clawPlays)).toHaveLength(2);
  });

  it("a timezone hop cannot reset the cap window (monotonic boundary)", async () => {
    await seedDemoPromotion({ dailyCap: 1 });
    const { device } = await seedDevice("America/Mexico_City");
    expect((await play(device, "key-hop-000001")).kind).toBe("played");

    // Hop to a zone where the local DATE is already tomorrow. The window's
    // absolute boundary hasn't passed, so the cap must hold.
    const hopped = await play(device, "key-hop-000002", {
      timeZone: "Pacific/Auckland",
    });
    expect(hopped.kind).toBe("cap_reached");

    // Only one CAP window exists (entitlement slots are separate), and its
    // boundary is in the future.
    const slots = await db
      .select()
      .from(dailySlots)
      .where(eq(dailySlots.deviceId, device.deviceId));
    const capWindows = slots.filter((s) => s.scopeKey.startsWith("claw:"));
    expect(capWindows).toHaveLength(1);
    expect(capWindows[0].eligibleAfterAt.getTime()).toBeGreaterThan(Date.now());
  });

  it("after-boundary westward timezone change reuses the existing dayKey slot", async () => {
    const promotionId = await seedDemoPromotion({ dailyCap: 5 });
    const { device } = await seedDevice("America/Bogota");
    // Pre-existing cap window for TODAY (Bogota dayKey) whose boundary has
    // already passed — the Seoul-then-back-to-Bogota scenario.
    const bogotaDayKey = dayKeyFor("America/Bogota");
    await db.insert(dailySlots).values({
      deviceId: device.deviceId,
      dayKey: bogotaDayKey,
      scopeKey: `claw:${promotionId}`,
      timeZone: "Asia/Seoul",
      eligibleAfterAt: new Date(Date.now() - 60 * 1000), // expired
    });

    // The next play must UPSERT (reuse/extend) that slot, not crash on the
    // unique index.
    const result = await play(device, "key-rollover-01", {
      timeZone: "America/Bogota",
    });
    expect(result.kind).toBe("played");

    const capSlots = await db
      .select()
      .from(dailySlots)
      .where(eq(dailySlots.scopeKey, `claw:${promotionId}`));
    expect(capSlots).toHaveLength(1);
    expect(capSlots[0].dayKey).toBe(bogotaDayKey);
    // Boundary moved LATER only (monotonic).
    expect(capSlots[0].eligibleAfterAt.getTime()).toBeGreaterThan(Date.now());
  });

  it("material_prize configurations are refused in M1", async () => {
    await seedDemoPromotion({ kind: "material_prize" });
    const { device } = await seedDevice();
    expect((await play(device, "key-mat-0000001")).kind).toBe(
      "material_prize_disabled",
    );
    expect(await db.select().from(clawPlays)).toHaveLength(0);
  });

  it("only one active promotion per channel can exist (partial unique)", async () => {
    await seedDemoPromotion();
    await expect(seedDemoPromotion()).rejects.toThrow();
  });
});

describe("promotion config validation (B3)", () => {
  it("rejects negative weights, zero totals, and bad caps; distinguishes cap 0", () => {
    const weights = { win: 0.4, miss: 0.4, drop: 0.2 };
    expect(parseConfig({ weights, dailyCap: null })?.dailyCap).toBeNull();
    expect(parseConfig({ weights })?.dailyCap).toBeNull();
    expect(parseConfig({ weights, dailyCap: 0 })?.dailyCap).toBe(0);
    expect(parseConfig({ weights, dailyCap: 3.9 })?.dailyCap).toBe(3);
    expect(parseConfig({ weights, dailyCap: -1 })).toBeNull();
    expect(parseConfig({ weights, dailyCap: "many" })).toBeNull();
    expect(
      parseConfig({ weights: { win: -0.1, miss: 0.6, drop: 0.5 } }),
    ).toBeNull();
    expect(parseConfig({ weights: { win: 0, miss: 0, drop: 0 } })).toBeNull();
    expect(
      parseConfig({ weights: { win: Infinity, miss: 0, drop: 0 } }),
    ).toBeNull();
    expect(parseConfig(null)).toBeNull();
  });
});

describe("privacy deletion vs gameplay (§8.1, B5)", () => {
  it("a play racing a committed deletion is rejected and leaves no rows", async () => {
    await seedDemoPromotion();
    const { device } = await seedDevice();
    await play(device, "key-del-0000001"); // pre-existing demo row

    const raw = await pool.connect();
    try {
      await raw.query("BEGIN");
      await raw.query("SELECT pg_advisory_xact_lock(hashtextextended($1, 0))", [
        deviceLockKey(device.deviceId),
      ]);
      // Deletion inside the lock: demo rows out, device tombstoned.
      await raw.query("DELETE FROM claw_plays WHERE device_id = $1", [
        device.deviceId,
      ]);
      await raw.query(
        `UPDATE devices SET privacy_state = 'tombstoned',
           generated_handle = NULL, avatar_emoji = NULL WHERE id = $1`,
        [device.deviceId],
      );
      await raw.query(
        "UPDATE device_sessions SET revoked_at = now() WHERE device_id = $1",
        [device.deviceId],
      );

      // Concurrent play blocks on the shared device lock...
      const racing = play(device, "key-del-0000002");
      await new Promise((r) => setTimeout(r, 150));
      await raw.query("COMMIT");

      // ...and after the deletion commits, it must see the tombstone.
      expect((await racing).kind).toBe("device_gone");
      expect(await db.select().from(clawPlays)).toHaveLength(0);
    } finally {
      raw.release();
    }
  });

  it("tombstoneDeviceTx revokes sessions and hides the device", async () => {
    const created = await seedDevice();
    await db.transaction(async (tx) => {
      await tombstoneDeviceTx(tx, created.device.deviceId);
    });
    expect(await resolveSession(db, created.token)).toBeNull();
  });
});

describe("identity (§8.1, B4)", () => {
  it("sessions ROLL: activity extends both expiry and returns the new date", async () => {
    const created = await seedDevice();
    const before = await db
      .select({ expiresAt: deviceSessions.expiresAt })
      .from(deviceSessions);
    // Backdate so the extension is observable.
    await db
      .update(deviceSessions)
      .set({ expiresAt: new Date(Date.now() + 1000) });
    const { expiresAt } = await touchSession(db, created.token, created.device);
    const after = await db
      .select({ expiresAt: deviceSessions.expiresAt })
      .from(deviceSessions);
    expect(after[0].expiresAt.getTime()).toBeGreaterThan(
      Date.now() + 80 * 24 * 60 * 60 * 1000,
    );
    expect(expiresAt).not.toBeNull();
    expect(after[0].expiresAt.getTime()).toBe(expiresAt!.getTime());
    expect(before[0].expiresAt.getTime()).toBeGreaterThan(0);
  });

  it("a timezone change stamps time_zone_changed_at; same zone does not", async () => {
    const created = await seedDevice("America/Mexico_City");
    await touchSession(
      db,
      created.token,
      created.device,
      "America/Mexico_City",
    );
    let [row] = await db.select().from(devices);
    expect(row.timeZoneChangedAt).toBeNull();

    await touchSession(db, created.token, created.device, "Asia/Seoul");
    [row] = await db.select().from(devices);
    expect(row.timeZone).toBe("Asia/Seoul");
    expect(row.timeZoneChangedAt).not.toBeNull();
  });

  it("touchSession after deletion writes nothing onto the tombstone", async () => {
    const created = await seedDevice();
    await db.transaction(async (tx) => {
      await tombstoneDeviceTx(tx, created.device.deviceId);
    });
    const before = await db.select().from(devices);
    const touched = await touchSession(
      db,
      created.token,
      created.device,
      "Asia/Seoul",
    );
    expect(touched.expiresAt).toBeNull();
    const after = await db.select().from(devices);
    expect(after[0].timeZone).toBe(before[0].timeZone); // no tz write
    expect(after[0].lastSeenAt.getTime()).toBe(
      before[0].lastSeenAt.getTime(), // no activity write
    );
  });

  it("raw tokens are never stored", async () => {
    const created = await seedDevice();
    const rows = await db.execute(sql`SELECT token_hash FROM device_sessions`);
    const hashes = (rows.rows as { token_hash: string }[]).map(
      (r) => r.token_hash,
    );
    expect(hashes).toHaveLength(1);
    expect(hashes[0]).not.toBe(created.token);
    expect(hashes[0]).toMatch(/^[0-9a-f]{64}$/);
  });
});

describe("day boundaries (OD-1 vectors, B4)", () => {
  it("timezone validation falls back to UTC; dayKey derives locally", () => {
    expect(validateTimeZone("America/Bogota")).toBe("America/Bogota");
    expect(validateTimeZone("Not/AZone")).toBe("UTC");
    expect(validateTimeZone(42)).toBe("UTC");
    const at = new Date("2026-01-02T03:00:00Z");
    expect(dayKeyFor("America/Mexico_City", at)).toBe("2026-01-01");
    expect(dayKeyFor("UTC", at)).toBe("2026-01-02");
  });

  it("nextLocalMidnight: plain zones", () => {
    const at = new Date("2026-01-02T03:00:00Z");
    expect(nextLocalMidnight("UTC", at).toISOString()).toBe(
      "2026-01-03T00:00:00.000Z",
    );
    // Local Jan 1 21:00 in Mexico City (UTC-6) → next local midnight is
    // Jan 2 00:00 local = 06:00Z.
    expect(nextLocalMidnight("America/Mexico_City", at).toISOString()).toBe(
      "2026-01-02T06:00:00.000Z",
    );
  });

  it("nextLocalMidnight: DST spring-forward and fall-back (America/New_York)", () => {
    // 2026-03-08: EST→EDT. At 06:00Z (01:00 EST), next local midnight is
    // Mar 9 00:00 EDT = 04:00Z (not 05:00Z).
    const springForward = new Date("2026-03-08T06:00:00Z");
    expect(
      nextLocalMidnight("America/New_York", springForward).toISOString(),
    ).toBe("2026-03-09T04:00:00.000Z");

    // 2026-11-01: EDT→EST. At 04:30Z (00:30 EDT), next local midnight is
    // Nov 2 00:00 EST = 05:00Z (not 04:00Z).
    const fallBack = new Date("2026-11-01T04:30:00Z");
    expect(nextLocalMidnight("America/New_York", fallBack).toISOString()).toBe(
      "2026-11-02T05:00:00.000Z",
    );
  });
});

describe("outbox identity (B3)", () => {
  it("the same aggregate event enqueues only once", async () => {
    const insert = () =>
      db
        .insert(analyticsOutbox)
        .values({
          aggregateType: "run_attempt",
          aggregateId: "00000000-0000-0000-0000-000000000001",
          eventName: "counted_submit_result",
          payload: { gameId: "claw", accepted: true },
        })
        .onConflictDoNothing();
    await insert();
    await insert();
    expect(await db.select().from(analyticsOutbox)).toHaveLength(1);
  });
});
