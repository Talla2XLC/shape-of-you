CREATE TYPE "public"."body_measurement_temporal_precision" AS ENUM('instant', 'local_date');--> statement-breakpoint
CREATE TABLE "body_import_record_values" (
	"record_id" uuid NOT NULL,
	"metric" "body_measurement_metric" NOT NULL,
	"value" numeric(6, 2) NOT NULL,
	"unit" "body_measurement_unit" DEFAULT 'cm' NOT NULL,
	CONSTRAINT "body_import_record_values_record_metric_uq" UNIQUE("record_id","metric"),
	CONSTRAINT "body_import_record_values_range" CHECK ("body_import_record_values"."value" >= 1.00 AND "body_import_record_values"."value" <= 500.00)
);
--> statement-breakpoint
CREATE TABLE "body_import_records" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"batch_id" uuid NOT NULL,
	"person_id" uuid NOT NULL,
	"source_sheet_id" integer,
	"source_locator" varchar(128) NOT NULL,
	"source_measurement_id" varchar(512),
	"source_local_date" date,
	"source_checksum" varchar(64),
	"normalized_local_date" date,
	"normalized_note" text,
	"normalized_source" varchar(256),
	"outcome" "import_record_outcome" NOT NULL,
	"finding_code" varchar(64) NOT NULL,
	"target_session_id" uuid,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	CONSTRAINT "body_import_records_valid_shape" CHECK ("body_import_records"."outcome" IN ('conflict', 'invalid') OR ("body_import_records"."source_measurement_id" IS NOT NULL AND "body_import_records"."normalized_local_date" IS NOT NULL AND "body_import_records"."source_checksum" IS NOT NULL))
);
--> statement-breakpoint
ALTER TABLE "body_measurement_sessions" ALTER COLUMN "measured_at" DROP NOT NULL;--> statement-breakpoint
ALTER TABLE "body_measurement_sessions" ADD COLUMN "temporal_precision" "body_measurement_temporal_precision" DEFAULT 'instant' NOT NULL;--> statement-breakpoint
ALTER TABLE "body_import_record_values" ADD CONSTRAINT "body_import_record_values_record_fk" FOREIGN KEY ("record_id") REFERENCES "public"."body_import_records"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "body_import_records" ADD CONSTRAINT "body_import_records_batch_same_person_fk" FOREIGN KEY ("batch_id","person_id") REFERENCES "public"."import_batches"("id","person_id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "body_import_records" ADD CONSTRAINT "body_import_records_target_same_person_fk" FOREIGN KEY ("target_session_id","person_id") REFERENCES "public"."body_measurement_sessions"("id","person_id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
CREATE UNIQUE INDEX "body_import_records_batch_locator_code_uq" ON "body_import_records" USING btree ("batch_id","source_locator","finding_code");--> statement-breakpoint
ALTER TABLE "body_measurement_sessions" ADD CONSTRAINT "body_measurement_sessions_temporal_shape" CHECK (("body_measurement_sessions"."temporal_precision" = 'instant' AND "body_measurement_sessions"."measured_at" IS NOT NULL) OR ("body_measurement_sessions"."temporal_precision" = 'local_date' AND "body_measurement_sessions"."measured_at" IS NULL));