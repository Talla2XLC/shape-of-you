CREATE TYPE "public"."integration_connection_lifecycle" AS ENUM('active', 'degraded', 'disconnected');--> statement-breakpoint
CREATE TYPE "public"."integration_inbox_kind" AS ENUM('wellness', 'activity');--> statement-breakpoint
CREATE TYPE "public"."integration_inbox_status" AS ENUM('pending', 'normalized', 'failed');--> statement-breakpoint
CREATE TYPE "public"."integration_sync_failure" AS ENUM('authorization_required', 'provider_rate_limited', 'provider_timeout', 'provider_unavailable', 'provider_response_invalid');--> statement-breakpoint
ALTER TYPE "public"."source_channel" ADD VALUE IF NOT EXISTS 'account';--> statement-breakpoint
ALTER TABLE "recovery_observations" ADD COLUMN "withdrawn_at" timestamp with time zone;--> statement-breakpoint
ALTER TABLE "recovery_observations" DROP CONSTRAINT "recovery_observations_device_shape";--> statement-breakpoint
ALTER TABLE "recovery_observations" ADD CONSTRAINT "recovery_observations_device_shape" CHECK (("recovery_observations"."source"::text IN ('device', 'account') AND "recovery_observations"."connection_id" IS NOT NULL AND "recovery_observations"."consent_id" IS NOT NULL) OR ("recovery_observations"."source"::text NOT IN ('device', 'account') AND "recovery_observations"."connection_id" IS NULL AND "recovery_observations"."consent_id" IS NULL));--> statement-breakpoint
CREATE TABLE "integration_activity_facts" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"connection_id" uuid NOT NULL,
	"person_id" uuid NOT NULL,
	"provider_identity" varchar(256) NOT NULL,
	"normalized_checksum" varchar(64) NOT NULL,
	"occurred_at" timestamp with time zone NOT NULL,
	"local_date" date NOT NULL,
	"timezone" varchar(64) NOT NULL,
	"name" varchar(256) NOT NULL,
	"duration_seconds" integer NOT NULL,
	"distance_meters" numeric(12, 3),
	"training_load" numeric(12, 3),
	"average_heart_rate" numeric(8, 3),
	"maximum_heart_rate" numeric(8, 3),
	"device_name" varchar(256),
	"source_provider" varchar(64) NOT NULL,
	"garmin_attributed" boolean NOT NULL,
	"supersedes_id" uuid,
	"correction_reason" varchar(256),
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	CONSTRAINT "integration_activity_duration_nonnegative" CHECK ("integration_activity_facts"."duration_seconds" >= 0),
	CONSTRAINT "integration_activity_correction_shape" CHECK (("integration_activity_facts"."supersedes_id" IS NULL AND "integration_activity_facts"."correction_reason" IS NULL)
        OR ("integration_activity_facts"."supersedes_id" IS NOT NULL AND "integration_activity_facts"."correction_reason" IS NOT NULL))
);
--> statement-breakpoint
CREATE TABLE "integration_authorization_transactions" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"person_id" uuid NOT NULL,
	"provider_key" varchar(64) NOT NULL,
	"state_hash" varchar(64) NOT NULL,
	"return_to" varchar(2048) NOT NULL,
	"expires_at" timestamp with time zone NOT NULL,
	"consumed_at" timestamp with time zone,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	CONSTRAINT "integration_auth_transaction_state_uq" UNIQUE("provider_key","state_hash"),
	CONSTRAINT "integration_auth_transaction_return_to" CHECK ("integration_authorization_transactions"."return_to" LIKE '/%' AND "integration_authorization_transactions"."return_to" NOT LIKE '//%')
);
--> statement-breakpoint
CREATE TABLE "integration_connections" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"person_id" uuid NOT NULL,
	"recovery_connection_id" uuid NOT NULL,
	"consent_id" uuid NOT NULL,
	"provider_key" varchar(64) NOT NULL,
	"external_user_id" varchar(128) NOT NULL,
	"lifecycle" "integration_connection_lifecycle" DEFAULT 'active' NOT NULL,
	"import_enabled" boolean DEFAULT true NOT NULL,
	"credential_key_id" varchar(64),
	"credential_nonce" varchar(64),
	"credential_ciphertext" text,
	"credential_tag" varchar(64),
	"failure_code" "integration_sync_failure",
	"last_attempt_at" timestamp with time zone,
	"last_successful_sync_at" timestamp with time zone,
	"last_data_at" timestamp with time zone,
	"next_attempt_at" timestamp with time zone DEFAULT now() NOT NULL,
	"lease_owner" varchar(128),
	"lease_until" timestamp with time zone,
	"remote_disconnect_pending" boolean DEFAULT false NOT NULL,
	"connected_at" timestamp with time zone DEFAULT now() NOT NULL,
	"disconnected_at" timestamp with time zone,
	"updated_at" timestamp with time zone DEFAULT now() NOT NULL,
	CONSTRAINT "integration_connections_person_provider_uq" UNIQUE("person_id","provider_key"),
	CONSTRAINT "integration_connections_recovery_uq" UNIQUE("recovery_connection_id"),
	CONSTRAINT "integration_connections_credential_shape" CHECK (("integration_connections"."credential_key_id" IS NULL AND "integration_connections"."credential_nonce" IS NULL AND "integration_connections"."credential_ciphertext" IS NULL AND "integration_connections"."credential_tag" IS NULL)
        OR ("integration_connections"."credential_key_id" IS NOT NULL AND "integration_connections"."credential_nonce" IS NOT NULL AND "integration_connections"."credential_ciphertext" IS NOT NULL AND "integration_connections"."credential_tag" IS NOT NULL)),
	CONSTRAINT "integration_connections_lifecycle_shape" CHECK (("integration_connections"."lifecycle" = 'disconnected' AND "integration_connections"."import_enabled" = false AND "integration_connections"."disconnected_at" IS NOT NULL)
        OR ("integration_connections"."lifecycle" <> 'disconnected' AND "integration_connections"."disconnected_at" IS NULL))
);
--> statement-breakpoint
CREATE TABLE "integration_inbox" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"connection_id" uuid NOT NULL,
	"kind" "integration_inbox_kind" NOT NULL,
	"provider_identity" varchar(256) NOT NULL,
	"checksum" varchar(64) NOT NULL,
	"status" "integration_inbox_status" DEFAULT 'pending' NOT NULL,
	"failure_code" "integration_sync_failure",
	"received_at" timestamp with time zone DEFAULT now() NOT NULL,
	"normalized_at" timestamp with time zone,
	CONSTRAINT "integration_inbox_delivery_uq" UNIQUE("connection_id","kind","provider_identity","checksum")
);
--> statement-breakpoint
CREATE TABLE "integration_recovery_facts" (
	"connection_id" uuid NOT NULL,
	"provider_identity" varchar(256) NOT NULL,
	"fact_key" varchar(64) NOT NULL,
	"normalized_checksum" varchar(64) NOT NULL,
	"observation_id" uuid NOT NULL,
	"updated_at" timestamp with time zone DEFAULT now() NOT NULL,
	CONSTRAINT "integration_recovery_fact_identity_uq" UNIQUE("connection_id","provider_identity","fact_key")
);
--> statement-breakpoint
ALTER TABLE "integration_activity_facts" ADD CONSTRAINT "integration_activity_connection_fk" FOREIGN KEY ("connection_id") REFERENCES "public"."integration_connections"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "integration_activity_facts" ADD CONSTRAINT "integration_activity_person_fk" FOREIGN KEY ("person_id") REFERENCES "public"."persons"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "integration_activity_facts" ADD CONSTRAINT "integration_activity_supersedes_fk" FOREIGN KEY ("supersedes_id") REFERENCES "public"."integration_activity_facts"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "integration_authorization_transactions" ADD CONSTRAINT "integration_auth_transaction_person_fk" FOREIGN KEY ("person_id") REFERENCES "public"."persons"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "integration_connections" ADD CONSTRAINT "integration_connection_recovery_person_fk" FOREIGN KEY ("recovery_connection_id","person_id") REFERENCES "public"."recovery_connections"("id","person_id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "integration_connections" ADD CONSTRAINT "integration_connection_consent_recovery_fk" FOREIGN KEY ("consent_id","recovery_connection_id","person_id") REFERENCES "public"."recovery_consents"("id","connection_id","person_id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "integration_inbox" ADD CONSTRAINT "integration_inbox_connection_fk" FOREIGN KEY ("connection_id") REFERENCES "public"."integration_connections"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "integration_recovery_facts" ADD CONSTRAINT "integration_recovery_fact_connection_fk" FOREIGN KEY ("connection_id") REFERENCES "public"."integration_connections"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "integration_recovery_facts" ADD CONSTRAINT "integration_recovery_fact_observation_fk" FOREIGN KEY ("observation_id") REFERENCES "public"."recovery_observations"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
CREATE UNIQUE INDEX "integration_activity_supersedes_uq" ON "integration_activity_facts" USING btree ("supersedes_id") WHERE "integration_activity_facts"."supersedes_id" IS NOT NULL;--> statement-breakpoint
CREATE INDEX "integration_auth_transaction_expiry_idx" ON "integration_authorization_transactions" USING btree ("expires_at");--> statement-breakpoint
CREATE INDEX "integration_connections_claim_idx" ON "integration_connections" USING btree ("import_enabled","next_attempt_at","lease_until");
