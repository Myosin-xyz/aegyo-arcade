-- Additive championship schema. No guest history is reassigned or backfilled.
CREATE TABLE "competition_attempts" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"round_id" uuid NOT NULL,
	"member_id" uuid NOT NULL,
	"provider_session_id" text NOT NULL,
	"game_id" text NOT NULL,
	"day_key" text NOT NULL,
	"ordinal" integer NOT NULL,
	"idempotency_key" text NOT NULL,
	"seed" text NOT NULL,
	"status" text DEFAULT 'issued' NOT NULL,
	"issued_at" timestamp with time zone NOT NULL,
	"expires_at" timestamp with time zone NOT NULL,
	"received_at" timestamp with time zone,
	"trace_hash" text,
	"trace" jsonb,
	"security_confirmed" boolean DEFAULT false NOT NULL,
	"score" integer,
	"points" integer,
	"rejection_code" text,
	"receipt" jsonb,
	CONSTRAINT "competition_attempt_game" CHECK ("competition_attempts"."game_id" IN ('snake','flappy')),
	CONSTRAINT "competition_attempt_day" CHECK ("competition_attempts"."day_key" ~ '^[0-9]{4}-[0-9]{2}-[0-9]{2}$'),
	CONSTRAINT "competition_attempt_ordinal" CHECK ("competition_attempts"."ordinal" BETWEEN 1 AND 3),
	CONSTRAINT "competition_attempt_status" CHECK ("competition_attempts"."status" IN ('issued','pending','verified','rejected','void')),
	CONSTRAINT "competition_attempt_trace_hash" CHECK ("competition_attempts"."trace_hash" IS NULL OR length("competition_attempts"."trace_hash")=64),
	CONSTRAINT "competition_attempt_score" CHECK ("competition_attempts"."score" IS NULL OR "competition_attempts"."score">=0),
	CONSTRAINT "competition_attempt_points" CHECK ("competition_attempts"."points" IS NULL OR "competition_attempts"."points" BETWEEN 0 AND 1000)
);
--> statement-breakpoint
CREATE TABLE "competition_award_claims" (
	"id" uuid PRIMARY KEY NOT NULL,
	"final_result_id" uuid NOT NULL,
	"round_id" uuid NOT NULL,
	"member_id" uuid NOT NULL,
	"final_rank" integer NOT NULL,
	"award_key" text NOT NULL,
	"status" text DEFAULT 'unclaimed' NOT NULL,
	"private_proof" jsonb,
	"claim_proof_digest" text,
	"claim_idempotency_key" text,
	"claimed_at" timestamp with time zone,
	"fulfillment_key" text,
	"fulfilled_at" timestamp with time zone,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	CONSTRAINT "competition_award_claims_fulfillment_key_unique" UNIQUE("fulfillment_key"),
	CONSTRAINT "competition_award_rank" CHECK ("competition_award_claims"."final_rank">0),
	CONSTRAINT "competition_award_status" CHECK ("competition_award_claims"."status" IN ('unclaimed','claimed','fulfilled','void')),
	CONSTRAINT "competition_claim_digest" CHECK ("competition_award_claims"."claim_proof_digest" IS NULL OR length("competition_award_claims"."claim_proof_digest")=64),
	CONSTRAINT "competition_claim_state" CHECK (("competition_award_claims"."status"='unclaimed' AND "competition_award_claims"."private_proof" IS NULL AND "competition_award_claims"."claim_proof_digest" IS NULL AND "competition_award_claims"."claimed_at" IS NULL) OR ("competition_award_claims"."status" IN ('claimed','fulfilled') AND "competition_award_claims"."private_proof" IS NOT NULL AND "competition_award_claims"."claim_proof_digest" IS NOT NULL AND "competition_award_claims"."claimed_at" IS NOT NULL) OR "competition_award_claims"."status"='void')
);
--> statement-breakpoint
CREATE TABLE "competition_candidate_snapshots" (
	"id" uuid PRIMARY KEY NOT NULL,
	"round_id" uuid NOT NULL,
	"standings" jsonb NOT NULL,
	"source_digest" text NOT NULL,
	"game_high_scores" jsonb NOT NULL,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	CONSTRAINT "competition_candidate_snapshots_round_id_unique" UNIQUE("round_id")
);
--> statement-breakpoint
CREATE TABLE "competition_challenges" (
	"round_id" uuid NOT NULL,
	"game_id" text NOT NULL,
	"day_key" text NOT NULL,
	"seed" text NOT NULL,
	CONSTRAINT "competition_challenges_round_id_game_id_day_key_pk" PRIMARY KEY("round_id","game_id","day_key")
);
--> statement-breakpoint
CREATE TABLE "competition_daily_best" (
	"round_id" uuid NOT NULL,
	"member_id" uuid NOT NULL,
	"game_id" text NOT NULL,
	"day_key" text NOT NULL,
	"attempt_id" uuid NOT NULL,
	"points" integer NOT NULL,
	"received_at" timestamp with time zone NOT NULL,
	CONSTRAINT "competition_daily_best_round_id_member_id_game_id_day_key_pk" PRIMARY KEY("round_id","member_id","game_id","day_key"),
	CONSTRAINT "competition_best_points" CHECK ("competition_daily_best"."points" BETWEEN 0 AND 1000)
);
--> statement-breakpoint
CREATE TABLE "competition_enrollments" (
	"round_id" uuid NOT NULL,
	"member_id" uuid NOT NULL,
	"rules_digest" text NOT NULL,
	"enrolled_at" timestamp with time zone DEFAULT now() NOT NULL,
	CONSTRAINT "competition_enrollments_round_id_member_id_pk" PRIMARY KEY("round_id","member_id"),
	CONSTRAINT "competition_enrollment_digest" CHECK (length("competition_enrollments"."rules_digest")=64)
);
--> statement-breakpoint
CREATE TABLE "competition_final_results" (
	"id" uuid PRIMARY KEY NOT NULL,
	"round_id" uuid NOT NULL,
	"candidate_snapshot_id" uuid NOT NULL,
	"standings" jsonb NOT NULL,
	"review" jsonb NOT NULL,
	"approved_by" text NOT NULL,
	"approved_at" timestamp with time zone DEFAULT now() NOT NULL,
	CONSTRAINT "competition_final_results_round_id_unique" UNIQUE("round_id"),
	CONSTRAINT "competition_final_results_candidate_snapshot_id_unique" UNIQUE("candidate_snapshot_id")
);
--> statement-breakpoint
CREATE TABLE "competition_ledger" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"round_id" uuid NOT NULL,
	"member_id" uuid NOT NULL,
	"attempt_id" uuid,
	"game_id" text NOT NULL,
	"day_key" text NOT NULL,
	"delta" integer NOT NULL,
	"reason" text NOT NULL,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	CONSTRAINT "competition_ledger_delta" CHECK ("competition_ledger"."delta" BETWEEN -1000 AND 1000)
);
--> statement-breakpoint
CREATE TABLE "competition_operation_audit" (
	"id" uuid PRIMARY KEY NOT NULL,
	"round_id" uuid NOT NULL,
	"operation" text NOT NULL,
	"actor" text NOT NULL,
	"idempotency_key" text NOT NULL,
	"payload" jsonb DEFAULT '{}'::jsonb NOT NULL,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL
);
--> statement-breakpoint
CREATE TABLE "competition_profiles" (
	"member_id" uuid PRIMARY KEY NOT NULL,
	"username" text NOT NULL,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	"updated_at" timestamp with time zone DEFAULT now() NOT NULL,
	CONSTRAINT "competition_profiles_username_unique" UNIQUE("username"),
	CONSTRAINT "competition_username_valid" CHECK ("competition_profiles"."username" ~ '^[a-z0-9_]{3,20}$')
);
--> statement-breakpoint
CREATE TABLE "competition_rounds" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"slug" text NOT NULL,
	"rules" jsonb NOT NULL,
	"status" text DEFAULT 'draft' NOT NULL,
	"opens_at" timestamp with time zone NOT NULL,
	"closes_at" timestamp with time zone NOT NULL,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	CONSTRAINT "competition_rounds_slug_unique" UNIQUE("slug"),
	CONSTRAINT "competition_round_status" CHECK ("competition_rounds"."status" IN ('draft','open','closing','review','final')),
	CONSTRAINT "competition_round_dates" CHECK ("competition_rounds"."closes_at">"competition_rounds"."opens_at")
);
--> statement-breakpoint
ALTER TABLE "account_sessions" ADD COLUMN "email_verified" boolean DEFAULT false NOT NULL;--> statement-breakpoint
ALTER TABLE "competition_attempts" ADD CONSTRAINT "competition_attempts_round_id_competition_rounds_id_fk" FOREIGN KEY ("round_id") REFERENCES "public"."competition_rounds"("id") ON DELETE restrict ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "competition_attempts" ADD CONSTRAINT "competition_attempts_member_id_account_members_id_fk" FOREIGN KEY ("member_id") REFERENCES "public"."account_members"("id") ON DELETE restrict ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "competition_award_claims" ADD CONSTRAINT "competition_award_claims_final_result_id_competition_final_results_id_fk" FOREIGN KEY ("final_result_id") REFERENCES "public"."competition_final_results"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "competition_award_claims" ADD CONSTRAINT "competition_award_claims_round_id_competition_rounds_id_fk" FOREIGN KEY ("round_id") REFERENCES "public"."competition_rounds"("id") ON DELETE restrict ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "competition_award_claims" ADD CONSTRAINT "competition_award_claims_member_id_account_members_id_fk" FOREIGN KEY ("member_id") REFERENCES "public"."account_members"("id") ON DELETE restrict ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "competition_candidate_snapshots" ADD CONSTRAINT "competition_candidate_snapshots_round_id_competition_rounds_id_fk" FOREIGN KEY ("round_id") REFERENCES "public"."competition_rounds"("id") ON DELETE restrict ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "competition_challenges" ADD CONSTRAINT "competition_challenges_round_id_competition_rounds_id_fk" FOREIGN KEY ("round_id") REFERENCES "public"."competition_rounds"("id") ON DELETE restrict ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "competition_daily_best" ADD CONSTRAINT "competition_daily_best_round_id_competition_rounds_id_fk" FOREIGN KEY ("round_id") REFERENCES "public"."competition_rounds"("id") ON DELETE restrict ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "competition_daily_best" ADD CONSTRAINT "competition_daily_best_member_id_account_members_id_fk" FOREIGN KEY ("member_id") REFERENCES "public"."account_members"("id") ON DELETE restrict ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "competition_daily_best" ADD CONSTRAINT "competition_daily_best_attempt_id_competition_attempts_id_fk" FOREIGN KEY ("attempt_id") REFERENCES "public"."competition_attempts"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "competition_enrollments" ADD CONSTRAINT "competition_enrollments_round_id_competition_rounds_id_fk" FOREIGN KEY ("round_id") REFERENCES "public"."competition_rounds"("id") ON DELETE restrict ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "competition_enrollments" ADD CONSTRAINT "competition_enrollments_member_id_account_members_id_fk" FOREIGN KEY ("member_id") REFERENCES "public"."account_members"("id") ON DELETE restrict ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "competition_final_results" ADD CONSTRAINT "competition_final_results_round_id_competition_rounds_id_fk" FOREIGN KEY ("round_id") REFERENCES "public"."competition_rounds"("id") ON DELETE restrict ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "competition_final_results" ADD CONSTRAINT "competition_final_results_candidate_snapshot_id_competition_candidate_snapshots_id_fk" FOREIGN KEY ("candidate_snapshot_id") REFERENCES "public"."competition_candidate_snapshots"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "competition_ledger" ADD CONSTRAINT "competition_ledger_round_id_competition_rounds_id_fk" FOREIGN KEY ("round_id") REFERENCES "public"."competition_rounds"("id") ON DELETE restrict ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "competition_ledger" ADD CONSTRAINT "competition_ledger_member_id_account_members_id_fk" FOREIGN KEY ("member_id") REFERENCES "public"."account_members"("id") ON DELETE restrict ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "competition_ledger" ADD CONSTRAINT "competition_ledger_attempt_id_competition_attempts_id_fk" FOREIGN KEY ("attempt_id") REFERENCES "public"."competition_attempts"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "competition_operation_audit" ADD CONSTRAINT "competition_operation_audit_round_id_competition_rounds_id_fk" FOREIGN KEY ("round_id") REFERENCES "public"."competition_rounds"("id") ON DELETE restrict ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "competition_profiles" ADD CONSTRAINT "competition_profiles_member_id_account_members_id_fk" FOREIGN KEY ("member_id") REFERENCES "public"."account_members"("id") ON DELETE restrict ON UPDATE no action;--> statement-breakpoint
CREATE UNIQUE INDEX "competition_attempt_quota" ON "competition_attempts" USING btree ("round_id","member_id","game_id","day_key","ordinal");--> statement-breakpoint
CREATE UNIQUE INDEX "competition_attempt_idempotency" ON "competition_attempts" USING btree ("round_id","member_id","idempotency_key");--> statement-breakpoint
CREATE INDEX "competition_attempts_pending" ON "competition_attempts" USING btree ("round_id","status");--> statement-breakpoint
CREATE UNIQUE INDEX "competition_award_unique" ON "competition_award_claims" USING btree ("round_id","member_id","award_key");--> statement-breakpoint
CREATE UNIQUE INDEX "competition_award_member" ON "competition_award_claims" USING btree ("id","member_id");--> statement-breakpoint
CREATE UNIQUE INDEX "competition_operation_idempotency" ON "competition_operation_audit" USING btree ("round_id","operation","idempotency_key");
--> statement-breakpoint
-- Reviewed integrity functions and triggers (not represented by Drizzle).
CREATE FUNCTION competition_frozen_rules() RETURNS trigger LANGUAGE plpgsql AS $$
BEGIN
 IF OLD.status <> 'draft' AND (NEW.rules IS DISTINCT FROM OLD.rules OR NEW.opens_at IS DISTINCT FROM OLD.opens_at OR NEW.closes_at IS DISTINCT FROM OLD.closes_at OR NEW.slug IS DISTINCT FROM OLD.slug) THEN RAISE EXCEPTION 'competition_rules_frozen'; END IF;
 RETURN NEW;
END $$;
--> statement-breakpoint
CREATE TRIGGER competition_frozen_rules BEFORE UPDATE ON competition_rounds FOR EACH ROW EXECUTE FUNCTION competition_frozen_rules();
--> statement-breakpoint
CREATE FUNCTION competition_immutable_record() RETURNS trigger LANGUAGE plpgsql AS $$ BEGIN RAISE EXCEPTION 'competition_record_immutable'; END $$;
--> statement-breakpoint
CREATE TRIGGER competition_ledger_immutable BEFORE UPDATE OR DELETE ON competition_ledger FOR EACH ROW EXECUTE FUNCTION competition_immutable_record();
--> statement-breakpoint
CREATE TRIGGER competition_ledger_no_truncate BEFORE TRUNCATE ON competition_ledger FOR EACH STATEMENT EXECUTE FUNCTION competition_immutable_record();
--> statement-breakpoint
CREATE FUNCTION competition_evidence_frozen() RETURNS trigger LANGUAGE plpgsql AS $$
BEGIN
 IF NEW.round_id IS DISTINCT FROM OLD.round_id OR NEW.member_id IS DISTINCT FROM OLD.member_id OR NEW.provider_session_id IS DISTINCT FROM OLD.provider_session_id OR NEW.seed IS DISTINCT FROM OLD.seed OR NEW.game_id IS DISTINCT FROM OLD.game_id OR NEW.day_key IS DISTINCT FROM OLD.day_key OR NEW.ordinal IS DISTINCT FROM OLD.ordinal OR NEW.issued_at IS DISTINCT FROM OLD.issued_at OR NEW.expires_at IS DISTINCT FROM OLD.expires_at OR NEW.idempotency_key IS DISTINCT FROM OLD.idempotency_key THEN RAISE EXCEPTION 'competition_attempt_identity_frozen'; END IF;
 IF OLD.trace_hash IS NOT NULL AND (NEW.trace_hash IS DISTINCT FROM OLD.trace_hash OR NEW.trace IS DISTINCT FROM OLD.trace OR NEW.received_at IS DISTINCT FROM OLD.received_at OR NEW.receipt IS DISTINCT FROM OLD.receipt) THEN RAISE EXCEPTION 'competition_evidence_frozen'; END IF;
 RETURN NEW;
END $$;
--> statement-breakpoint
CREATE TRIGGER competition_evidence_frozen BEFORE UPDATE ON competition_attempts FOR EACH ROW EXECUTE FUNCTION competition_evidence_frozen();
--> statement-breakpoint
CREATE TRIGGER competition_candidate_snapshots_immutable
  BEFORE UPDATE OR DELETE ON competition_candidate_snapshots
  FOR EACH ROW EXECUTE FUNCTION competition_immutable_record();
--> statement-breakpoint
CREATE TRIGGER competition_candidate_snapshots_no_truncate
  BEFORE TRUNCATE ON competition_candidate_snapshots
  FOR EACH STATEMENT EXECUTE FUNCTION competition_immutable_record();
--> statement-breakpoint
CREATE TRIGGER competition_final_results_immutable
  BEFORE UPDATE OR DELETE ON competition_final_results
  FOR EACH ROW EXECUTE FUNCTION competition_immutable_record();
--> statement-breakpoint
CREATE TRIGGER competition_final_results_no_truncate
  BEFORE TRUNCATE ON competition_final_results
  FOR EACH STATEMENT EXECUTE FUNCTION competition_immutable_record();
--> statement-breakpoint
CREATE TRIGGER competition_operation_audit_immutable
  BEFORE UPDATE OR DELETE ON competition_operation_audit
  FOR EACH ROW EXECUTE FUNCTION competition_immutable_record();
--> statement-breakpoint
CREATE TRIGGER competition_operation_audit_no_truncate
  BEFORE TRUNCATE ON competition_operation_audit
  FOR EACH STATEMENT EXECUTE FUNCTION competition_immutable_record();
