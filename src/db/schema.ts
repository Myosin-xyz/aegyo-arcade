/**
 * Database model — TECH_SPEC §9.1, complete, including tables whose
 * endpoints arrive in M2+ (daily slots, run attempts, streaks, boards,
 * prize inventory/claims). Correctness lives in constraints and
 * transactions, not rate limits (§9.2–§9.4).
 *
 * `giveaway_entries` is deliberately absent (OD-5).
 */

import { sql } from "drizzle-orm";
import {
  boolean,
  check,
  index,
  integer,
  jsonb,
  pgTable,
  primaryKey,
  text,
  timestamp,
  uniqueIndex,
  uuid,
  type AnyPgColumn,
} from "drizzle-orm/pg-core";

export const devices = pgTable(
  "devices",
  {
    id: uuid("id").primaryKey().defaultRandom(),
    locale: text("locale").notNull().default("en"),
    generatedHandle: text("generated_handle"),
    avatarEmoji: text("avatar_emoji"),
    // Validated IANA timezone (OD-1); server-derived day keys only.
    timeZone: text("time_zone").notNull().default("UTC"),
    // Set whenever the persisted timezone actually changes (OD-1 boundary
    // auditing; the monotonic guard itself lives on daily_slots).
    timeZoneChangedAt: timestamp("time_zone_changed_at", {
      withTimezone: true,
    }),
    privacyState: text("privacy_state").notNull().default("active"),
    createdAt: timestamp("created_at", { withTimezone: true })
      .notNull()
      .defaultNow(),
    lastSeenAt: timestamp("last_seen_at", { withTimezone: true })
      .notNull()
      .defaultNow(),
  },
  (table) => [
    check(
      "devices_privacy_state",
      sql`${table.privacyState} IN ('active', 'tombstoned')`,
    ),
  ],
);

export const deviceSessions = pgTable("device_sessions", {
  tokenHash: text("token_hash").primaryKey(),
  deviceId: uuid("device_id")
    .notNull()
    .references(() => devices.id),
  createdAt: timestamp("created_at", { withTimezone: true })
    .notNull()
    .defaultNow(),
  expiresAt: timestamp("expires_at", { withTimezone: true }).notNull(),
  revokedAt: timestamp("revoked_at", { withTimezone: true }),
});

export const dailySlots = pgTable(
  "daily_slots",
  {
    id: uuid("id").primaryKey().defaultRandom(),
    deviceId: uuid("device_id")
      .notNull()
      .references(() => devices.id),
    dayKey: text("day_key").notNull(),
    scopeKey: text("scope_key").notNull(),
    policyVersion: integer("policy_version").notNull().default(1),
    timeZone: text("time_zone").notNull(),
    // Absolute instant when this slot's local day ends (OD-1). Monotonic
    // per (device, scope): a timezone change can never move it earlier.
    eligibleAfterAt: timestamp("eligible_after_at", {
      withTimezone: true,
    }).notNull(),
    completedRunId: uuid("completed_run_id").references(
      (): AnyPgColumn => runAttempts.id,
    ),
    createdAt: timestamp("created_at", { withTimezone: true })
      .notNull()
      .defaultNow(),
  },
  (table) => [
    uniqueIndex("daily_slots_device_day_scope").on(
      table.deviceId,
      table.dayKey,
      table.scopeKey,
    ),
    check("daily_slots_policy_positive", sql`${table.policyVersion} > 0`),
  ],
);

export const runAttempts = pgTable(
  "run_attempts",
  {
    id: uuid("id").primaryKey().defaultRandom(),
    slotId: uuid("slot_id").references(() => dailySlots.id),
    deviceId: uuid("device_id")
      .notNull()
      .references(() => devices.id),
    gameId: text("game_id").notNull(),
    mode: text("mode").notNull(), // "counted" only — practice runs never persist (§9.1)
    attemptNo: integer("attempt_no").notNull().default(1),
    seed: text("seed").notNull(),
    status: text("status").notNull().default("issued"), // issued|submitted|expired|void
    score: integer("score"),
    clientDurationMs: integer("client_duration_ms"),
    serverElapsedMs: integer("server_elapsed_ms"),
    issuedAt: timestamp("issued_at", { withTimezone: true })
      .notNull()
      .defaultNow(),
    expiresAt: timestamp("expires_at", { withTimezone: true }).notNull(),
    submittedAt: timestamp("submitted_at", { withTimezone: true }),
    // Immutable acceptance receipt {score, seasonKey, rank, streak} — a
    // submission replay returns THIS, never recomputed values (M2 review).
    resultSnapshot: jsonb("result_snapshot"),
    idempotencyKey: text("idempotency_key").notNull(),
  },
  (table) => [
    check("run_attempts_mode", sql`${table.mode} IN ('counted')`),
    check(
      "run_attempts_status",
      sql`${table.status} IN ('issued', 'submitted', 'expired', 'void')`,
    ),
    check("run_attempts_attempt_no_positive", sql`${table.attemptNo} > 0`),
    check(
      "run_attempts_score_non_negative",
      sql`${table.score} IS NULL OR ${table.score} >= 0`,
    ),
    uniqueIndex("run_attempts_device_idem").on(
      table.deviceId,
      table.idempotencyKey,
    ),
    uniqueIndex("run_attempts_one_issued_per_slot")
      .on(table.slotId)
      .where(sql`${table.status} = 'issued'`),
    uniqueIndex("run_attempts_one_submitted_per_slot")
      .on(table.slotId)
      .where(sql`${table.status} = 'submitted'`),
  ],
);

export const streaks = pgTable(
  "streaks",
  {
    deviceId: uuid("device_id")
      .primaryKey()
      .references(() => devices.id),
    current: integer("current").notNull().default(0),
    best: integer("best").notNull().default(0),
    lastDayKey: text("last_day_key"),
    updatedAt: timestamp("updated_at", { withTimezone: true })
      .notNull()
      .defaultNow(),
  },
  (table) => [
    check(
      "streaks_non_negative",
      sql`${table.current} >= 0 AND ${table.best} >= 0`,
    ),
  ],
);

export const leaderboardScores = pgTable(
  "leaderboard_scores",
  {
    runId: uuid("run_id")
      .primaryKey()
      .references(() => runAttempts.id),
    deviceId: uuid("device_id")
      .notNull()
      .references(() => devices.id),
    gameId: text("game_id").notNull(),
    seasonKey: text("season_key").notNull(),
    score: integer("score").notNull(),
    acceptedAt: timestamp("accepted_at", { withTimezone: true })
      .notNull()
      .defaultNow(),
    flagged: boolean("flagged").notNull().default(false),
  },
  (table) => [
    // Board sort + rank counting (M2 review P2: no scans once real data
    // accumulates). Partial on the moderation predicate every query uses.
    index("leaderboard_season_score")
      .on(table.gameId, table.seasonKey, table.score)
      .where(sql`${table.flagged} = false`),
    // Own-best lookup.
    index("leaderboard_device_season").on(
      table.deviceId,
      table.gameId,
      table.seasonKey,
    ),
  ],
);

export const promotions = pgTable(
  "promotions",
  {
    id: uuid("id").primaryKey().defaultRandom(),
    channel: text("channel").notNull(), // "claw"
    kind: text("kind").notNull(), // demo | material_prize
    status: text("status").notNull().default("draft"), // draft|active|paused|ended
    rulesVersion: text("rules_version").notNull(),
    eligibilityVersion: text("eligibility_version").notNull(),
    oddsVersion: text("odds_version"),
    // Immutable per odds_version: {weights:{win,miss,drop}, dailyCap: number|null}
    config: jsonb("config").notNull(),
    startsAt: timestamp("starts_at", { withTimezone: true }),
    endsAt: timestamp("ends_at", { withTimezone: true }),
    createdAt: timestamp("created_at", { withTimezone: true })
      .notNull()
      .defaultNow(),
  },
  (table) => [
    uniqueIndex("promotions_one_active_per_channel")
      .on(table.channel)
      .where(sql`${table.status} = 'active'`),
    check("promotions_channel", sql`${table.channel} IN ('claw')`),
    check("promotions_kind", sql`${table.kind} IN ('demo', 'material_prize')`),
    check(
      "promotions_status",
      sql`${table.status} IN ('draft', 'active', 'paused', 'ended')`,
    ),
  ],
);

export const prizeInventory = pgTable(
  "prize_inventory",
  {
    promotionId: uuid("promotion_id")
      .notNull()
      .references(() => promotions.id),
    sku: text("sku").notNull(),
    total: integer("total").notNull(),
    reserved: integer("reserved").notNull().default(0),
    fulfilled: integer("fulfilled").notNull().default(0),
  },
  (table) => [
    primaryKey({ columns: [table.promotionId, table.sku] }),
    check(
      "prize_inventory_non_negative",
      sql`${table.total} >= 0 AND ${table.reserved} >= 0 AND ${table.fulfilled} >= 0`,
    ),
    check(
      "prize_inventory_reserved_within_total",
      sql`${table.reserved} + ${table.fulfilled} <= ${table.total}`,
    ),
  ],
);

export const clawPlays = pgTable(
  "claw_plays",
  {
    id: uuid("id").primaryKey().defaultRandom(),
    promotionId: uuid("promotion_id")
      .notNull()
      .references(() => promotions.id),
    attemptId: uuid("attempt_id").unique(),
    deviceId: uuid("device_id")
      .notNull()
      .references(() => devices.id),
    dayKey: text("day_key").notNull(),
    ordinal: integer("ordinal").notNull(),
    outcome: text("outcome").notNull(), // win|miss|drop
    oddsVersion: text("odds_version"),
    idempotencyKey: text("idempotency_key").notNull(),
    createdAt: timestamp("created_at", { withTimezone: true })
      .notNull()
      .defaultNow(),
  },
  (table) => [
    check(
      "claw_plays_outcome",
      sql`${table.outcome} IN ('win', 'miss', 'drop')`,
    ),
    check("claw_plays_ordinal_positive", sql`${table.ordinal} > 0`),
    uniqueIndex("claw_plays_device_day_ordinal").on(
      table.promotionId,
      table.deviceId,
      table.dayKey,
      table.ordinal,
    ),
    uniqueIndex("claw_plays_device_idem").on(
      table.promotionId,
      table.deviceId,
      table.idempotencyKey,
    ),
  ],
);

export const prizeClaims = pgTable(
  "prize_claims",
  {
    id: uuid("id").primaryKey().defaultRandom(),
    playId: uuid("play_id")
      .notNull()
      .unique()
      .references(() => clawPlays.id),
    tokenHash: text("token_hash").notNull().unique(),
    status: text("status").notNull().default("unclaimed"),
    expiresAt: timestamp("expires_at", { withTimezone: true }).notNull(),
    claimedAt: timestamp("claimed_at", { withTimezone: true }),
    fulfilledAt: timestamp("fulfilled_at", { withTimezone: true }),
    voidReason: text("void_reason"),
  },
  (table) => [
    check(
      "prize_claims_status",
      sql`${table.status} IN ('unclaimed', 'claimed', 'fulfilled', 'void')`,
    ),
  ],
);

export const opsAudit = pgTable("ops_audit", {
  id: uuid("id").primaryKey().defaultRandom(),
  actor: text("actor").notNull(),
  action: text("action").notNull(),
  targetType: text("target_type").notNull(),
  targetId: text("target_id").notNull(),
  reason: text("reason").notNull(),
  beforeJson: jsonb("before_json"),
  afterJson: jsonb("after_json"),
  createdAt: timestamp("created_at", { withTimezone: true })
    .notNull()
    .defaultNow(),
});

export const analyticsOutbox = pgTable(
  "analytics_outbox",
  {
    id: uuid("id").primaryKey().defaultRandom(),
    // Aggregate identity: the same domain event for the same aggregate can
    // only be enqueued once (dedup across transaction retries).
    aggregateType: text("aggregate_type").notNull(),
    aggregateId: text("aggregate_id").notNull(),
    eventName: text("event_name").notNull(),
    payload: jsonb("payload").notNull(),
    createdAt: timestamp("created_at", { withTimezone: true })
      .notNull()
      .defaultNow(),
    deliveredAt: timestamp("delivered_at", { withTimezone: true }),
    attempts: integer("attempts").notNull().default(0),
    lastError: text("last_error"),
  },
  (table) => [
    uniqueIndex("analytics_outbox_aggregate_event").on(
      table.aggregateType,
      table.aggregateId,
      table.eventName,
    ),
    check(
      "analytics_outbox_attempts_non_negative",
      sql`${table.attempts} >= 0`,
    ),
  ],
);
