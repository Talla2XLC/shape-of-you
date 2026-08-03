CREATE TYPE "public"."identity_security_actor_kind" AS ENUM('anonymous', 'account', 'oauth_client', 'system');--> statement-breakpoint
CREATE TYPE "public"."identity_security_event_outcome" AS ENUM('succeeded', 'denied', 'failed');--> statement-breakpoint
CREATE TYPE "public"."identity_security_event_type" AS ENUM('account_status_changed', 'passkey_registered', 'passkey_authentication', 'passkey_revoked', 'recovery_codes_issued', 'recovery_code_used', 'passkey_recovery_completed', 'oauth_authorization', 'oauth_code_exchange', 'oauth_refresh_rotation', 'oauth_refresh_reuse_detected', 'oauth_session_revoked', 'signing_key_lifecycle_changed');--> statement-breakpoint
CREATE TYPE "public"."oauth_signing_key_algorithm" AS ENUM('ES256');--> statement-breakpoint
CREATE TYPE "public"."oauth_signing_key_status" AS ENUM('staged', 'active', 'verifying', 'retired', 'revoked');--> statement-breakpoint
CREATE TABLE "identity_security_events" (
	"id" uuid PRIMARY KEY NOT NULL,
	"event_type" "identity_security_event_type" NOT NULL,
	"outcome" "identity_security_event_outcome" NOT NULL,
	"actor_kind" "identity_security_actor_kind" NOT NULL,
	"actor_account_id" uuid,
	"account_id" uuid,
	"client_id" varchar(200),
	"session_id" uuid,
	"signing_key_id" uuid,
	"correlation_id" varchar(200) NOT NULL,
	"source_address_hash" "bytea",
	"user_agent_hash" "bytea",
	"occurred_at" timestamp with time zone DEFAULT now() NOT NULL,
	CONSTRAINT "identity_security_events_actor_account" CHECK (("identity_security_events"."actor_kind" = 'account' AND "identity_security_events"."actor_account_id" IS NOT NULL) OR ("identity_security_events"."actor_kind" <> 'account' AND "identity_security_events"."actor_account_id" IS NULL)),
	CONSTRAINT "identity_security_events_client_actor" CHECK ("identity_security_events"."actor_kind" <> 'oauth_client' OR "identity_security_events"."client_id" IS NOT NULL),
	CONSTRAINT "identity_security_events_session_account" CHECK (("identity_security_events"."session_id" IS NULL AND "identity_security_events"."account_id" IS NULL) OR ("identity_security_events"."session_id" IS NOT NULL AND "identity_security_events"."account_id" IS NOT NULL) OR ("identity_security_events"."session_id" IS NULL AND "identity_security_events"."account_id" IS NOT NULL)),
	CONSTRAINT "identity_security_events_correlation_nonempty" CHECK (length(btrim("identity_security_events"."correlation_id")) > 0),
	CONSTRAINT "identity_security_events_source_hash_length" CHECK ("identity_security_events"."source_address_hash" IS NULL OR octet_length("identity_security_events"."source_address_hash") = 32),
	CONSTRAINT "identity_security_events_agent_hash_length" CHECK ("identity_security_events"."user_agent_hash" IS NULL OR octet_length("identity_security_events"."user_agent_hash") = 32)
);
--> statement-breakpoint
CREATE TABLE "oauth_signing_keys" (
	"id" uuid PRIMARY KEY NOT NULL,
	"key_id" varchar(200) NOT NULL,
	"algorithm" "oauth_signing_key_algorithm" NOT NULL,
	"public_key_spki" "bytea" NOT NULL,
	"secret_provider_handle" varchar(500) NOT NULL,
	"status" "oauth_signing_key_status" DEFAULT 'staged' NOT NULL,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	"published_at" timestamp with time zone,
	"activated_at" timestamp with time zone,
	"signing_stopped_at" timestamp with time zone,
	"retired_at" timestamp with time zone,
	"revoked_at" timestamp with time zone,
	CONSTRAINT "oauth_signing_keys_key_id_uq" UNIQUE("key_id"),
	CONSTRAINT "oauth_signing_keys_secret_handle_uq" UNIQUE("secret_provider_handle"),
	CONSTRAINT "oauth_signing_keys_key_id_nonempty" CHECK (length(btrim("oauth_signing_keys"."key_id")) > 0),
	CONSTRAINT "oauth_signing_keys_public_spki_length" CHECK (octet_length("oauth_signing_keys"."public_key_spki") BETWEEN 1 AND 8192),
	CONSTRAINT "oauth_signing_keys_secret_handle_nonempty" CHECK (length(btrim("oauth_signing_keys"."secret_provider_handle")) > 0),
	CONSTRAINT "oauth_signing_keys_published_after_creation" CHECK ("oauth_signing_keys"."published_at" IS NULL OR "oauth_signing_keys"."published_at" >= "oauth_signing_keys"."created_at"),
	CONSTRAINT "oauth_signing_keys_activated_after_publish" CHECK ("oauth_signing_keys"."activated_at" IS NULL OR ("oauth_signing_keys"."published_at" IS NOT NULL AND "oauth_signing_keys"."activated_at" >= "oauth_signing_keys"."published_at")),
	CONSTRAINT "oauth_signing_keys_stopped_after_activation" CHECK ("oauth_signing_keys"."signing_stopped_at" IS NULL OR ("oauth_signing_keys"."activated_at" IS NOT NULL AND "oauth_signing_keys"."signing_stopped_at" >= "oauth_signing_keys"."activated_at")),
	CONSTRAINT "oauth_signing_keys_retired_after_stop" CHECK ("oauth_signing_keys"."retired_at" IS NULL OR ("oauth_signing_keys"."signing_stopped_at" IS NOT NULL AND "oauth_signing_keys"."retired_at" >= "oauth_signing_keys"."signing_stopped_at")),
	CONSTRAINT "oauth_signing_keys_revoked_after_creation" CHECK ("oauth_signing_keys"."revoked_at" IS NULL OR "oauth_signing_keys"."revoked_at" >= "oauth_signing_keys"."created_at"),
	CONSTRAINT "oauth_signing_keys_lifecycle_state" CHECK (("oauth_signing_keys"."status" = 'staged' AND "oauth_signing_keys"."activated_at" IS NULL AND "oauth_signing_keys"."signing_stopped_at" IS NULL AND "oauth_signing_keys"."retired_at" IS NULL AND "oauth_signing_keys"."revoked_at" IS NULL) OR ("oauth_signing_keys"."status" = 'active' AND "oauth_signing_keys"."published_at" IS NOT NULL AND "oauth_signing_keys"."activated_at" IS NOT NULL AND "oauth_signing_keys"."signing_stopped_at" IS NULL AND "oauth_signing_keys"."retired_at" IS NULL AND "oauth_signing_keys"."revoked_at" IS NULL) OR ("oauth_signing_keys"."status" = 'verifying' AND "oauth_signing_keys"."published_at" IS NOT NULL AND "oauth_signing_keys"."activated_at" IS NOT NULL AND "oauth_signing_keys"."signing_stopped_at" IS NOT NULL AND "oauth_signing_keys"."retired_at" IS NULL AND "oauth_signing_keys"."revoked_at" IS NULL) OR ("oauth_signing_keys"."status" = 'retired' AND "oauth_signing_keys"."published_at" IS NOT NULL AND "oauth_signing_keys"."activated_at" IS NOT NULL AND "oauth_signing_keys"."signing_stopped_at" IS NOT NULL AND "oauth_signing_keys"."retired_at" IS NOT NULL AND "oauth_signing_keys"."revoked_at" IS NULL) OR ("oauth_signing_keys"."status" = 'revoked' AND "oauth_signing_keys"."revoked_at" IS NOT NULL))
);
--> statement-breakpoint
ALTER TABLE "identity_security_events" ADD CONSTRAINT "identity_sec_events_actor_account_fk" FOREIGN KEY ("actor_account_id") REFERENCES "public"."identity_accounts"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "identity_security_events" ADD CONSTRAINT "identity_sec_events_account_fk" FOREIGN KEY ("account_id") REFERENCES "public"."identity_accounts"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "identity_security_events" ADD CONSTRAINT "identity_sec_events_client_fk" FOREIGN KEY ("client_id") REFERENCES "public"."oauth_clients"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "identity_security_events" ADD CONSTRAINT "identity_sec_events_signing_key_fk" FOREIGN KEY ("signing_key_id") REFERENCES "public"."oauth_signing_keys"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "identity_security_events" ADD CONSTRAINT "identity_security_events_session_account_fk" FOREIGN KEY ("session_id","account_id") REFERENCES "public"."oauth_sessions"("id","account_id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
CREATE INDEX "identity_security_events_occurred_idx" ON "identity_security_events" USING btree ("occurred_at");--> statement-breakpoint
CREATE INDEX "identity_security_events_account_idx" ON "identity_security_events" USING btree ("account_id","occurred_at");--> statement-breakpoint
CREATE INDEX "identity_security_events_client_idx" ON "identity_security_events" USING btree ("client_id","occurred_at");--> statement-breakpoint
CREATE INDEX "identity_security_events_correlation_idx" ON "identity_security_events" USING btree ("correlation_id");--> statement-breakpoint
CREATE UNIQUE INDEX "oauth_signing_keys_one_active_uq" ON "oauth_signing_keys" USING btree ("status") WHERE "oauth_signing_keys"."status" = 'active';--> statement-breakpoint
CREATE INDEX "oauth_signing_keys_status_idx" ON "oauth_signing_keys" USING btree ("status");