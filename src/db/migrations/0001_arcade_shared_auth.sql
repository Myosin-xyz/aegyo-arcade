CREATE TABLE "account_members" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"issuer" text NOT NULL,
	"subject" text NOT NULL,
	"display_name" text,
	"avatar_url" text,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	"updated_at" timestamp with time zone DEFAULT now() NOT NULL
);
--> statement-breakpoint
CREATE TABLE "account_sessions" (
	"token_hash" text PRIMARY KEY NOT NULL,
	"member_id" uuid NOT NULL,
	"provider_session_id" text NOT NULL,
	"authenticated_at" timestamp with time zone NOT NULL,
	"provider_checked_at" timestamp with time zone NOT NULL,
	"security_version" integer NOT NULL,
	"password_reset_state" jsonb NOT NULL,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	"expires_at" timestamp with time zone NOT NULL,
	"revoked_at" timestamp with time zone,
	CONSTRAINT "account_sessions_security_version_non_negative" CHECK ("account_sessions"."security_version" >= 0)
);
--> statement-breakpoint
ALTER TABLE "account_sessions" ADD CONSTRAINT "account_sessions_member_id_account_members_id_fk" FOREIGN KEY ("member_id") REFERENCES "public"."account_members"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
CREATE UNIQUE INDEX "account_members_issuer_subject" ON "account_members" USING btree ("issuer","subject");--> statement-breakpoint
CREATE INDEX "account_sessions_member" ON "account_sessions" USING btree ("member_id");--> statement-breakpoint
CREATE INDEX "account_sessions_provider_sid" ON "account_sessions" USING btree ("provider_session_id");