CREATE TYPE "public"."identity_account_status" AS ENUM('active', 'disabled');--> statement-breakpoint
CREATE TYPE "public"."webauthn_challenge_purpose" AS ENUM('registration', 'authentication', 'recovery_registration');--> statement-breakpoint
CREATE TYPE "public"."webauthn_credential_device_type" AS ENUM('single_device', 'multi_device');--> statement-breakpoint
CREATE TYPE "public"."webauthn_transport" AS ENUM('ble', 'cable', 'hybrid', 'internal', 'nfc', 'smart_card', 'usb');--> statement-breakpoint
CREATE TYPE "public"."webauthn_user_verification" AS ENUM('required', 'preferred', 'discouraged');--> statement-breakpoint
CREATE TABLE "identity_accounts" (
	"id" uuid PRIMARY KEY NOT NULL,
	"subject" uuid NOT NULL,
	"webauthn_user_handle" "bytea" NOT NULL,
	"display_name" varchar(200) NOT NULL,
	"status" "identity_account_status" DEFAULT 'active' NOT NULL,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	"updated_at" timestamp with time zone DEFAULT now() NOT NULL,
	"disabled_at" timestamp with time zone,
	CONSTRAINT "identity_accounts_subject_uq" UNIQUE("subject"),
	CONSTRAINT "identity_accounts_webauthn_user_handle_uq" UNIQUE("webauthn_user_handle"),
	CONSTRAINT "identity_accounts_subject_separate" CHECK ("identity_accounts"."subject" <> "identity_accounts"."id"),
	CONSTRAINT "identity_accounts_user_handle_length" CHECK (octet_length("identity_accounts"."webauthn_user_handle") = 32),
	CONSTRAINT "identity_accounts_display_name_nonempty" CHECK (length(btrim("identity_accounts"."display_name")) > 0),
	CONSTRAINT "identity_accounts_disabled_state" CHECK (("identity_accounts"."status" = 'active' AND "identity_accounts"."disabled_at" IS NULL) OR ("identity_accounts"."status" = 'disabled' AND "identity_accounts"."disabled_at" IS NOT NULL))
);
--> statement-breakpoint
CREATE TABLE "passkey_recovery_sessions" (
	"id" uuid PRIMARY KEY NOT NULL,
	"account_id" uuid NOT NULL,
	"recovery_code_id" uuid NOT NULL,
	"token_hash" "bytea" NOT NULL,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	"expires_at" timestamp with time zone NOT NULL,
	"completed_at" timestamp with time zone,
	"invalidated_at" timestamp with time zone,
	CONSTRAINT "passkey_recovery_sessions_code_uq" UNIQUE("recovery_code_id"),
	CONSTRAINT "passkey_recovery_sessions_token_hash_uq" UNIQUE("token_hash"),
	CONSTRAINT "passkey_recovery_sessions_token_hash_length" CHECK (octet_length("passkey_recovery_sessions"."token_hash") = 32),
	CONSTRAINT "passkey_recovery_sessions_expiry_after_creation" CHECK ("passkey_recovery_sessions"."expires_at" > "passkey_recovery_sessions"."created_at"),
	CONSTRAINT "passkey_recovery_sessions_completion_window" CHECK ("passkey_recovery_sessions"."completed_at" IS NULL OR ("passkey_recovery_sessions"."completed_at" >= "passkey_recovery_sessions"."created_at" AND "passkey_recovery_sessions"."completed_at" <= "passkey_recovery_sessions"."expires_at")),
	CONSTRAINT "passkey_recovery_sessions_invalidation_after_creation" CHECK ("passkey_recovery_sessions"."invalidated_at" IS NULL OR "passkey_recovery_sessions"."invalidated_at" >= "passkey_recovery_sessions"."created_at"),
	CONSTRAINT "passkey_recovery_sessions_terminal_state" CHECK ("passkey_recovery_sessions"."completed_at" IS NULL OR "passkey_recovery_sessions"."invalidated_at" IS NULL)
);
--> statement-breakpoint
CREATE TABLE "recovery_code_batches" (
	"id" uuid PRIMARY KEY NOT NULL,
	"account_id" uuid NOT NULL,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	"expires_at" timestamp with time zone,
	"invalidated_at" timestamp with time zone,
	CONSTRAINT "recovery_code_batches_id_account_uq" UNIQUE("id","account_id"),
	CONSTRAINT "recovery_code_batches_expiry_after_creation" CHECK ("recovery_code_batches"."expires_at" IS NULL OR "recovery_code_batches"."expires_at" > "recovery_code_batches"."created_at"),
	CONSTRAINT "recovery_code_batches_invalidation_after_creation" CHECK ("recovery_code_batches"."invalidated_at" IS NULL OR "recovery_code_batches"."invalidated_at" >= "recovery_code_batches"."created_at")
);
--> statement-breakpoint
CREATE TABLE "recovery_codes" (
	"id" uuid PRIMARY KEY NOT NULL,
	"batch_id" uuid NOT NULL,
	"account_id" uuid NOT NULL,
	"code_hash" "bytea" NOT NULL,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	"used_at" timestamp with time zone,
	CONSTRAINT "recovery_codes_id_account_uq" UNIQUE("id","account_id"),
	CONSTRAINT "recovery_codes_hash_uq" UNIQUE("code_hash"),
	CONSTRAINT "recovery_codes_hash_length" CHECK (octet_length("recovery_codes"."code_hash") = 32),
	CONSTRAINT "recovery_codes_use_after_creation" CHECK ("recovery_codes"."used_at" IS NULL OR "recovery_codes"."used_at" >= "recovery_codes"."created_at")
);
--> statement-breakpoint
CREATE TABLE "webauthn_challenges" (
	"id" uuid PRIMARY KEY NOT NULL,
	"account_id" uuid,
	"purpose" "webauthn_challenge_purpose" NOT NULL,
	"challenge_hash" "bytea" NOT NULL,
	"expected_rp_id" varchar(253) NOT NULL,
	"expected_origin" text NOT NULL,
	"user_verification" "webauthn_user_verification" NOT NULL,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	"expires_at" timestamp with time zone NOT NULL,
	"consumed_at" timestamp with time zone,
	CONSTRAINT "webauthn_challenges_hash_uq" UNIQUE("challenge_hash"),
	CONSTRAINT "webauthn_challenges_hash_length" CHECK (octet_length("webauthn_challenges"."challenge_hash") = 32),
	CONSTRAINT "webauthn_challenges_registration_account" CHECK ("webauthn_challenges"."purpose" = 'authentication' OR "webauthn_challenges"."account_id" IS NOT NULL),
	CONSTRAINT "webauthn_challenges_expiry_after_creation" CHECK ("webauthn_challenges"."expires_at" > "webauthn_challenges"."created_at"),
	CONSTRAINT "webauthn_challenges_consumption_window" CHECK ("webauthn_challenges"."consumed_at" IS NULL OR ("webauthn_challenges"."consumed_at" >= "webauthn_challenges"."created_at" AND "webauthn_challenges"."consumed_at" <= "webauthn_challenges"."expires_at"))
);
--> statement-breakpoint
CREATE TABLE "webauthn_credentials" (
	"id" uuid PRIMARY KEY NOT NULL,
	"account_id" uuid NOT NULL,
	"credential_id" "bytea" NOT NULL,
	"public_key" "bytea" NOT NULL,
	"counter" bigint DEFAULT 0 NOT NULL,
	"device_type" "webauthn_credential_device_type" NOT NULL,
	"backed_up" boolean DEFAULT false NOT NULL,
	"transports" "webauthn_transport"[] DEFAULT ARRAY[]::webauthn_transport[] NOT NULL,
	"label" varchar(200),
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	"last_used_at" timestamp with time zone,
	"revoked_at" timestamp with time zone,
	CONSTRAINT "webauthn_credentials_credential_id_uq" UNIQUE("credential_id"),
	CONSTRAINT "webauthn_credentials_credential_id_length" CHECK (octet_length("webauthn_credentials"."credential_id") BETWEEN 1 AND 1024),
	CONSTRAINT "webauthn_credentials_public_key_length" CHECK (octet_length("webauthn_credentials"."public_key") BETWEEN 1 AND 4096),
	CONSTRAINT "webauthn_credentials_counter_range" CHECK ("webauthn_credentials"."counter" BETWEEN 0 AND 4294967295),
	CONSTRAINT "webauthn_credentials_label_nonempty" CHECK ("webauthn_credentials"."label" IS NULL OR length(btrim("webauthn_credentials"."label")) > 0),
	CONSTRAINT "webauthn_credentials_use_after_creation" CHECK ("webauthn_credentials"."last_used_at" IS NULL OR "webauthn_credentials"."last_used_at" >= "webauthn_credentials"."created_at"),
	CONSTRAINT "webauthn_credentials_revocation_after_creation" CHECK ("webauthn_credentials"."revoked_at" IS NULL OR "webauthn_credentials"."revoked_at" >= "webauthn_credentials"."created_at")
);
--> statement-breakpoint
ALTER TABLE "passkey_recovery_sessions" ADD CONSTRAINT "passkey_recovery_sessions_code_account_fk" FOREIGN KEY ("recovery_code_id","account_id") REFERENCES "public"."recovery_codes"("id","account_id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "recovery_code_batches" ADD CONSTRAINT "recovery_code_batches_account_id_identity_accounts_id_fk" FOREIGN KEY ("account_id") REFERENCES "public"."identity_accounts"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "recovery_codes" ADD CONSTRAINT "recovery_codes_batch_account_fk" FOREIGN KEY ("batch_id","account_id") REFERENCES "public"."recovery_code_batches"("id","account_id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "webauthn_challenges" ADD CONSTRAINT "webauthn_challenges_account_id_identity_accounts_id_fk" FOREIGN KEY ("account_id") REFERENCES "public"."identity_accounts"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "webauthn_credentials" ADD CONSTRAINT "webauthn_credentials_account_id_identity_accounts_id_fk" FOREIGN KEY ("account_id") REFERENCES "public"."identity_accounts"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
CREATE INDEX "passkey_recovery_sessions_account_idx" ON "passkey_recovery_sessions" USING btree ("account_id");--> statement-breakpoint
CREATE INDEX "passkey_recovery_sessions_expiry_idx" ON "passkey_recovery_sessions" USING btree ("expires_at");--> statement-breakpoint
CREATE INDEX "recovery_code_batches_account_idx" ON "recovery_code_batches" USING btree ("account_id");--> statement-breakpoint
CREATE UNIQUE INDEX "recovery_code_batches_active_account_uq" ON "recovery_code_batches" USING btree ("account_id") WHERE "recovery_code_batches"."invalidated_at" IS NULL;--> statement-breakpoint
CREATE INDEX "recovery_codes_batch_idx" ON "recovery_codes" USING btree ("batch_id");--> statement-breakpoint
CREATE INDEX "webauthn_challenges_account_idx" ON "webauthn_challenges" USING btree ("account_id");--> statement-breakpoint
CREATE INDEX "webauthn_challenges_expiry_idx" ON "webauthn_challenges" USING btree ("expires_at");--> statement-breakpoint
CREATE INDEX "webauthn_credentials_account_idx" ON "webauthn_credentials" USING btree ("account_id");--> statement-breakpoint
CREATE UNIQUE INDEX "webauthn_credentials_active_account_label_uq" ON "webauthn_credentials" USING btree ("account_id","label") WHERE "webauthn_credentials"."label" IS NOT NULL AND "webauthn_credentials"."revoked_at" IS NULL;