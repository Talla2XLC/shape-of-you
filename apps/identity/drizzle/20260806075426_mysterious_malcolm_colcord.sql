ALTER TYPE "public"."identity_security_event_type" ADD VALUE 'initial_passkey_enrollment_created' BEFORE 'passkey_registered';--> statement-breakpoint
CREATE TABLE "initial_passkey_enrollments" (
	"id" uuid PRIMARY KEY NOT NULL,
	"account_id" uuid NOT NULL,
	"token_hash" "bytea" NOT NULL,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	"expires_at" timestamp with time zone NOT NULL,
	"consumed_at" timestamp with time zone,
	"invalidated_at" timestamp with time zone,
	CONSTRAINT "initial_passkey_enrollments_id_account_uq" UNIQUE("id","account_id"),
	CONSTRAINT "initial_passkey_enrollments_token_hash_uq" UNIQUE("token_hash"),
	CONSTRAINT "initial_passkey_enrollments_hash_length" CHECK (octet_length("initial_passkey_enrollments"."token_hash") = 32),
	CONSTRAINT "initial_passkey_enrollments_lifetime" CHECK ("initial_passkey_enrollments"."expires_at" > "initial_passkey_enrollments"."created_at" AND "initial_passkey_enrollments"."expires_at" <= "initial_passkey_enrollments"."created_at" + interval '15 minutes'),
	CONSTRAINT "initial_passkey_enrollments_terminal_state" CHECK (NOT ("initial_passkey_enrollments"."consumed_at" IS NOT NULL AND "initial_passkey_enrollments"."invalidated_at" IS NOT NULL)),
	CONSTRAINT "initial_passkey_enrollments_consumption_time" CHECK ("initial_passkey_enrollments"."consumed_at" IS NULL OR ("initial_passkey_enrollments"."consumed_at" >= "initial_passkey_enrollments"."created_at" AND "initial_passkey_enrollments"."consumed_at" <= "initial_passkey_enrollments"."expires_at")),
	CONSTRAINT "initial_passkey_enrollments_invalidation_time" CHECK ("initial_passkey_enrollments"."invalidated_at" IS NULL OR "initial_passkey_enrollments"."invalidated_at" >= "initial_passkey_enrollments"."created_at")
);
--> statement-breakpoint
ALTER TABLE "oauth_sessions" ADD COLUMN "csrf_token_hash" "bytea";--> statement-breakpoint
UPDATE "oauth_sessions" SET "revoked_at" = COALESCE("revoked_at", now()), "csrf_token_hash" = decode(repeat('00', 32), 'hex');--> statement-breakpoint
ALTER TABLE "oauth_sessions" ALTER COLUMN "csrf_token_hash" SET NOT NULL;--> statement-breakpoint
ALTER TABLE "webauthn_challenges" ADD COLUMN "initial_passkey_enrollment_id" uuid;--> statement-breakpoint
ALTER TABLE "initial_passkey_enrollments" ADD CONSTRAINT "initial_passkey_enrollments_account_fk" FOREIGN KEY ("account_id") REFERENCES "public"."identity_accounts"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
CREATE INDEX "initial_passkey_enrollments_expiry_idx" ON "initial_passkey_enrollments" USING btree ("expires_at");--> statement-breakpoint
CREATE UNIQUE INDEX "initial_passkey_enrollments_active_account_uq" ON "initial_passkey_enrollments" USING btree ("account_id") WHERE "initial_passkey_enrollments"."consumed_at" IS NULL AND "initial_passkey_enrollments"."invalidated_at" IS NULL;--> statement-breakpoint
ALTER TABLE "webauthn_challenges" ADD CONSTRAINT "webauthn_challenges_initial_enrollment_account_fk" FOREIGN KEY ("initial_passkey_enrollment_id","account_id") REFERENCES "public"."initial_passkey_enrollments"("id","account_id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "oauth_sessions" ADD CONSTRAINT "oauth_sessions_csrf_token_hash_length" CHECK (octet_length("oauth_sessions"."csrf_token_hash") = 32);--> statement-breakpoint
ALTER TABLE "webauthn_challenges" ADD CONSTRAINT "webauthn_challenges_initial_enrollment_purpose" CHECK ("webauthn_challenges"."initial_passkey_enrollment_id" IS NULL OR "webauthn_challenges"."purpose" = 'registration');
