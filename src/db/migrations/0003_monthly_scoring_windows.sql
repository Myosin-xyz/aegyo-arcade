ALTER TABLE "competition_attempts" ADD COLUMN "score_period_key" text;
--> statement-breakpoint
UPDATE "competition_attempts" SET "score_period_key" = "day_key" WHERE "score_period_key" IS NULL;
--> statement-breakpoint
ALTER TABLE "competition_attempts" ALTER COLUMN "score_period_key" SET NOT NULL;
--> statement-breakpoint
ALTER TABLE "competition_attempts" ADD CONSTRAINT "competition_attempt_score_period" CHECK ("competition_attempts"."score_period_key" ~ '^[0-9]{4}-[0-9]{2}-[0-9]{2}$');
--> statement-breakpoint
CREATE TABLE "competition_period_best" (
	"round_id" uuid NOT NULL,
	"member_id" uuid NOT NULL,
	"game_id" text NOT NULL,
	"period_key" text NOT NULL,
	"attempt_id" uuid NOT NULL,
	"points" integer NOT NULL,
	"received_at" timestamp with time zone NOT NULL,
	CONSTRAINT "competition_period_best_round_id_member_id_game_id_period_key_pk" PRIMARY KEY("round_id","member_id","game_id","period_key"),
	CONSTRAINT "competition_period_best_key" CHECK ("competition_period_best"."period_key" ~ '^[0-9]{4}-[0-9]{2}-[0-9]{2}$'),
	CONSTRAINT "competition_period_best_points" CHECK ("competition_period_best"."points" BETWEEN 0 AND 1000)
);
--> statement-breakpoint
INSERT INTO "competition_period_best"("round_id","member_id","game_id","period_key","attempt_id","points","received_at")
SELECT "round_id","member_id","game_id","day_key","attempt_id","points","received_at"
FROM "competition_daily_best";
--> statement-breakpoint
CREATE TABLE "competition_period_bonuses" (
	"round_id" uuid NOT NULL,
	"member_id" uuid NOT NULL,
	"period_key" text NOT NULL,
	"points" integer NOT NULL,
	"earned_at" timestamp with time zone NOT NULL,
	CONSTRAINT "competition_period_bonuses_round_id_member_id_period_key_pk" PRIMARY KEY("round_id","member_id","period_key"),
	CONSTRAINT "competition_period_bonus_key" CHECK ("competition_period_bonuses"."period_key" ~ '^[0-9]{4}-[0-9]{2}-[0-9]{2}$'),
	CONSTRAINT "competition_period_bonus_points" CHECK ("competition_period_bonuses"."points" BETWEEN 1 AND 1000)
);
--> statement-breakpoint
ALTER TABLE "competition_period_best" ADD CONSTRAINT "competition_period_best_round_id_competition_rounds_id_fk" FOREIGN KEY ("round_id") REFERENCES "public"."competition_rounds"("id") ON DELETE restrict ON UPDATE no action;
--> statement-breakpoint
ALTER TABLE "competition_period_best" ADD CONSTRAINT "competition_period_best_member_id_account_members_id_fk" FOREIGN KEY ("member_id") REFERENCES "public"."account_members"("id") ON DELETE restrict ON UPDATE no action;
--> statement-breakpoint
ALTER TABLE "competition_period_best" ADD CONSTRAINT "competition_period_best_attempt_id_competition_attempts_id_fk" FOREIGN KEY ("attempt_id") REFERENCES "public"."competition_attempts"("id") ON DELETE no action ON UPDATE no action;
--> statement-breakpoint
ALTER TABLE "competition_period_bonuses" ADD CONSTRAINT "competition_period_bonuses_round_id_competition_rounds_id_fk" FOREIGN KEY ("round_id") REFERENCES "public"."competition_rounds"("id") ON DELETE restrict ON UPDATE no action;
--> statement-breakpoint
ALTER TABLE "competition_period_bonuses" ADD CONSTRAINT "competition_period_bonuses_member_id_account_members_id_fk" FOREIGN KEY ("member_id") REFERENCES "public"."account_members"("id") ON DELETE restrict ON UPDATE no action;
--> statement-breakpoint
DROP TRIGGER "competition_evidence_frozen" ON "competition_attempts";
--> statement-breakpoint
CREATE OR REPLACE FUNCTION competition_evidence_frozen() RETURNS trigger LANGUAGE plpgsql AS $$
BEGIN
 IF NEW.round_id IS DISTINCT FROM OLD.round_id OR NEW.member_id IS DISTINCT FROM OLD.member_id OR NEW.provider_session_id IS DISTINCT FROM OLD.provider_session_id OR NEW.seed IS DISTINCT FROM OLD.seed OR NEW.game_id IS DISTINCT FROM OLD.game_id OR NEW.day_key IS DISTINCT FROM OLD.day_key OR NEW.score_period_key IS DISTINCT FROM OLD.score_period_key OR NEW.ordinal IS DISTINCT FROM OLD.ordinal OR NEW.issued_at IS DISTINCT FROM OLD.issued_at OR NEW.expires_at IS DISTINCT FROM OLD.expires_at OR NEW.idempotency_key IS DISTINCT FROM OLD.idempotency_key THEN RAISE EXCEPTION 'competition_attempt_identity_frozen'; END IF;
 IF OLD.trace_hash IS NOT NULL AND (NEW.trace_hash IS DISTINCT FROM OLD.trace_hash OR NEW.trace IS DISTINCT FROM OLD.trace OR NEW.received_at IS DISTINCT FROM OLD.received_at OR NEW.receipt IS DISTINCT FROM OLD.receipt) THEN RAISE EXCEPTION 'competition_evidence_frozen'; END IF;
 RETURN NEW;
END $$;
--> statement-breakpoint
CREATE TRIGGER competition_evidence_frozen BEFORE UPDATE ON competition_attempts FOR EACH ROW EXECUTE FUNCTION competition_evidence_frozen();
