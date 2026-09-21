CREATE TYPE "public"."daily_completion_completeness" AS ENUM('complete', 'partial', 'unknown');--> statement-breakpoint
CREATE TYPE "public"."daily_completion_criterion_role" AS ENUM('required', 'supporting');--> statement-breakpoint
CREATE TYPE "public"."daily_completion_criterion_type" AS ENUM('weight_recorded', 'meal_recorded', 'program_workout_completed', 'recovery_check_in_recorded', 'steps_threshold_reached', 'sleep_duration_reached', 'training_program_confirmed', 'manual_confirmation');--> statement-breakpoint
CREATE TYPE "public"."daily_completion_evidence_mode" AS ENUM('observed', 'self_reported', 'partially_observed', 'unknown');--> statement-breakpoint
CREATE TYPE "public"."daily_completion_freshness" AS ENUM('fresh', 'stale', 'unknown');--> statement-breakpoint
CREATE TYPE "public"."daily_completion_owner_domain" AS ENUM('weight', 'nutrition', 'training', 'recovery', 'coaching');--> statement-breakpoint
CREATE TYPE "public"."daily_completion_result_status" AS ENUM('satisfied', 'partial', 'unknown');--> statement-breakpoint
CREATE TYPE "public"."daily_completion_state" AS ENUM('completed', 'partially_completed', 'not_completed', 'unknown');--> statement-breakpoint
CREATE TABLE "coaching_daily_completion_assessments" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"recommendation_id" uuid NOT NULL,
	"person_id" uuid NOT NULL,
	"policy_version" varchar(128) NOT NULL,
	"evidence_checksum" varchar(64) NOT NULL,
	"completion_state" "daily_completion_state" NOT NULL,
	"evidence_mode" "daily_completion_evidence_mode" NOT NULL,
	"reasons" text[] NOT NULL,
	"limitations" text[] NOT NULL,
	"evaluated_at" timestamp with time zone DEFAULT now() NOT NULL,
	CONSTRAINT "coach_daily_completion_assessment_evidence_uq" UNIQUE("recommendation_id","policy_version","evidence_checksum"),
	CONSTRAINT "coach_daily_completion_assessment_owner_uq" UNIQUE("id","recommendation_id","person_id")
);
--> statement-breakpoint
CREATE TABLE "coaching_daily_completion_criteria" (
	"recommendation_id" uuid NOT NULL,
	"person_id" uuid NOT NULL,
	"position" smallint NOT NULL,
	"criterion_key" varchar(64) NOT NULL,
	"type" "daily_completion_criterion_type" NOT NULL,
	"role" "daily_completion_criterion_role" NOT NULL,
	"owner_domain" "daily_completion_owner_domain" NOT NULL,
	"observation_window" varchar(64) NOT NULL,
	"target_value" numeric(14, 3),
	"training_program_version_id" uuid,
	CONSTRAINT "coach_daily_completion_criteria_pk" PRIMARY KEY("recommendation_id","position"),
	CONSTRAINT "coach_daily_completion_criteria_key_uq" UNIQUE("recommendation_id","criterion_key"),
	CONSTRAINT "coach_daily_completion_criteria_position" CHECK ("coaching_daily_completion_criteria"."position" > 0)
);
--> statement-breakpoint
CREATE TABLE "coaching_daily_completion_results" (
	"assessment_id" uuid NOT NULL,
	"recommendation_id" uuid NOT NULL,
	"person_id" uuid NOT NULL,
	"criterion_position" smallint NOT NULL,
	"status" "daily_completion_result_status" NOT NULL,
	"freshness" "daily_completion_freshness" NOT NULL,
	"completeness" "daily_completion_completeness" NOT NULL,
	"observed_at" timestamp with time zone,
	"limitations" text[] NOT NULL,
	"weight_measurement_id" uuid,
	"meal_id" uuid,
	"workout_session_id" uuid,
	"external_activity_id" uuid,
	"recovery_observation_id" uuid,
	"training_program_version_id" uuid,
	CONSTRAINT "coach_daily_completion_results_pk" PRIMARY KEY("assessment_id","criterion_position"),
	CONSTRAINT "coach_daily_completion_results_evidence_count" CHECK (num_nonnulls("coaching_daily_completion_results"."weight_measurement_id", "coaching_daily_completion_results"."meal_id", "coaching_daily_completion_results"."workout_session_id", "coaching_daily_completion_results"."external_activity_id", "coaching_daily_completion_results"."recovery_observation_id", "coaching_daily_completion_results"."training_program_version_id") <= 1)
);
--> statement-breakpoint
ALTER TABLE "coaching_daily_recommendation_feedback" DROP CONSTRAINT "coach_daily_feedback_status_uq";--> statement-breakpoint
ALTER TABLE "coaching_daily_assessment_details" DROP CONSTRAINT "coaching_daily_assessment_policy_payload";--> statement-breakpoint
DROP INDEX "coach_daily_feedback_disposition_uq";--> statement-breakpoint
ALTER TABLE "coaching_daily_recommendation_feedback" ADD COLUMN "supersedes_feedback_id" uuid;--> statement-breakpoint
ALTER TABLE "coaching_daily_completion_assessments" ADD CONSTRAINT "coach_daily_completion_assessment_snapshot_fk" FOREIGN KEY ("recommendation_id","person_id") REFERENCES "public"."coaching_daily_assessment_details"("recommendation_id","person_id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "coaching_daily_completion_criteria" ADD CONSTRAINT "coach_daily_completion_criteria_snapshot_fk" FOREIGN KEY ("recommendation_id","person_id") REFERENCES "public"."coaching_daily_assessment_details"("recommendation_id","person_id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "coaching_daily_completion_criteria" ADD CONSTRAINT "coach_daily_completion_criteria_program_fk" FOREIGN KEY ("training_program_version_id","person_id") REFERENCES "public"."training_program_versions"("id","person_id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "coaching_daily_completion_results" ADD CONSTRAINT "coach_daily_completion_results_assessment_fk" FOREIGN KEY ("assessment_id","recommendation_id","person_id") REFERENCES "public"."coaching_daily_completion_assessments"("id","recommendation_id","person_id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "coaching_daily_completion_results" ADD CONSTRAINT "coach_daily_completion_results_criterion_fk" FOREIGN KEY ("recommendation_id","criterion_position") REFERENCES "public"."coaching_daily_completion_criteria"("recommendation_id","position") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "coaching_daily_completion_results" ADD CONSTRAINT "coach_daily_completion_results_weight_fk" FOREIGN KEY ("weight_measurement_id","person_id") REFERENCES "public"."weight_measurements"("id","person_id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "coaching_daily_completion_results" ADD CONSTRAINT "coach_daily_completion_results_meal_fk" FOREIGN KEY ("meal_id","person_id") REFERENCES "public"."meals"("id","person_id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "coaching_daily_completion_results" ADD CONSTRAINT "coach_daily_completion_results_workout_fk" FOREIGN KEY ("workout_session_id","person_id") REFERENCES "public"."workout_sessions"("id","person_id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "coaching_daily_completion_results" ADD CONSTRAINT "coach_daily_completion_results_activity_fk" FOREIGN KEY ("external_activity_id","person_id") REFERENCES "public"."integration_activity_facts"("id","person_id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "coaching_daily_completion_results" ADD CONSTRAINT "coach_daily_completion_results_recovery_fk" FOREIGN KEY ("recovery_observation_id","person_id") REFERENCES "public"."recovery_observations"("id","person_id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "coaching_daily_completion_results" ADD CONSTRAINT "coach_daily_completion_results_program_fk" FOREIGN KEY ("training_program_version_id","person_id") REFERENCES "public"."training_program_versions"("id","person_id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "coaching_daily_recommendation_feedback" ADD CONSTRAINT "coach_daily_feedback_supersedes_fk" FOREIGN KEY ("supersedes_feedback_id") REFERENCES "public"."coaching_daily_recommendation_feedback"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
CREATE UNIQUE INDEX "coach_daily_feedback_supersedes_uq" ON "coaching_daily_recommendation_feedback" USING btree ("supersedes_feedback_id") WHERE "coaching_daily_recommendation_feedback"."supersedes_feedback_id" IS NOT NULL;--> statement-breakpoint
ALTER TABLE "coaching_daily_assessment_details" ADD CONSTRAINT "coaching_daily_assessment_policy_payload" CHECK (("coaching_daily_assessment_details"."policy_version" = 'daily-assessment-v1'
            AND "coaching_daily_assessment_details"."personal_baseline" IS NULL
            AND "coaching_daily_assessment_details"."personal_baseline_calculation" IS NULL
            AND "coaching_daily_assessment_details"."movement" IS NULL)
        OR ("coaching_daily_assessment_details"."policy_version" = 'daily-assessment-v2'
            AND "coaching_daily_assessment_details"."personal_baseline" IS NOT NULL
            AND "coaching_daily_assessment_details"."personal_baseline_calculation" IS NOT NULL
            AND "coaching_daily_assessment_details"."movement" IS NULL)
        OR ("coaching_daily_assessment_details"."policy_version" in ('daily-assessment-v3', 'daily-assessment-v4')
            AND "coaching_daily_assessment_details"."personal_baseline" IS NOT NULL
            AND "coaching_daily_assessment_details"."personal_baseline_calculation" IS NOT NULL
            AND "coaching_daily_assessment_details"."movement" IS NOT NULL));