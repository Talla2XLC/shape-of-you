CREATE TYPE "public"."recovery_erasure_reason" AS ENUM('user_request', 'retention_expired');--> statement-breakpoint
CREATE TYPE "public"."recovery_erasure_status" AS ENUM('pending', 'processing', 'completed');--> statement-breakpoint
CREATE TABLE "recovery_erasure_requests" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"person_id" uuid NOT NULL,
	"connection_id" uuid NOT NULL,
	"reason" "recovery_erasure_reason" NOT NULL,
	"idempotency_key" varchar(256) NOT NULL,
	"authority_id" uuid,
	"status" "recovery_erasure_status" DEFAULT 'pending' NOT NULL,
	"attempt_count" integer DEFAULT 0 NOT NULL,
	"next_attempt_at" timestamp with time zone DEFAULT now() NOT NULL,
	"lease_owner" varchar(128),
	"lease_until" timestamp with time zone,
	"last_failure_code" varchar(64),
	"requested_at" timestamp with time zone DEFAULT now() NOT NULL,
	"quarantined_at" timestamp with time zone NOT NULL,
	"completed_at" timestamp with time zone,
	CONSTRAINT "recovery_erasure_person_connection_uq" UNIQUE("person_id","connection_id"),
	CONSTRAINT "recovery_erasure_idempotency_uq" UNIQUE("person_id","idempotency_key"),
	CONSTRAINT "recovery_erasure_attempt_count" CHECK ("recovery_erasure_requests"."attempt_count" >= 0),
	CONSTRAINT "recovery_erasure_authority_shape" CHECK (("recovery_erasure_requests"."reason" = 'user_request' AND "recovery_erasure_requests"."authority_id" IS NOT NULL)
          OR ("recovery_erasure_requests"."reason" = 'retention_expired' AND "recovery_erasure_requests"."authority_id" IS NULL)),
	CONSTRAINT "recovery_erasure_status_shape" CHECK (("recovery_erasure_requests"."status" = 'pending' AND "recovery_erasure_requests"."completed_at" IS NULL)
          OR ("recovery_erasure_requests"."status" = 'processing' AND "recovery_erasure_requests"."lease_owner" IS NOT NULL AND "recovery_erasure_requests"."lease_until" IS NOT NULL AND "recovery_erasure_requests"."completed_at" IS NULL)
          OR ("recovery_erasure_requests"."status" = 'completed' AND "recovery_erasure_requests"."lease_owner" IS NULL AND "recovery_erasure_requests"."lease_until" IS NULL AND "recovery_erasure_requests"."completed_at" IS NOT NULL))
);
--> statement-breakpoint
ALTER TABLE "recovery_connections" DROP CONSTRAINT "recovery_connections_status_shape";--> statement-breakpoint
ALTER TABLE "recovery_connections" ADD COLUMN "erasure_requested_at" timestamp with time zone;--> statement-breakpoint
ALTER TABLE "recovery_erasure_requests" ADD CONSTRAINT "recovery_erasure_person_fk" FOREIGN KEY ("person_id") REFERENCES "public"."persons"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
CREATE UNIQUE INDEX "recovery_erasure_authority_uq" ON "recovery_erasure_requests" USING btree ("authority_id") WHERE "recovery_erasure_requests"."authority_id" IS NOT NULL;--> statement-breakpoint
CREATE INDEX "recovery_erasure_claim_idx" ON "recovery_erasure_requests" USING btree ("status","next_attempt_at","lease_until");--> statement-breakpoint
ALTER TABLE "recovery_connections" ADD CONSTRAINT "recovery_connections_status_shape" CHECK (("recovery_connections"."status" = 'active' AND "recovery_connections"."disconnected_at" IS NULL AND "recovery_connections"."erasure_requested_at" IS NULL)
          OR ("recovery_connections"."status" = 'disconnected' AND "recovery_connections"."disconnected_at" IS NOT NULL));