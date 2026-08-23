CREATE TYPE "public"."import_batch_status" AS ENUM('completed', 'blocked');--> statement-breakpoint
CREATE TYPE "public"."import_domain" AS ENUM('weight', 'body', 'nutrition', 'training', 'recovery');--> statement-breakpoint
CREATE TYPE "public"."import_mode" AS ENUM('apply', 'reconcile');--> statement-breakpoint
CREATE TYPE "public"."import_record_outcome" AS ENUM('created', 'unchanged', 'conflict', 'invalid');--> statement-breakpoint
CREATE TYPE "public"."weight_import_record_role" AS ENUM('authority', 'mirror', 'target');--> statement-breakpoint
CREATE TYPE "public"."weight_temporal_precision" AS ENUM('instant', 'local_date');--> statement-breakpoint
CREATE TABLE "import_batches" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"person_id" uuid NOT NULL,
	"domain" "import_domain" NOT NULL,
	"mode" "import_mode" NOT NULL,
	"source_system" varchar(64) NOT NULL,
	"source_container_id" varchar(128) NOT NULL,
	"source_manifest_checksum" varchar(64) NOT NULL,
	"target_state_checksum" varchar(64) NOT NULL,
	"status" "import_batch_status" NOT NULL,
	"created_count" integer NOT NULL,
	"unchanged_count" integer NOT NULL,
	"conflict_count" integer NOT NULL,
	"invalid_count" integer NOT NULL,
	"started_at" timestamp with time zone NOT NULL,
	"completed_at" timestamp with time zone NOT NULL,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	CONSTRAINT "import_batches_id_person_uq" UNIQUE("id","person_id"),
	CONSTRAINT "import_batches_nonnegative_counts" CHECK ("import_batches"."created_count" >= 0 AND "import_batches"."unchanged_count" >= 0 AND "import_batches"."conflict_count" >= 0 AND "import_batches"."invalid_count" >= 0),
	CONSTRAINT "import_batches_status_outcomes" CHECK (("import_batches"."status" = 'completed' AND "import_batches"."conflict_count" = 0 AND "import_batches"."invalid_count" = 0) OR ("import_batches"."status" = 'blocked' AND ("import_batches"."conflict_count" > 0 OR "import_batches"."invalid_count" > 0))),
	CONSTRAINT "import_batches_completion_order" CHECK ("import_batches"."completed_at" >= "import_batches"."started_at")
);
--> statement-breakpoint
CREATE TABLE "weight_import_records" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"batch_id" uuid NOT NULL,
	"person_id" uuid NOT NULL,
	"role" "weight_import_record_role" NOT NULL,
	"source_sheet_id" integer,
	"source_locator" varchar(128) NOT NULL,
	"source_local_date" date,
	"source_checksum" varchar(64),
	"normalized_local_date" date,
	"normalized_weight_kg" numeric(6, 3),
	"outcome" "import_record_outcome" NOT NULL,
	"finding_code" varchar(64) NOT NULL,
	"target_measurement_id" uuid,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	CONSTRAINT "weight_import_records_weight_range" CHECK ("weight_import_records"."normalized_weight_kg" IS NULL OR ("weight_import_records"."normalized_weight_kg" >= 0.500 AND "weight_import_records"."normalized_weight_kg" <= 700.000)),
	CONSTRAINT "weight_import_records_valid_shape" CHECK ("weight_import_records"."outcome" IN ('conflict', 'invalid') OR ("weight_import_records"."normalized_local_date" IS NOT NULL AND "weight_import_records"."normalized_weight_kg" IS NOT NULL AND "weight_import_records"."source_checksum" IS NOT NULL))
);
--> statement-breakpoint
ALTER TABLE "weight_measurements" ALTER COLUMN "measured_at" DROP NOT NULL;--> statement-breakpoint
ALTER TABLE "weight_measurements" ADD COLUMN "temporal_precision" "weight_temporal_precision" DEFAULT 'instant' NOT NULL;--> statement-breakpoint
ALTER TABLE "import_batches" ADD CONSTRAINT "import_batches_person_id_persons_id_fk" FOREIGN KEY ("person_id") REFERENCES "public"."persons"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "weight_import_records" ADD CONSTRAINT "weight_import_records_batch_same_person_fk" FOREIGN KEY ("batch_id","person_id") REFERENCES "public"."import_batches"("id","person_id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "weight_import_records" ADD CONSTRAINT "weight_import_records_target_same_person_fk" FOREIGN KEY ("target_measurement_id","person_id") REFERENCES "public"."weight_measurements"("id","person_id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
CREATE UNIQUE INDEX "import_batches_comparison_uq" ON "import_batches" USING btree ("person_id","domain","mode","source_system","source_container_id","source_manifest_checksum","target_state_checksum");--> statement-breakpoint
CREATE UNIQUE INDEX "weight_import_records_batch_locator_code_uq" ON "weight_import_records" USING btree ("batch_id","role","source_locator","finding_code");--> statement-breakpoint
ALTER TABLE "source_references" ADD CONSTRAINT "source_references_import_batch_same_person_fk" FOREIGN KEY ("import_batch_id","person_id") REFERENCES "public"."import_batches"("id","person_id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "weight_measurements" ADD CONSTRAINT "weight_measurements_temporal_shape" CHECK (("weight_measurements"."temporal_precision" = 'instant' AND "weight_measurements"."measured_at" IS NOT NULL) OR ("weight_measurements"."temporal_precision" = 'local_date' AND "weight_measurements"."measured_at" IS NULL));