ALTER TYPE "public"."weight_measurement_source" RENAME TO "source_channel";--> statement-breakpoint
CREATE TYPE "public"."body_measurement_metric" AS ENUM('waist', 'chest', 'hips', 'thigh', 'biceps');--> statement-breakpoint
CREATE TYPE "public"."body_measurement_unit" AS ENUM('cm');--> statement-breakpoint
CREATE TYPE "public"."physical_goal_direction" AS ENUM('decrease', 'maintain', 'increase');--> statement-breakpoint
CREATE TYPE "public"."physical_goal_metric" AS ENUM('weight', 'body_fat_percentage', 'lean_mass', 'waist', 'chest', 'hips', 'thigh', 'biceps');--> statement-breakpoint
CREATE TYPE "public"."physical_goal_mode" AS ENUM('directional', 'exact', 'range', 'dynamic');--> statement-breakpoint
CREATE TYPE "public"."physical_goal_status" AS ENUM('draft', 'active', 'completed', 'cancelled');--> statement-breakpoint
CREATE TYPE "public"."physical_goal_unit" AS ENUM('kg', 'percent', 'cm');--> statement-breakpoint
CREATE TABLE "body_measurement_sessions" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"person_id" uuid NOT NULL,
	"measured_at" timestamp with time zone NOT NULL,
	"local_date" date NOT NULL,
	"timezone" varchar(64) NOT NULL,
	"source" "source_channel" NOT NULL,
	"source_reference_id" uuid NOT NULL,
	"dedupe_key" varchar(256) NOT NULL,
	"confidence" numeric(4, 3),
	"photo_media_id" uuid,
	"note" text,
	"supersedes_id" uuid,
	"correction_reason" varchar(512),
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	CONSTRAINT "body_measurement_sessions_id_person_uq" UNIQUE("id","person_id"),
	CONSTRAINT "body_measurement_sessions_confidence_range" CHECK ("body_measurement_sessions"."confidence" IS NULL OR ("body_measurement_sessions"."confidence" >= 0 AND "body_measurement_sessions"."confidence" <= 1)),
	CONSTRAINT "body_measurement_sessions_correction_shape" CHECK (("body_measurement_sessions"."supersedes_id" IS NULL AND "body_measurement_sessions"."correction_reason" IS NULL) OR ("body_measurement_sessions"."supersedes_id" IS NOT NULL AND "body_measurement_sessions"."correction_reason" IS NOT NULL)),
	CONSTRAINT "body_measurement_sessions_no_self_supersession" CHECK ("body_measurement_sessions"."supersedes_id" IS NULL OR "body_measurement_sessions"."supersedes_id" <> "body_measurement_sessions"."id")
);
--> statement-breakpoint
CREATE TABLE "body_measurement_values" (
	"session_id" uuid NOT NULL,
	"metric" "body_measurement_metric" NOT NULL,
	"value" numeric(6, 2) NOT NULL,
	"unit" "body_measurement_unit" DEFAULT 'cm' NOT NULL,
	CONSTRAINT "body_measurement_values_session_metric_uq" UNIQUE("session_id","metric"),
	CONSTRAINT "body_measurement_values_range" CHECK ("body_measurement_values"."value" >= 1.00 AND "body_measurement_values"."value" <= 500.00)
);
--> statement-breakpoint
CREATE TABLE "physical_goal_criteria" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"goal_version_id" uuid NOT NULL,
	"position" smallint NOT NULL,
	"metric" "physical_goal_metric" NOT NULL,
	"mode" "physical_goal_mode" NOT NULL,
	"direction" "physical_goal_direction",
	"target_value" numeric(9, 3),
	"minimum_value" numeric(9, 3),
	"maximum_value" numeric(9, 3),
	"unit" "physical_goal_unit" NOT NULL,
	CONSTRAINT "physical_goal_criteria_version_position_uq" UNIQUE("goal_version_id","position"),
	CONSTRAINT "physical_goal_criteria_position_positive" CHECK ("physical_goal_criteria"."position" > 0),
	CONSTRAINT "physical_goal_criteria_metric_unit" CHECK (("physical_goal_criteria"."metric" IN ('weight', 'lean_mass') AND "physical_goal_criteria"."unit" = 'kg')
          OR ("physical_goal_criteria"."metric" = 'body_fat_percentage' AND "physical_goal_criteria"."unit" = 'percent')
          OR ("physical_goal_criteria"."metric" IN ('waist', 'chest', 'hips', 'thigh', 'biceps') AND "physical_goal_criteria"."unit" = 'cm')),
	CONSTRAINT "physical_goal_criteria_mode_shape" CHECK (("physical_goal_criteria"."mode" = 'directional' AND "physical_goal_criteria"."direction" IS NOT NULL AND "physical_goal_criteria"."target_value" IS NULL AND "physical_goal_criteria"."minimum_value" IS NULL AND "physical_goal_criteria"."maximum_value" IS NULL)
          OR ("physical_goal_criteria"."mode" = 'exact' AND "physical_goal_criteria"."direction" IS NULL AND "physical_goal_criteria"."target_value" IS NOT NULL AND "physical_goal_criteria"."minimum_value" IS NULL AND "physical_goal_criteria"."maximum_value" IS NULL)
          OR ("physical_goal_criteria"."mode" = 'range' AND "physical_goal_criteria"."direction" IS NULL AND "physical_goal_criteria"."target_value" IS NULL AND "physical_goal_criteria"."minimum_value" IS NOT NULL AND "physical_goal_criteria"."maximum_value" IS NOT NULL AND "physical_goal_criteria"."minimum_value" <= "physical_goal_criteria"."maximum_value")
          OR ("physical_goal_criteria"."mode" = 'dynamic' AND "physical_goal_criteria"."target_value" IS NULL AND "physical_goal_criteria"."minimum_value" IS NULL AND "physical_goal_criteria"."maximum_value" IS NULL))
);
--> statement-breakpoint
CREATE TABLE "physical_goal_versions" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"goal_id" uuid NOT NULL,
	"person_id" uuid NOT NULL,
	"version" integer NOT NULL,
	"intent" text NOT NULL,
	"effective_from" date,
	"target_date" date,
	"source" "source_channel" NOT NULL,
	"source_reference_id" uuid NOT NULL,
	"dedupe_key" varchar(256) NOT NULL,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	CONSTRAINT "physical_goal_versions_id_goal_uq" UNIQUE("id","goal_id"),
	CONSTRAINT "physical_goal_versions_goal_version_uq" UNIQUE("goal_id","version"),
	CONSTRAINT "physical_goal_versions_dates" CHECK ("physical_goal_versions"."target_date" IS NULL OR "physical_goal_versions"."effective_from" IS NULL OR "physical_goal_versions"."target_date" >= "physical_goal_versions"."effective_from"),
	CONSTRAINT "physical_goal_versions_version_positive" CHECK ("physical_goal_versions"."version" > 0)
);
--> statement-breakpoint
CREATE TABLE "physical_goals" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"person_id" uuid NOT NULL,
	"status" "physical_goal_status" DEFAULT 'draft' NOT NULL,
	"current_version_id" uuid,
	"source" "source_channel" NOT NULL,
	"dedupe_key" varchar(256) NOT NULL,
	"lock_version" integer DEFAULT 0 NOT NULL,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	"activated_at" timestamp with time zone,
	"completed_at" timestamp with time zone,
	"cancelled_at" timestamp with time zone,
	CONSTRAINT "physical_goals_id_person_uq" UNIQUE("id","person_id"),
	CONSTRAINT "physical_goals_lifecycle_timestamps" CHECK (("physical_goals"."status" = 'draft' AND "physical_goals"."activated_at" IS NULL AND "physical_goals"."completed_at" IS NULL AND "physical_goals"."cancelled_at" IS NULL)
          OR ("physical_goals"."status" = 'active' AND "physical_goals"."activated_at" IS NOT NULL AND "physical_goals"."completed_at" IS NULL AND "physical_goals"."cancelled_at" IS NULL)
          OR ("physical_goals"."status" = 'completed' AND "physical_goals"."completed_at" IS NOT NULL AND "physical_goals"."cancelled_at" IS NULL)
          OR ("physical_goals"."status" = 'cancelled' AND "physical_goals"."cancelled_at" IS NOT NULL AND "physical_goals"."completed_at" IS NULL))
);
--> statement-breakpoint
ALTER TABLE "body_measurement_sessions" ADD CONSTRAINT "body_measurement_sessions_person_id_persons_id_fk" FOREIGN KEY ("person_id") REFERENCES "public"."persons"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "body_measurement_sessions" ADD CONSTRAINT "body_measurement_sessions_supersedes_same_person_fk" FOREIGN KEY ("supersedes_id","person_id") REFERENCES "public"."body_measurement_sessions"("id","person_id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "body_measurement_sessions" ADD CONSTRAINT "body_measurement_sessions_source_reference_same_person_fk" FOREIGN KEY ("source_reference_id","person_id") REFERENCES "public"."source_references"("id","person_id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "body_measurement_values" ADD CONSTRAINT "body_values_session_fk" FOREIGN KEY ("session_id") REFERENCES "public"."body_measurement_sessions"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "physical_goal_criteria" ADD CONSTRAINT "goal_criteria_version_fk" FOREIGN KEY ("goal_version_id") REFERENCES "public"."physical_goal_versions"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "physical_goal_versions" ADD CONSTRAINT "physical_goal_versions_goal_id_physical_goals_id_fk" FOREIGN KEY ("goal_id") REFERENCES "public"."physical_goals"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "physical_goal_versions" ADD CONSTRAINT "physical_goal_versions_person_id_persons_id_fk" FOREIGN KEY ("person_id") REFERENCES "public"."persons"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "physical_goal_versions" ADD CONSTRAINT "physical_goal_versions_source_reference_same_person_fk" FOREIGN KEY ("source_reference_id","person_id") REFERENCES "public"."source_references"("id","person_id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "physical_goals" ADD CONSTRAINT "physical_goals_person_id_persons_id_fk" FOREIGN KEY ("person_id") REFERENCES "public"."persons"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "physical_goals" ADD CONSTRAINT "physical_goals_current_version_id_physical_goal_versions_id_fk" FOREIGN KEY ("current_version_id") REFERENCES "public"."physical_goal_versions"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
CREATE UNIQUE INDEX "body_measurement_sessions_person_source_dedupe_uq" ON "body_measurement_sessions" USING btree ("person_id","source","dedupe_key");--> statement-breakpoint
CREATE UNIQUE INDEX "body_measurement_sessions_supersedes_uq" ON "body_measurement_sessions" USING btree ("supersedes_id") WHERE "body_measurement_sessions"."supersedes_id" IS NOT NULL;--> statement-breakpoint
CREATE UNIQUE INDEX "physical_goal_versions_goal_source_dedupe_uq" ON "physical_goal_versions" USING btree ("goal_id","source","dedupe_key");--> statement-breakpoint
CREATE UNIQUE INDEX "physical_goals_person_source_dedupe_uq" ON "physical_goals" USING btree ("person_id","source","dedupe_key");
