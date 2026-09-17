import { sql } from "drizzle-orm";
import {
  pgTable,
  uuid,
  text,
  integer,
  jsonb,
  timestamp,
  boolean,
  primaryKey,
  uniqueIndex,
  check,
  index,
} from "drizzle-orm/pg-core";
import { accountMembers } from "./schema";
const date = (name: string) => timestamp(name, { withTimezone: true });
const member = (name = "member_id") =>
  uuid(name)
    .notNull()
    .references(() => accountMembers.id, { onDelete: "restrict" });
export const competitionProfiles = pgTable(
  "competition_profiles",
  {
    memberId: member().primaryKey(),
    username: text("username").notNull().unique(),
    createdAt: date("created_at").notNull().defaultNow(),
    updatedAt: date("updated_at").notNull().defaultNow(),
  },
  (t) => [
    check(
      "competition_username_valid",
      sql`${t.username} ~ '^[a-z0-9_]{3,20}$'`,
    ),
  ],
);
export const competitionRounds = pgTable(
  "competition_rounds",
  {
    id: uuid("id").primaryKey().defaultRandom(),
    slug: text("slug").notNull().unique(),
    rules: jsonb("rules").notNull(),
    status: text("status").notNull().default("draft"),
    opensAt: date("opens_at").notNull(),
    closesAt: date("closes_at").notNull(),
    createdAt: date("created_at").notNull().defaultNow(),
  },
  (t) => [
    check(
      "competition_round_status",
      sql`${t.status} IN ('draft','open','closing','review','final')`,
    ),
    check("competition_round_dates", sql`${t.closesAt}>${t.opensAt}`),
  ],
);
const round = () =>
  uuid("round_id")
    .notNull()
    .references(() => competitionRounds.id, { onDelete: "restrict" });
export const competitionEnrollments = pgTable(
  "competition_enrollments",
  {
    roundId: round(),
    memberId: member(),
    rulesDigest: text("rules_digest").notNull(),
    enrolledAt: date("enrolled_at").notNull().defaultNow(),
  },
  (t) => [
    primaryKey({ columns: [t.roundId, t.memberId] }),
    check("competition_enrollment_digest", sql`length(${t.rulesDigest})=64`),
  ],
);
export const competitionAttempts = pgTable(
  "competition_attempts",
  {
    id: uuid("id").primaryKey().defaultRandom(),
    roundId: round(),
    memberId: member(),
    providerSessionId: text("provider_session_id").notNull(),
    gameId: text("game_id").notNull(),
    dayKey: text("day_key").notNull(),
    scorePeriodKey: text("score_period_key").notNull(),
    ordinal: integer("ordinal").notNull(),
    idempotencyKey: text("idempotency_key").notNull(),
    seed: text("seed").notNull(),
    status: text("status").notNull().default("issued"),
    issuedAt: date("issued_at").notNull(),
    expiresAt: date("expires_at").notNull(),
    receivedAt: date("received_at"),
    traceHash: text("trace_hash"),
    trace: jsonb("trace"),
    securityConfirmed: boolean("security_confirmed").notNull().default(false),
    score: integer("score"),
    points: integer("points"),
    rejectionCode: text("rejection_code"),
    receipt: jsonb("receipt"),
  },
  (t) => [
    uniqueIndex("competition_attempt_quota").on(
      t.roundId,
      t.memberId,
      t.gameId,
      t.dayKey,
      t.ordinal,
    ),
    uniqueIndex("competition_attempt_idempotency").on(
      t.roundId,
      t.memberId,
      t.idempotencyKey,
    ),
    index("competition_attempts_pending").on(t.roundId, t.status),
    check("competition_attempt_game", sql`${t.gameId} IN ('snake','flappy')`),
    check(
      "competition_attempt_day",
      sql`${t.dayKey} ~ '^[0-9]{4}-[0-9]{2}-[0-9]{2}$'`,
    ),
    check(
      "competition_attempt_score_period",
      sql`${t.scorePeriodKey} ~ '^[0-9]{4}-[0-9]{2}-[0-9]{2}$'`,
    ),
    check("competition_attempt_ordinal", sql`${t.ordinal} BETWEEN 1 AND 3`),
    check(
      "competition_attempt_status",
      sql`${t.status} IN ('issued','pending','verified','rejected','void')`,
    ),
    check(
      "competition_attempt_trace_hash",
      sql`${t.traceHash} IS NULL OR length(${t.traceHash})=64`,
    ),
    check(
      "competition_attempt_score",
      sql`${t.score} IS NULL OR ${t.score}>=0`,
    ),
    check(
      "competition_attempt_points",
      sql`${t.points} IS NULL OR ${t.points} BETWEEN 0 AND 1000`,
    ),
  ],
);
export const competitionDailyBest = pgTable(
  "competition_daily_best",
  {
    roundId: round(),
    memberId: member(),
    gameId: text("game_id").notNull(),
    dayKey: text("day_key").notNull(),
    attemptId: uuid("attempt_id")
      .notNull()
      .references(() => competitionAttempts.id),
    points: integer("points").notNull(),
    receivedAt: date("received_at").notNull(),
  },
  (t) => [
    primaryKey({ columns: [t.roundId, t.memberId, t.gameId, t.dayKey] }),
    check("competition_best_points", sql`${t.points} BETWEEN 0 AND 1000`),
  ],
);
export const competitionPeriodBest = pgTable(
  "competition_period_best",
  {
    roundId: round(),
    memberId: member(),
    gameId: text("game_id").notNull(),
    periodKey: text("period_key").notNull(),
    attemptId: uuid("attempt_id")
      .notNull()
      .references(() => competitionAttempts.id),
    points: integer("points").notNull(),
    receivedAt: date("received_at").notNull(),
  },
  (t) => [
    primaryKey({
      columns: [t.roundId, t.memberId, t.gameId, t.periodKey],
    }),
    check(
      "competition_period_best_key",
      sql`${t.periodKey} ~ '^[0-9]{4}-[0-9]{2}-[0-9]{2}$'`,
    ),
    check(
      "competition_period_best_points",
      sql`${t.points} BETWEEN 0 AND 1000`,
    ),
  ],
);
export const competitionPeriodBonuses = pgTable(
  "competition_period_bonuses",
  {
    roundId: round(),
    memberId: member(),
    periodKey: text("period_key").notNull(),
    points: integer("points").notNull(),
    earnedAt: date("earned_at").notNull(),
  },
  (t) => [
    primaryKey({ columns: [t.roundId, t.memberId, t.periodKey] }),
    check(
      "competition_period_bonus_key",
      sql`${t.periodKey} ~ '^[0-9]{4}-[0-9]{2}-[0-9]{2}$'`,
    ),
    check(
      "competition_period_bonus_points",
      sql`${t.points} BETWEEN 1 AND 1000`,
    ),
  ],
);
export const competitionLedger = pgTable(
  "competition_ledger",
  {
    id: uuid("id").primaryKey().defaultRandom(),
    roundId: round(),
    memberId: member(),
    attemptId: uuid("attempt_id").references(() => competitionAttempts.id),
    gameId: text("game_id").notNull(),
    dayKey: text("day_key").notNull(),
    delta: integer("delta").notNull(),
    reason: text("reason").notNull(),
    createdAt: date("created_at").notNull().defaultNow(),
  },
  (t) => [
    check("competition_ledger_delta", sql`${t.delta} BETWEEN -1000 AND 1000`),
  ],
);
export const competitionChallenges = pgTable(
  "competition_challenges",
  {
    roundId: round(),
    gameId: text("game_id").notNull(),
    dayKey: text("day_key").notNull(),
    seed: text("seed").notNull(),
  },
  (t) => [primaryKey({ columns: [t.roundId, t.gameId, t.dayKey] })],
);
export const competitionCandidateSnapshots = pgTable(
  "competition_candidate_snapshots",
  {
    id: uuid("id").primaryKey(),
    roundId: round().unique(),
    standings: jsonb("standings").notNull(),
    sourceDigest: text("source_digest").notNull(),
    gameHighScores: jsonb("game_high_scores").notNull(),
    createdAt: date("created_at").notNull().defaultNow(),
  },
);
export const competitionFinalResults = pgTable("competition_final_results", {
  id: uuid("id").primaryKey(),
  roundId: round().unique(),
  candidateSnapshotId: uuid("candidate_snapshot_id")
    .notNull()
    .unique()
    .references(() => competitionCandidateSnapshots.id),
  standings: jsonb("standings").notNull(),
  review: jsonb("review").notNull(),
  approvedBy: text("approved_by").notNull(),
  approvedAt: date("approved_at").notNull().defaultNow(),
});
export const competitionAwardClaims = pgTable(
  "competition_award_claims",
  {
    id: uuid("id").primaryKey(),
    finalResultId: uuid("final_result_id")
      .notNull()
      .references(() => competitionFinalResults.id),
    roundId: round(),
    memberId: member(),
    finalRank: integer("final_rank").notNull(),
    awardKey: text("award_key").notNull(),
    status: text("status").notNull().default("unclaimed"),
    privateProof: jsonb("private_proof"),
    claimProofDigest: text("claim_proof_digest"),
    claimIdempotencyKey: text("claim_idempotency_key"),
    claimedAt: date("claimed_at"),
    fulfillmentKey: text("fulfillment_key").unique(),
    fulfilledAt: date("fulfilled_at"),
    createdAt: date("created_at").notNull().defaultNow(),
  },
  (t) => [
    uniqueIndex("competition_award_unique").on(
      t.roundId,
      t.memberId,
      t.awardKey,
    ),
    uniqueIndex("competition_award_member").on(t.id, t.memberId),
    check("competition_award_rank", sql`${t.finalRank}>0`),
    check(
      "competition_award_status",
      sql`${t.status} IN ('unclaimed','claimed','fulfilled','void')`,
    ),
    check(
      "competition_claim_digest",
      sql`${t.claimProofDigest} IS NULL OR length(${t.claimProofDigest})=64`,
    ),
    check(
      "competition_claim_state",
      sql`(${t.status}='unclaimed' AND ${t.privateProof} IS NULL AND ${t.claimProofDigest} IS NULL AND ${t.claimedAt} IS NULL) OR (${t.status} IN ('claimed','fulfilled') AND ${t.privateProof} IS NOT NULL AND ${t.claimProofDigest} IS NOT NULL AND ${t.claimedAt} IS NOT NULL) OR ${t.status}='void'`,
    ),
  ],
);
export const competitionOperationAudit = pgTable(
  "competition_operation_audit",
  {
    id: uuid("id").primaryKey(),
    roundId: round(),
    operation: text("operation").notNull(),
    actor: text("actor").notNull(),
    idempotencyKey: text("idempotency_key").notNull(),
    payload: jsonb("payload").notNull().default({}),
    createdAt: date("created_at").notNull().defaultNow(),
  },
  (t) => [
    uniqueIndex("competition_operation_idempotency").on(
      t.roundId,
      t.operation,
      t.idempotencyKey,
    ),
  ],
);
