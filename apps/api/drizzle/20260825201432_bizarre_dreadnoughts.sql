CREATE TYPE "public"."recovery_observation_temporal_precision" AS ENUM('instant', 'local_date');--> statement-breakpoint
CREATE TYPE "public"."workout_temporal_precision" AS ENUM('instant', 'local_date');--> statement-breakpoint
ALTER TABLE "recovery_metric_details" DROP CONSTRAINT "recovery_metric_details_shape";--> statement-breakpoint
ALTER TABLE "recovery_metric_details" ALTER COLUMN "metric" TYPE text USING "metric"::text;--> statement-breakpoint
ALTER TABLE "recovery_metric_details" ALTER COLUMN "unit" TYPE text USING "unit"::text;--> statement-breakpoint
DROP TYPE "public"."recovery_metric";--> statement-breakpoint
DROP TYPE "public"."recovery_metric_unit";--> statement-breakpoint
CREATE TYPE "public"."recovery_metric" AS ENUM('hrv_rmssd', 'resting_heart_rate', 'night_heart_rate', 'oxygen_saturation', 'minimum_oxygen_saturation', 'temperature_deviation', 'respiration_rate', 'body_battery');--> statement-breakpoint
CREATE TYPE "public"."recovery_metric_unit" AS ENUM('ms', 'bpm', 'percent', 'celsius', 'breaths_per_minute', 'score');--> statement-breakpoint
ALTER TABLE "recovery_metric_details" ALTER COLUMN "metric" TYPE "public"."recovery_metric" USING "metric"::"public"."recovery_metric";--> statement-breakpoint
ALTER TABLE "recovery_metric_details" ALTER COLUMN "unit" TYPE "public"."recovery_metric_unit" USING "unit"::"public"."recovery_metric_unit";--> statement-breakpoint
CREATE TABLE "recovery_import_records" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"batch_id" uuid NOT NULL,
	"person_id" uuid NOT NULL,
	"source_sheet_id" integer,
	"source_locator" varchar(128) NOT NULL,
	"source_key" varchar(512),
	"source_local_date" date,
	"source_checksum" varchar(64),
	"observation_kind" "recovery_observation_kind",
	"metric" "recovery_metric",
	"metric_value" numeric(10, 3),
	"metric_unit" "recovery_metric_unit",
	"total_sleep_minutes" smallint,
	"deep_sleep_minutes" smallint,
	"rem_sleep_minutes" smallint,
	"light_sleep_minutes" smallint,
	"outcome" "import_record_outcome" NOT NULL,
	"finding_code" varchar(64) NOT NULL,
	"target_observation_id" uuid,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	CONSTRAINT "recovery_import_records_batch_locator_code_uq" UNIQUE("batch_id","source_locator","finding_code")
);
--> statement-breakpoint
CREATE TABLE "training_import_exercise_mappings" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"person_id" uuid NOT NULL,
	"source_system" varchar(128) NOT NULL,
	"source_exercise_id" varchar(512) NOT NULL,
	"source_name" varchar(256) NOT NULL,
	"source_checksum" varchar(64) NOT NULL,
	"exercise_id" uuid NOT NULL,
	"exercise_version_id" uuid NOT NULL,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	CONSTRAINT "training_import_exercise_mapping_source_uq" UNIQUE("person_id","source_system","source_exercise_id")
);
--> statement-breakpoint
CREATE TABLE "training_import_record_exercises" (
	"record_id" uuid NOT NULL,
	"position" smallint NOT NULL,
	"source_exercise_id" varchar(512) NOT NULL,
	"source_name" varchar(256) NOT NULL,
	"source_reps" varchar(128) NOT NULL,
	"load_basis" "training_load_basis" NOT NULL,
	"set_count" smallint NOT NULL,
	"reps" integer,
	"duration_seconds" integer,
	"distance_meters" numeric(12, 3),
	"weight_kg" numeric(12, 3),
	"rir" numeric(4, 1),
	CONSTRAINT "training_import_record_exercise_position_uq" UNIQUE("record_id","position")
);
--> statement-breakpoint
CREATE TABLE "training_import_records" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"batch_id" uuid NOT NULL,
	"person_id" uuid NOT NULL,
	"source_sheet_id" integer,
	"source_locator" varchar(128) NOT NULL,
	"source_session_id" varchar(512),
	"source_local_date" date,
	"source_checksum" varchar(64),
	"normalized_workout_name" varchar(256),
	"outcome" "import_record_outcome" NOT NULL,
	"finding_code" varchar(64) NOT NULL,
	"target_session_id" uuid,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	CONSTRAINT "training_import_records_batch_locator_code_uq" UNIQUE("batch_id","source_locator","finding_code")
);
--> statement-breakpoint
ALTER TABLE "performed_sets" DROP CONSTRAINT "performed_sets_values";--> statement-breakpoint
ALTER TABLE "recovery_observations" DROP CONSTRAINT "recovery_observations_time_order";--> statement-breakpoint
ALTER TABLE "recovery_sleep_details" DROP CONSTRAINT "recovery_sleep_details_values";--> statement-breakpoint
ALTER TABLE "performed_sets" ALTER COLUMN "reps" DROP NOT NULL;--> statement-breakpoint
ALTER TABLE "recovery_observations" ALTER COLUMN "observed_from" DROP NOT NULL;--> statement-breakpoint
ALTER TABLE "recovery_observations" ALTER COLUMN "observed_until" DROP NOT NULL;--> statement-breakpoint
ALTER TABLE "workout_sessions" ALTER COLUMN "occurred_at" DROP NOT NULL;--> statement-breakpoint
ALTER TABLE "performed_sets" ADD COLUMN "duration_seconds" integer;--> statement-breakpoint
ALTER TABLE "performed_sets" ADD COLUMN "distance_meters" numeric(12, 3);--> statement-breakpoint
ALTER TABLE "recovery_observations" ADD COLUMN "temporal_precision" "recovery_observation_temporal_precision" DEFAULT 'instant' NOT NULL;--> statement-breakpoint
ALTER TABLE "recovery_sleep_details" ADD COLUMN "deep_sleep_minutes" smallint;--> statement-breakpoint
ALTER TABLE "recovery_sleep_details" ADD COLUMN "rem_sleep_minutes" smallint;--> statement-breakpoint
ALTER TABLE "recovery_sleep_details" ADD COLUMN "light_sleep_minutes" smallint;--> statement-breakpoint
ALTER TABLE "workout_sessions" ADD COLUMN "temporal_precision" "workout_temporal_precision" DEFAULT 'instant' NOT NULL;--> statement-breakpoint
ALTER TABLE "recovery_import_records" ADD CONSTRAINT "recovery_import_records_batch_person_fk" FOREIGN KEY ("batch_id","person_id") REFERENCES "public"."import_batches"("id","person_id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "recovery_import_records" ADD CONSTRAINT "recovery_import_records_target_person_fk" FOREIGN KEY ("target_observation_id","person_id") REFERENCES "public"."recovery_observations"("id","person_id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "training_import_exercise_mappings" ADD CONSTRAINT "training_import_exercise_mapping_person_fk" FOREIGN KEY ("person_id") REFERENCES "public"."persons"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "training_import_exercise_mappings" ADD CONSTRAINT "training_import_exercise_mapping_version_fk" FOREIGN KEY ("exercise_version_id","exercise_id") REFERENCES "public"."training_exercise_versions"("id","exercise_id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "training_import_record_exercises" ADD CONSTRAINT "training_import_record_exercise_record_fk" FOREIGN KEY ("record_id") REFERENCES "public"."training_import_records"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "training_import_records" ADD CONSTRAINT "training_import_records_batch_person_fk" FOREIGN KEY ("batch_id","person_id") REFERENCES "public"."import_batches"("id","person_id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "training_import_records" ADD CONSTRAINT "training_import_records_target_person_fk" FOREIGN KEY ("target_session_id","person_id") REFERENCES "public"."workout_sessions"("id","person_id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "performed_sets" ADD CONSTRAINT "performed_sets_values" CHECK ("performed_sets"."position" > 0
          AND ("performed_sets"."weight_kg" IS NULL OR "performed_sets"."weight_kg" >= 0)
          AND ("performed_sets"."reps" IS NULL OR "performed_sets"."reps" > 0)
          AND ("performed_sets"."duration_seconds" IS NULL OR "performed_sets"."duration_seconds" > 0)
          AND ("performed_sets"."distance_meters" IS NULL OR "performed_sets"."distance_meters" > 0)
          AND ("performed_sets"."reps" IS NOT NULL OR "performed_sets"."duration_seconds" IS NOT NULL OR "performed_sets"."distance_meters" IS NOT NULL)
          AND ("performed_sets"."rir" IS NULL OR "performed_sets"."rir" >= 0));--> statement-breakpoint
ALTER TABLE "recovery_metric_details" ADD CONSTRAINT "recovery_metric_details_shape" CHECK ("recovery_metric_details"."value" >= -100 AND "recovery_metric_details"."value" <= 1000
          AND (("recovery_metric_details"."metric" = 'hrv_rmssd' AND "recovery_metric_details"."value" > 0 AND "recovery_metric_details"."unit" = 'ms')
            OR ("recovery_metric_details"."metric" IN ('resting_heart_rate', 'night_heart_rate') AND "recovery_metric_details"."value" > 0 AND "recovery_metric_details"."unit" = 'bpm')
            OR ("recovery_metric_details"."metric" IN ('oxygen_saturation', 'minimum_oxygen_saturation') AND "recovery_metric_details"."value" >= 0 AND "recovery_metric_details"."value" <= 100 AND "recovery_metric_details"."unit" = 'percent')
            OR ("recovery_metric_details"."metric" = 'temperature_deviation' AND "recovery_metric_details"."value" >= -20 AND "recovery_metric_details"."value" <= 20 AND "recovery_metric_details"."unit" = 'celsius')
            OR ("recovery_metric_details"."metric" = 'respiration_rate' AND "recovery_metric_details"."value" > 0 AND "recovery_metric_details"."value" <= 100 AND "recovery_metric_details"."unit" = 'breaths_per_minute')
            OR ("recovery_metric_details"."metric" = 'body_battery' AND "recovery_metric_details"."value" >= 0 AND "recovery_metric_details"."value" <= 100 AND "recovery_metric_details"."unit" = 'score')));--> statement-breakpoint
ALTER TABLE "recovery_observations" ADD CONSTRAINT "recovery_observations_temporal_shape" CHECK (("recovery_observations"."temporal_precision" = 'instant' AND "recovery_observations"."observed_from" IS NOT NULL AND "recovery_observations"."observed_until" IS NOT NULL AND "recovery_observations"."observed_until" >= "recovery_observations"."observed_from")
          OR ("recovery_observations"."temporal_precision" = 'local_date' AND "recovery_observations"."observed_from" IS NULL AND "recovery_observations"."observed_until" IS NULL));--> statement-breakpoint
ALTER TABLE "recovery_sleep_details" ADD CONSTRAINT "recovery_sleep_details_values" CHECK ("recovery_sleep_details"."total_sleep_minutes" >= 0 AND "recovery_sleep_details"."total_sleep_minutes" <= 1440
          AND ("recovery_sleep_details"."deep_sleep_minutes" IS NULL OR ("recovery_sleep_details"."deep_sleep_minutes" >= 0 AND "recovery_sleep_details"."deep_sleep_minutes" <= 1440))
          AND ("recovery_sleep_details"."rem_sleep_minutes" IS NULL OR ("recovery_sleep_details"."rem_sleep_minutes" >= 0 AND "recovery_sleep_details"."rem_sleep_minutes" <= 1440))
          AND ("recovery_sleep_details"."light_sleep_minutes" IS NULL OR ("recovery_sleep_details"."light_sleep_minutes" >= 0 AND "recovery_sleep_details"."light_sleep_minutes" <= 1440))
          AND ("recovery_sleep_details"."sleep_quality" IS NULL OR ("recovery_sleep_details"."sleep_quality" >= 1 AND "recovery_sleep_details"."sleep_quality" <= 5)));--> statement-breakpoint
ALTER TABLE "workout_sessions" ADD CONSTRAINT "workout_sessions_temporal_shape" CHECK (("workout_sessions"."temporal_precision" = 'instant' AND "workout_sessions"."occurred_at" IS NOT NULL)
          OR ("workout_sessions"."temporal_precision" = 'local_date' AND "workout_sessions"."occurred_at" IS NULL));
