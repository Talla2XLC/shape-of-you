CREATE TYPE "public"."weight_measurement_source" AS ENUM('manual', 'google_sheets', 'import');--> statement-breakpoint
CREATE TABLE "weight_measurements" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"measured_at" timestamp with time zone NOT NULL,
	"local_date" date NOT NULL,
	"timezone" varchar(64) NOT NULL,
	"weight_kg" numeric(6, 3) NOT NULL,
	"source" "weight_measurement_source" NOT NULL,
	"source_record_id" varchar(512),
	"dedupe_key" varchar(256) NOT NULL,
	"confidence" numeric(4, 3),
	"provenance" jsonb NOT NULL,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	CONSTRAINT "weight_measurements_weight_kg_range" CHECK ("weight_measurements"."weight_kg" >= 0.500 AND "weight_measurements"."weight_kg" <= 700.000),
	CONSTRAINT "weight_measurements_confidence_range" CHECK ("weight_measurements"."confidence" IS NULL OR ("weight_measurements"."confidence" >= 0 AND "weight_measurements"."confidence" <= 1))
);
--> statement-breakpoint
CREATE UNIQUE INDEX "weight_measurements_dedupe_key_uq" ON "weight_measurements" USING btree ("dedupe_key");