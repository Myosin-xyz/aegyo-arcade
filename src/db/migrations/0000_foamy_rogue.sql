CREATE TABLE "analytics_outbox" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"aggregate_type" text NOT NULL,
	"aggregate_id" text NOT NULL,
	"event_name" text NOT NULL,
	"payload" jsonb NOT NULL,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	"delivered_at" timestamp with time zone,
	"attempts" integer DEFAULT 0 NOT NULL,
	"last_error" text,
	CONSTRAINT "analytics_outbox_attempts_non_negative" CHECK ("analytics_outbox"."attempts" >= 0)
);
--> statement-breakpoint
CREATE TABLE "claw_plays" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"promotion_id" uuid NOT NULL,
	"attempt_id" uuid,
	"device_id" uuid NOT NULL,
	"day_key" text NOT NULL,
	"ordinal" integer NOT NULL,
	"outcome" text NOT NULL,
	"odds_version" text,
	"idempotency_key" text NOT NULL,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	CONSTRAINT "claw_plays_attempt_id_unique" UNIQUE("attempt_id"),
	CONSTRAINT "claw_plays_outcome" CHECK ("claw_plays"."outcome" IN ('win', 'miss', 'drop')),
	CONSTRAINT "claw_plays_ordinal_positive" CHECK ("claw_plays"."ordinal" > 0)
);
--> statement-breakpoint
CREATE TABLE "daily_slots" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"device_id" uuid NOT NULL,
	"day_key" text NOT NULL,
	"scope_key" text NOT NULL,
	"policy_version" integer DEFAULT 1 NOT NULL,
	"time_zone" text NOT NULL,
	"eligible_after_at" timestamp with time zone NOT NULL,
	"completed_run_id" uuid,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	CONSTRAINT "daily_slots_policy_positive" CHECK ("daily_slots"."policy_version" > 0)
);
--> statement-breakpoint
CREATE TABLE "device_sessions" (
	"token_hash" text PRIMARY KEY NOT NULL,
	"device_id" uuid NOT NULL,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	"expires_at" timestamp with time zone NOT NULL,
	"revoked_at" timestamp with time zone
);
--> statement-breakpoint
CREATE TABLE "devices" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"locale" text DEFAULT 'en' NOT NULL,
	"generated_handle" text,
	"avatar_emoji" text,
	"time_zone" text DEFAULT 'UTC' NOT NULL,
	"time_zone_changed_at" timestamp with time zone,
	"privacy_state" text DEFAULT 'active' NOT NULL,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	"last_seen_at" timestamp with time zone DEFAULT now() NOT NULL,
	CONSTRAINT "devices_privacy_state" CHECK ("devices"."privacy_state" IN ('active', 'tombstoned'))
);
--> statement-breakpoint
CREATE TABLE "leaderboard_scores" (
	"run_id" uuid PRIMARY KEY NOT NULL,
	"device_id" uuid NOT NULL,
	"game_id" text NOT NULL,
	"season_key" text NOT NULL,
	"score" integer NOT NULL,
	"accepted_at" timestamp with time zone DEFAULT now() NOT NULL,
	"flagged" boolean DEFAULT false NOT NULL
);
--> statement-breakpoint
CREATE TABLE "ops_audit" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"actor" text NOT NULL,
	"action" text NOT NULL,
	"target_type" text NOT NULL,
	"target_id" text NOT NULL,
	"reason" text NOT NULL,
	"before_json" jsonb,
	"after_json" jsonb,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL
);
--> statement-breakpoint
CREATE TABLE "prize_claims" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"play_id" uuid NOT NULL,
	"token_hash" text NOT NULL,
	"status" text DEFAULT 'unclaimed' NOT NULL,
	"expires_at" timestamp with time zone NOT NULL,
	"claimed_at" timestamp with time zone,
	"fulfilled_at" timestamp with time zone,
	"void_reason" text,
	CONSTRAINT "prize_claims_play_id_unique" UNIQUE("play_id"),
	CONSTRAINT "prize_claims_token_hash_unique" UNIQUE("token_hash"),
	CONSTRAINT "prize_claims_status" CHECK ("prize_claims"."status" IN ('unclaimed', 'claimed', 'fulfilled', 'void'))
);
--> statement-breakpoint
CREATE TABLE "prize_inventory" (
	"promotion_id" uuid NOT NULL,
	"sku" text NOT NULL,
	"total" integer NOT NULL,
	"reserved" integer DEFAULT 0 NOT NULL,
	"fulfilled" integer DEFAULT 0 NOT NULL,
	CONSTRAINT "prize_inventory_promotion_id_sku_pk" PRIMARY KEY("promotion_id","sku"),
	CONSTRAINT "prize_inventory_non_negative" CHECK ("prize_inventory"."total" >= 0 AND "prize_inventory"."reserved" >= 0 AND "prize_inventory"."fulfilled" >= 0),
	CONSTRAINT "prize_inventory_reserved_within_total" CHECK ("prize_inventory"."reserved" + "prize_inventory"."fulfilled" <= "prize_inventory"."total")
);
--> statement-breakpoint
CREATE TABLE "promotions" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"channel" text NOT NULL,
	"kind" text NOT NULL,
	"status" text DEFAULT 'draft' NOT NULL,
	"rules_version" text NOT NULL,
	"eligibility_version" text NOT NULL,
	"odds_version" text,
	"config" jsonb NOT NULL,
	"starts_at" timestamp with time zone,
	"ends_at" timestamp with time zone,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	CONSTRAINT "promotions_channel" CHECK ("promotions"."channel" IN ('claw')),
	CONSTRAINT "promotions_kind" CHECK ("promotions"."kind" IN ('demo', 'material_prize')),
	CONSTRAINT "promotions_status" CHECK ("promotions"."status" IN ('draft', 'active', 'paused', 'ended'))
);
--> statement-breakpoint
CREATE TABLE "run_attempts" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"slot_id" uuid,
	"device_id" uuid NOT NULL,
	"game_id" text NOT NULL,
	"mode" text NOT NULL,
	"attempt_no" integer DEFAULT 1 NOT NULL,
	"seed" text NOT NULL,
	"status" text DEFAULT 'issued' NOT NULL,
	"score" integer,
	"client_duration_ms" integer,
	"server_elapsed_ms" integer,
	"issued_at" timestamp with time zone DEFAULT now() NOT NULL,
	"expires_at" timestamp with time zone NOT NULL,
	"submitted_at" timestamp with time zone,
	"result_snapshot" jsonb,
	"idempotency_key" text NOT NULL,
	CONSTRAINT "run_attempts_mode" CHECK ("run_attempts"."mode" IN ('counted')),
	CONSTRAINT "run_attempts_status" CHECK ("run_attempts"."status" IN ('issued', 'submitted', 'expired', 'void')),
	CONSTRAINT "run_attempts_attempt_no_positive" CHECK ("run_attempts"."attempt_no" > 0),
	CONSTRAINT "run_attempts_score_non_negative" CHECK ("run_attempts"."score" IS NULL OR "run_attempts"."score" >= 0)
);
--> statement-breakpoint
CREATE TABLE "streaks" (
	"device_id" uuid PRIMARY KEY NOT NULL,
	"current" integer DEFAULT 0 NOT NULL,
	"best" integer DEFAULT 0 NOT NULL,
	"last_day_key" text,
	"updated_at" timestamp with time zone DEFAULT now() NOT NULL,
	CONSTRAINT "streaks_non_negative" CHECK ("streaks"."current" >= 0 AND "streaks"."best" >= 0)
);
--> statement-breakpoint
ALTER TABLE "claw_plays" ADD CONSTRAINT "claw_plays_promotion_id_promotions_id_fk" FOREIGN KEY ("promotion_id") REFERENCES "public"."promotions"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "claw_plays" ADD CONSTRAINT "claw_plays_device_id_devices_id_fk" FOREIGN KEY ("device_id") REFERENCES "public"."devices"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "daily_slots" ADD CONSTRAINT "daily_slots_device_id_devices_id_fk" FOREIGN KEY ("device_id") REFERENCES "public"."devices"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "daily_slots" ADD CONSTRAINT "daily_slots_completed_run_id_run_attempts_id_fk" FOREIGN KEY ("completed_run_id") REFERENCES "public"."run_attempts"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "device_sessions" ADD CONSTRAINT "device_sessions_device_id_devices_id_fk" FOREIGN KEY ("device_id") REFERENCES "public"."devices"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "leaderboard_scores" ADD CONSTRAINT "leaderboard_scores_run_id_run_attempts_id_fk" FOREIGN KEY ("run_id") REFERENCES "public"."run_attempts"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "leaderboard_scores" ADD CONSTRAINT "leaderboard_scores_device_id_devices_id_fk" FOREIGN KEY ("device_id") REFERENCES "public"."devices"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "prize_claims" ADD CONSTRAINT "prize_claims_play_id_claw_plays_id_fk" FOREIGN KEY ("play_id") REFERENCES "public"."claw_plays"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "prize_inventory" ADD CONSTRAINT "prize_inventory_promotion_id_promotions_id_fk" FOREIGN KEY ("promotion_id") REFERENCES "public"."promotions"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "run_attempts" ADD CONSTRAINT "run_attempts_slot_id_daily_slots_id_fk" FOREIGN KEY ("slot_id") REFERENCES "public"."daily_slots"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "run_attempts" ADD CONSTRAINT "run_attempts_device_id_devices_id_fk" FOREIGN KEY ("device_id") REFERENCES "public"."devices"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "streaks" ADD CONSTRAINT "streaks_device_id_devices_id_fk" FOREIGN KEY ("device_id") REFERENCES "public"."devices"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
CREATE UNIQUE INDEX "analytics_outbox_aggregate_event" ON "analytics_outbox" USING btree ("aggregate_type","aggregate_id","event_name");--> statement-breakpoint
CREATE UNIQUE INDEX "claw_plays_device_day_ordinal" ON "claw_plays" USING btree ("promotion_id","device_id","day_key","ordinal");--> statement-breakpoint
CREATE UNIQUE INDEX "claw_plays_device_idem" ON "claw_plays" USING btree ("promotion_id","device_id","idempotency_key");--> statement-breakpoint
CREATE UNIQUE INDEX "daily_slots_device_day_scope" ON "daily_slots" USING btree ("device_id","day_key","scope_key");--> statement-breakpoint
CREATE INDEX "leaderboard_season_score" ON "leaderboard_scores" USING btree ("game_id","season_key","score") WHERE "leaderboard_scores"."flagged" = false;--> statement-breakpoint
CREATE INDEX "leaderboard_device_season" ON "leaderboard_scores" USING btree ("device_id","game_id","season_key");--> statement-breakpoint
CREATE UNIQUE INDEX "promotions_one_active_per_channel" ON "promotions" USING btree ("channel") WHERE "promotions"."status" = 'active';--> statement-breakpoint
CREATE UNIQUE INDEX "run_attempts_device_idem" ON "run_attempts" USING btree ("device_id","idempotency_key");--> statement-breakpoint
CREATE UNIQUE INDEX "run_attempts_one_issued_per_slot" ON "run_attempts" USING btree ("slot_id") WHERE "run_attempts"."status" = 'issued';--> statement-breakpoint
CREATE UNIQUE INDEX "run_attempts_one_submitted_per_slot" ON "run_attempts" USING btree ("slot_id") WHERE "run_attempts"."status" = 'submitted';