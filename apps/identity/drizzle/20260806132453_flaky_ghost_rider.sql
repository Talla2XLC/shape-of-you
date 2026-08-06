ALTER TYPE "public"."identity_security_event_type" ADD VALUE 'totp_factor_enrolled' BEFORE 'recovery_codes_issued';--> statement-breakpoint
ALTER TYPE "public"."identity_security_event_type" ADD VALUE 'totp_recovery_started' BEFORE 'recovery_codes_issued';--> statement-breakpoint
CREATE TABLE "totp_credentials" (
	"id" uuid PRIMARY KEY NOT NULL,
	"account_id" uuid NOT NULL,
	"secret_ciphertext" "bytea" NOT NULL,
	"secret_nonce" "bytea" NOT NULL,
	"secret_tag" "bytea" NOT NULL,
	"key_id" varchar(64) NOT NULL,
	"last_accepted_step" bigint,
	"failed_attempts" integer DEFAULT 0 NOT NULL,
	"attempt_window_started_at" timestamp with time zone,
	"locked_until" timestamp with time zone,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	"verified_at" timestamp with time zone,
	"revoked_at" timestamp with time zone,
	CONSTRAINT "totp_credentials_id_account_uq" UNIQUE("id","account_id"),
	CONSTRAINT "totp_credentials_ciphertext_nonempty" CHECK (octet_length("totp_credentials"."secret_ciphertext") > 0),
	CONSTRAINT "totp_credentials_nonce_length" CHECK (octet_length("totp_credentials"."secret_nonce") = 12),
	CONSTRAINT "totp_credentials_tag_length" CHECK (octet_length("totp_credentials"."secret_tag") = 16),
	CONSTRAINT "totp_credentials_key_id_nonempty" CHECK (length(btrim("totp_credentials"."key_id")) > 0),
	CONSTRAINT "totp_credentials_failed_attempts_range" CHECK ("totp_credentials"."failed_attempts" BETWEEN 0 AND 5),
	CONSTRAINT "totp_credentials_verification_time" CHECK ("totp_credentials"."verified_at" IS NULL OR "totp_credentials"."verified_at" >= "totp_credentials"."created_at"),
	CONSTRAINT "totp_credentials_revocation_time" CHECK ("totp_credentials"."revoked_at" IS NULL OR "totp_credentials"."revoked_at" >= "totp_credentials"."created_at")
);
--> statement-breakpoint
CREATE TABLE "totp_recovery_challenge_bindings" (
	"challenge_id" uuid PRIMARY KEY NOT NULL,
	"recovery_session_id" uuid NOT NULL,
	"account_id" uuid NOT NULL,
	CONSTRAINT "totp_recovery_challenge_session_uq" UNIQUE("recovery_session_id")
);
--> statement-breakpoint
CREATE TABLE "totp_recovery_sessions" (
	"id" uuid PRIMARY KEY NOT NULL,
	"account_id" uuid NOT NULL,
	"totp_credential_id" uuid NOT NULL,
	"token_hash" "bytea" NOT NULL,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	"expires_at" timestamp with time zone NOT NULL,
	"completed_at" timestamp with time zone,
	"invalidated_at" timestamp with time zone,
	CONSTRAINT "totp_recovery_sessions_id_account_uq" UNIQUE("id","account_id"),
	CONSTRAINT "totp_recovery_sessions_token_hash_uq" UNIQUE("token_hash"),
	CONSTRAINT "totp_recovery_sessions_token_hash_length" CHECK (octet_length("totp_recovery_sessions"."token_hash") = 32),
	CONSTRAINT "totp_recovery_sessions_expiry_after_creation" CHECK ("totp_recovery_sessions"."expires_at" > "totp_recovery_sessions"."created_at"),
	CONSTRAINT "totp_recovery_sessions_max_lifetime" CHECK ("totp_recovery_sessions"."expires_at" <= "totp_recovery_sessions"."created_at" + interval '15 minutes'),
	CONSTRAINT "totp_recovery_sessions_completion_window" CHECK ("totp_recovery_sessions"."completed_at" IS NULL OR ("totp_recovery_sessions"."completed_at" >= "totp_recovery_sessions"."created_at" AND "totp_recovery_sessions"."completed_at" <= "totp_recovery_sessions"."expires_at")),
	CONSTRAINT "totp_recovery_sessions_invalidation_time" CHECK ("totp_recovery_sessions"."invalidated_at" IS NULL OR "totp_recovery_sessions"."invalidated_at" >= "totp_recovery_sessions"."created_at"),
	CONSTRAINT "totp_recovery_sessions_terminal_state" CHECK (NOT ("totp_recovery_sessions"."completed_at" IS NOT NULL AND "totp_recovery_sessions"."invalidated_at" IS NOT NULL))
);
--> statement-breakpoint
ALTER TABLE "identity_accounts" ADD COLUMN "login_handle" varchar(64);--> statement-breakpoint
-- noinspection SqlResolve
ALTER TABLE "totp_credentials" ADD CONSTRAINT "totp_credentials_account_id_identity_accounts_id_fk" FOREIGN KEY ("account_id") REFERENCES "public"."identity_accounts"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
-- noinspection SqlResolve
ALTER TABLE "totp_recovery_challenge_bindings" ADD CONSTRAINT "totp_recovery_challenge_webauthn_fk" FOREIGN KEY ("challenge_id") REFERENCES "public"."webauthn_challenges"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
-- noinspection SqlResolve
ALTER TABLE "totp_recovery_challenge_bindings" ADD CONSTRAINT "totp_recovery_challenge_session_account_fk" FOREIGN KEY ("recovery_session_id","account_id") REFERENCES "public"."totp_recovery_sessions"("id","account_id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
-- noinspection SqlResolve
ALTER TABLE "totp_recovery_sessions" ADD CONSTRAINT "totp_recovery_sessions_credential_account_fk" FOREIGN KEY ("totp_credential_id","account_id") REFERENCES "public"."totp_credentials"("id","account_id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
CREATE UNIQUE INDEX "totp_credentials_active_account_uq" ON "totp_credentials" USING btree ("account_id") WHERE "totp_credentials"."verified_at" IS NOT NULL AND "totp_credentials"."revoked_at" IS NULL;--> statement-breakpoint
CREATE UNIQUE INDEX "totp_credentials_pending_account_uq" ON "totp_credentials" USING btree ("account_id") WHERE "totp_credentials"."verified_at" IS NULL AND "totp_credentials"."revoked_at" IS NULL;--> statement-breakpoint
CREATE INDEX "totp_recovery_sessions_account_idx" ON "totp_recovery_sessions" USING btree ("account_id");--> statement-breakpoint
CREATE INDEX "totp_recovery_sessions_expiry_idx" ON "totp_recovery_sessions" USING btree ("expires_at");--> statement-breakpoint
ALTER TABLE "identity_accounts" ADD CONSTRAINT "identity_accounts_login_handle_uq" UNIQUE("login_handle");--> statement-breakpoint
ALTER TABLE "identity_accounts" ADD CONSTRAINT "identity_accounts_login_handle_format" CHECK ("identity_accounts"."login_handle" IS NULL OR "identity_accounts"."login_handle" ~ '^[a-z0-9][a-z0-9._-]{2,63}$');
