CREATE TYPE "public"."training_load_basis" AS ENUM('external_weight', 'body_weight', 'assisted');--> statement-breakpoint
CREATE TABLE "performed_exercises" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"session_id" uuid NOT NULL,
	"position" smallint NOT NULL,
	"exercise_id" uuid NOT NULL,
	"exercise_version_id" uuid NOT NULL,
	"exercise_label" varchar(256) NOT NULL,
	"load_basis" "training_load_basis" NOT NULL,
	"feeling" varchar(256),
	"note" text,
	CONSTRAINT "performed_exercises_session_position_uq" UNIQUE("session_id","position"),
	CONSTRAINT "performed_exercises_position_positive" CHECK ("performed_exercises"."position" > 0)
);
--> statement-breakpoint
CREATE TABLE "performed_sets" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"performed_exercise_id" uuid NOT NULL,
	"position" smallint NOT NULL,
	"weight_kg" numeric(12, 3),
	"reps" integer NOT NULL,
	"rir" numeric(4, 1),
	CONSTRAINT "performed_sets_exercise_position_uq" UNIQUE("performed_exercise_id","position"),
	CONSTRAINT "performed_sets_values" CHECK ("performed_sets"."position" > 0
          AND ("performed_sets"."weight_kg" IS NULL OR "performed_sets"."weight_kg" >= 0)
          AND "performed_sets"."reps" > 0
          AND ("performed_sets"."rir" IS NULL OR "performed_sets"."rir" >= 0))
);
--> statement-breakpoint
CREATE TABLE "training_exercise_catalog_source_records" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"source_id" uuid NOT NULL,
	"external_record_id" varchar(512) NOT NULL,
	"fetched_at" timestamp with time zone NOT NULL,
	"checksum" varchar(128) NOT NULL,
	"parser_version" varchar(128) NOT NULL,
	"status" "catalog_source_record_status" DEFAULT 'staged' NOT NULL,
	"raw_snapshot" jsonb,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	CONSTRAINT "training_exercise_source_records_external_uq" UNIQUE("source_id","external_record_id")
);
--> statement-breakpoint
CREATE TABLE "training_exercise_catalog_sources" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"key" varchar(128) NOT NULL,
	"name" varchar(256) NOT NULL,
	"license_name" varchar(256),
	"terms_url" text,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	CONSTRAINT "training_exercise_sources_key_uq" UNIQUE("key")
);
--> statement-breakpoint
CREATE TABLE "training_exercise_overlays" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"person_id" uuid NOT NULL,
	"exercise_id" uuid NOT NULL,
	"alias" varchar(256),
	"available" boolean DEFAULT true NOT NULL,
	"note" text,
	"updated_at" timestamp with time zone DEFAULT now() NOT NULL,
	CONSTRAINT "training_exercise_overlays_person_exercise_uq" UNIQUE("person_id","exercise_id")
);
--> statement-breakpoint
CREATE TABLE "training_exercise_versions" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"exercise_id" uuid NOT NULL,
	"version" integer NOT NULL,
	"name" varchar(256) NOT NULL,
	"category" varchar(256),
	"movement_pattern" varchar(256),
	"equipment" varchar(256),
	"instructions" text,
	"note" text,
	"source_record_id" uuid,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	CONSTRAINT "training_exercise_versions_exercise_version_uq" UNIQUE("exercise_id","version"),
	CONSTRAINT "training_exercise_versions_id_exercise_uq" UNIQUE("id","exercise_id"),
	CONSTRAINT "training_exercise_versions_version_positive" CHECK ("training_exercise_versions"."version" > 0)
);
--> statement-breakpoint
CREATE TABLE "training_exercises" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"visibility" "catalog_visibility" NOT NULL,
	"owner_person_id" uuid,
	"current_version_id" uuid,
	"lock_version" integer DEFAULT 0 NOT NULL,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	CONSTRAINT "training_exercises_visibility_owner" CHECK (("training_exercises"."visibility" = 'shared' AND "training_exercises"."owner_person_id" IS NULL)
          OR ("training_exercises"."visibility" = 'private' AND "training_exercises"."owner_person_id" IS NOT NULL))
);
--> statement-breakpoint
CREATE TABLE "training_program_prescriptions" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"workout_id" uuid NOT NULL,
	"position" smallint NOT NULL,
	"exercise_id" uuid NOT NULL,
	"exercise_version_id" uuid NOT NULL,
	"load_basis" "training_load_basis" NOT NULL,
	"target_weight_kg" numeric(12, 3),
	"target_sets" smallint NOT NULL,
	"target_reps_min" integer NOT NULL,
	"target_reps_max" integer NOT NULL,
	"target_rir" numeric(4, 1),
	"progression_increment_kg" numeric(12, 3),
	"note" text,
	CONSTRAINT "training_program_prescriptions_workout_position_uq" UNIQUE("workout_id","position"),
	CONSTRAINT "training_program_prescriptions_values" CHECK ("training_program_prescriptions"."position" > 0
          AND ("training_program_prescriptions"."target_weight_kg" IS NULL OR "training_program_prescriptions"."target_weight_kg" >= 0)
          AND "training_program_prescriptions"."target_sets" > 0
          AND "training_program_prescriptions"."target_reps_min" > 0
          AND "training_program_prescriptions"."target_reps_max" >= "training_program_prescriptions"."target_reps_min"
          AND ("training_program_prescriptions"."target_rir" IS NULL OR "training_program_prescriptions"."target_rir" >= 0)
          AND ("training_program_prescriptions"."progression_increment_kg" IS NULL OR "training_program_prescriptions"."progression_increment_kg" > 0))
);
--> statement-breakpoint
CREATE TABLE "training_program_versions" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"program_id" uuid NOT NULL,
	"person_id" uuid NOT NULL,
	"version" integer NOT NULL,
	"name" varchar(256) NOT NULL,
	"note" text,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	CONSTRAINT "training_program_versions_program_version_uq" UNIQUE("program_id","version"),
	CONSTRAINT "training_program_versions_id_program_person_uq" UNIQUE("id","program_id","person_id"),
	CONSTRAINT "training_program_versions_id_person_uq" UNIQUE("id","person_id"),
	CONSTRAINT "training_program_versions_version_positive" CHECK ("training_program_versions"."version" > 0)
);
--> statement-breakpoint
CREATE TABLE "training_program_workouts" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"program_version_id" uuid NOT NULL,
	"position" smallint NOT NULL,
	"name" varchar(256) NOT NULL,
	CONSTRAINT "training_program_workouts_version_position_uq" UNIQUE("program_version_id","position"),
	CONSTRAINT "training_program_workouts_position_positive" CHECK ("training_program_workouts"."position" > 0)
);
--> statement-breakpoint
CREATE TABLE "training_programs" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"person_id" uuid NOT NULL,
	"current_version_id" uuid,
	"active_version_id" uuid,
	"lock_version" integer DEFAULT 0 NOT NULL,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	CONSTRAINT "training_programs_id_person_uq" UNIQUE("id","person_id")
);
--> statement-breakpoint
CREATE TABLE "workout_sessions" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"person_id" uuid NOT NULL,
	"occurred_at" timestamp with time zone NOT NULL,
	"local_date" date NOT NULL,
	"timezone" varchar(64) NOT NULL,
	"program_version_id" uuid,
	"workout_name" varchar(256) NOT NULL,
	"feeling" varchar(256),
	"note" text,
	"source" "source_channel" NOT NULL,
	"source_reference_id" uuid NOT NULL,
	"dedupe_key" varchar(256) NOT NULL,
	"confidence" numeric(4, 3),
	"supersedes_id" uuid,
	"correction_reason" varchar(512),
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	CONSTRAINT "workout_sessions_id_person_uq" UNIQUE("id","person_id"),
	CONSTRAINT "workout_sessions_confidence_range" CHECK ("workout_sessions"."confidence" IS NULL
          OR ("workout_sessions"."confidence" >= 0 AND "workout_sessions"."confidence" <= 1)),
	CONSTRAINT "workout_sessions_correction_shape" CHECK (("workout_sessions"."supersedes_id" IS NULL AND "workout_sessions"."correction_reason" IS NULL)
          OR ("workout_sessions"."supersedes_id" IS NOT NULL AND "workout_sessions"."correction_reason" IS NOT NULL)),
	CONSTRAINT "workout_sessions_no_self_supersession" CHECK ("workout_sessions"."supersedes_id" IS NULL OR "workout_sessions"."supersedes_id" <> "workout_sessions"."id")
);
--> statement-breakpoint
ALTER TABLE "performed_exercises" ADD CONSTRAINT "performed_exercise_session_fk" FOREIGN KEY ("session_id") REFERENCES "public"."workout_sessions"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "performed_exercises" ADD CONSTRAINT "performed_exercise_version_fk" FOREIGN KEY ("exercise_version_id","exercise_id") REFERENCES "public"."training_exercise_versions"("id","exercise_id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "performed_sets" ADD CONSTRAINT "performed_set_exercise_fk" FOREIGN KEY ("performed_exercise_id") REFERENCES "public"."performed_exercises"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "training_exercise_catalog_source_records" ADD CONSTRAINT "training_exercise_source_record_source_fk" FOREIGN KEY ("source_id") REFERENCES "public"."training_exercise_catalog_sources"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "training_exercise_overlays" ADD CONSTRAINT "training_exercise_overlay_person_fk" FOREIGN KEY ("person_id") REFERENCES "public"."persons"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "training_exercise_overlays" ADD CONSTRAINT "training_exercise_overlay_exercise_fk" FOREIGN KEY ("exercise_id") REFERENCES "public"."training_exercises"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "training_exercise_versions" ADD CONSTRAINT "training_exercise_version_exercise_fk" FOREIGN KEY ("exercise_id") REFERENCES "public"."training_exercises"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "training_exercise_versions" ADD CONSTRAINT "training_exercise_version_source_fk" FOREIGN KEY ("source_record_id") REFERENCES "public"."training_exercise_catalog_source_records"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "training_exercises" ADD CONSTRAINT "training_exercise_owner_fk" FOREIGN KEY ("owner_person_id") REFERENCES "public"."persons"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "training_exercises" ADD CONSTRAINT "training_exercise_current_version_fk" FOREIGN KEY ("current_version_id","id") REFERENCES "public"."training_exercise_versions"("id","exercise_id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "training_program_prescriptions" ADD CONSTRAINT "training_program_prescription_workout_fk" FOREIGN KEY ("workout_id") REFERENCES "public"."training_program_workouts"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "training_program_prescriptions" ADD CONSTRAINT "training_program_prescription_exercise_fk" FOREIGN KEY ("exercise_version_id","exercise_id") REFERENCES "public"."training_exercise_versions"("id","exercise_id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "training_program_versions" ADD CONSTRAINT "training_program_version_program_fk" FOREIGN KEY ("program_id","person_id") REFERENCES "public"."training_programs"("id","person_id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "training_program_workouts" ADD CONSTRAINT "training_program_workout_version_fk" FOREIGN KEY ("program_version_id") REFERENCES "public"."training_program_versions"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "training_programs" ADD CONSTRAINT "training_program_person_fk" FOREIGN KEY ("person_id") REFERENCES "public"."persons"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "training_programs" ADD CONSTRAINT "training_program_current_version_fk" FOREIGN KEY ("current_version_id","id","person_id") REFERENCES "public"."training_program_versions"("id","program_id","person_id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "training_programs" ADD CONSTRAINT "training_program_active_version_fk" FOREIGN KEY ("active_version_id","id","person_id") REFERENCES "public"."training_program_versions"("id","program_id","person_id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "workout_sessions" ADD CONSTRAINT "workout_session_person_fk" FOREIGN KEY ("person_id") REFERENCES "public"."persons"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "workout_sessions" ADD CONSTRAINT "workout_session_program_version_person_fk" FOREIGN KEY ("program_version_id","person_id") REFERENCES "public"."training_program_versions"("id","person_id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "workout_sessions" ADD CONSTRAINT "workout_session_source_reference_person_fk" FOREIGN KEY ("source_reference_id","person_id") REFERENCES "public"."source_references"("id","person_id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "workout_sessions" ADD CONSTRAINT "workout_session_supersedes_person_fk" FOREIGN KEY ("supersedes_id","person_id") REFERENCES "public"."workout_sessions"("id","person_id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
CREATE UNIQUE INDEX "training_programs_person_active_uq" ON "training_programs" USING btree ("person_id") WHERE "training_programs"."active_version_id" IS NOT NULL;--> statement-breakpoint
CREATE UNIQUE INDEX "workout_sessions_person_source_dedupe_uq" ON "workout_sessions" USING btree ("person_id","source","dedupe_key");--> statement-breakpoint
CREATE UNIQUE INDEX "workout_sessions_supersedes_uq" ON "workout_sessions" USING btree ("supersedes_id") WHERE "workout_sessions"."supersedes_id" IS NOT NULL;