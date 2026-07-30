CREATE TYPE "public"."person_kind" AS ENUM('real', 'synthetic');--> statement-breakpoint
CREATE TYPE "public"."person_status" AS ENUM('active', 'archived');--> statement-breakpoint
CREATE TYPE "public"."user_status" AS ENUM('active', 'disabled');--> statement-breakpoint
CREATE TYPE "public"."person_access_role" AS ENUM('owner', 'editor', 'viewer', 'coach');--> statement-breakpoint
CREATE TYPE "public"."person_access_grant_status" AS ENUM('active', 'revoked');--> statement-breakpoint
CREATE TABLE "persons" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"kind" "person_kind" DEFAULT 'real' NOT NULL,
	"status" "person_status" DEFAULT 'active' NOT NULL,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	"updated_at" timestamp with time zone DEFAULT now() NOT NULL
);--> statement-breakpoint
CREATE TABLE "users" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"status" "user_status" DEFAULT 'active' NOT NULL,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	"updated_at" timestamp with time zone DEFAULT now() NOT NULL
);--> statement-breakpoint
CREATE TABLE "person_access_grants" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"person_id" uuid NOT NULL,
	"user_id" uuid NOT NULL,
	"role" "person_access_role" NOT NULL,
	"status" "person_access_grant_status" DEFAULT 'active' NOT NULL,
	"granted_at" timestamp with time zone DEFAULT now() NOT NULL,
	"revoked_at" timestamp with time zone,
	CONSTRAINT "person_access_grants_revocation_state" CHECK (("person_access_grants"."status" = 'active' AND "person_access_grants"."revoked_at" IS NULL) OR ("person_access_grants"."status" = 'revoked' AND "person_access_grants"."revoked_at" IS NOT NULL))
);--> statement-breakpoint
CREATE TABLE "source_references" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"person_id" uuid NOT NULL,
	"channel" "weight_measurement_source" NOT NULL,
	"external_system" varchar(128),
	"external_record_id" varchar(512),
	"occurred_at" timestamp with time zone,
	"import_batch_id" uuid,
	"checksum" varchar(128),
	"raw_snapshot" jsonb,
	"contains_sensitive_data" boolean DEFAULT false NOT NULL,
	"ingested_at" timestamp with time zone DEFAULT now() NOT NULL,
	CONSTRAINT "source_references_external_pair" CHECK (("source_references"."external_system" IS NULL) = ("source_references"."external_record_id" IS NULL))
);--> statement-breakpoint
INSERT INTO "persons" ("id", "kind", "status")
VALUES ('00000000-0000-4000-8000-000000000001', 'synthetic', 'active')
ON CONFLICT ("id") DO NOTHING;--> statement-breakpoint
ALTER TABLE "weight_measurements" ADD COLUMN "person_id" uuid;--> statement-breakpoint
ALTER TABLE "weight_measurements" ADD COLUMN "source_reference_id" uuid;--> statement-breakpoint
ALTER TABLE "weight_measurements" ADD COLUMN "supersedes_id" uuid;--> statement-breakpoint
ALTER TABLE "weight_measurements" ADD COLUMN "correction_reason" varchar(512);--> statement-breakpoint
INSERT INTO "source_references" (
	"id",
	"person_id",
	"channel",
	"external_system",
	"external_record_id",
	"occurred_at",
	"raw_snapshot",
	"contains_sensitive_data",
	"ingested_at"
)
SELECT
	"id",
	'00000000-0000-4000-8000-000000000001',
	"source",
	CASE WHEN "source_record_id" IS NULL THEN NULL ELSE 'legacy' END,
	"source_record_id",
	"measured_at",
	"provenance",
	true,
	"created_at"
FROM "weight_measurements";--> statement-breakpoint
UPDATE "weight_measurements"
SET
	"person_id" = '00000000-0000-4000-8000-000000000001',
	"source_reference_id" = "id"
WHERE
	"person_id" IS NULL
	AND "source_reference_id" IS NULL;--> statement-breakpoint
ALTER TABLE "weight_measurements" ALTER COLUMN "person_id" SET NOT NULL;--> statement-breakpoint
ALTER TABLE "weight_measurements" ALTER COLUMN "source_reference_id" SET NOT NULL;--> statement-breakpoint
DROP INDEX "weight_measurements_dedupe_key_uq";--> statement-breakpoint
ALTER TABLE "weight_measurements" DROP COLUMN "source_record_id";--> statement-breakpoint
ALTER TABLE "weight_measurements" DROP COLUMN "provenance";--> statement-breakpoint
ALTER TABLE "person_access_grants" ADD CONSTRAINT "person_access_grants_person_id_persons_id_fk" FOREIGN KEY ("person_id") REFERENCES "public"."persons"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "person_access_grants" ADD CONSTRAINT "person_access_grants_user_id_users_id_fk" FOREIGN KEY ("user_id") REFERENCES "public"."users"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "source_references" ADD CONSTRAINT "source_references_person_id_persons_id_fk" FOREIGN KEY ("person_id") REFERENCES "public"."persons"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "weight_measurements" ADD CONSTRAINT "weight_measurements_person_id_persons_id_fk" FOREIGN KEY ("person_id") REFERENCES "public"."persons"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "source_references" ADD CONSTRAINT "source_references_id_person_uq" UNIQUE("id","person_id");--> statement-breakpoint
ALTER TABLE "weight_measurements" ADD CONSTRAINT "weight_measurements_id_person_uq" UNIQUE("id","person_id");--> statement-breakpoint
ALTER TABLE "weight_measurements" ADD CONSTRAINT "weight_measurements_supersedes_same_person_fk" FOREIGN KEY ("supersedes_id","person_id") REFERENCES "public"."weight_measurements"("id","person_id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "weight_measurements" ADD CONSTRAINT "weight_measurements_source_reference_same_person_fk" FOREIGN KEY ("source_reference_id","person_id") REFERENCES "public"."source_references"("id","person_id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "weight_measurements" ADD CONSTRAINT "weight_measurements_correction_shape" CHECK (("weight_measurements"."supersedes_id" IS NULL AND "weight_measurements"."correction_reason" IS NULL) OR ("weight_measurements"."supersedes_id" IS NOT NULL AND "weight_measurements"."correction_reason" IS NOT NULL));--> statement-breakpoint
ALTER TABLE "weight_measurements" ADD CONSTRAINT "weight_measurements_no_self_supersession" CHECK ("weight_measurements"."supersedes_id" IS NULL OR "weight_measurements"."supersedes_id" <> "weight_measurements"."id");--> statement-breakpoint
CREATE UNIQUE INDEX "person_access_grants_active_role_uq" ON "person_access_grants" USING btree ("person_id","user_id","role") WHERE "person_access_grants"."status" = 'active';--> statement-breakpoint
CREATE UNIQUE INDEX "weight_measurements_person_source_dedupe_uq" ON "weight_measurements" USING btree ("person_id","source","dedupe_key");--> statement-breakpoint
CREATE UNIQUE INDEX "weight_measurements_supersedes_uq" ON "weight_measurements" USING btree ("supersedes_id") WHERE "weight_measurements"."supersedes_id" IS NOT NULL;
