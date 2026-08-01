CREATE TYPE "public"."coaching_decision_outcome" AS ENUM('accepted', 'rejected');--> statement-breakpoint
CREATE TYPE "public"."coaching_recommendation_kind" AS ENUM('training_adjustment');--> statement-breakpoint
CREATE TYPE "public"."coaching_training_adjustment_action" AS ENUM('hold', 'target_weight', 'repetition_range');--> statement-breakpoint
CREATE TYPE "public"."coaching_training_adjustment_reason" AS ENUM('hard_stop', 'low_confidence', 'high_risk', 'moderate_risk', 'maintain');--> statement-breakpoint
CREATE TABLE "coaching_policies" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"key" varchar(128) NOT NULL,
	"name" varchar(256) NOT NULL,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	CONSTRAINT "coaching_policies_key_uq" UNIQUE("key")
);
--> statement-breakpoint
CREATE TABLE "coaching_policy_versions" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"policy_id" uuid NOT NULL,
	"version" integer NOT NULL,
	"effective_from" timestamp with time zone NOT NULL,
	"effective_until" timestamp with time zone,
	"recommendation_ttl_minutes" integer NOT NULL,
	"minimum_confidence" numeric(4, 3) NOT NULL,
	"high_risk_load_factor" numeric(4, 3) NOT NULL,
	"repetition_reduction" smallint NOT NULL,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	CONSTRAINT "coaching_policy_versions_policy_version_uq" UNIQUE("policy_id","version"),
	CONSTRAINT "coaching_policy_versions_values" CHECK ("coaching_policy_versions"."version" > 0
          AND "coaching_policy_versions"."recommendation_ttl_minutes" > 0
          AND "coaching_policy_versions"."minimum_confidence" BETWEEN 0 AND 1
          AND "coaching_policy_versions"."high_risk_load_factor" > 0
          AND "coaching_policy_versions"."high_risk_load_factor" < 1
          AND "coaching_policy_versions"."repetition_reduction" > 0
          AND ("coaching_policy_versions"."effective_until" IS NULL OR "coaching_policy_versions"."effective_until" > "coaching_policy_versions"."effective_from"))
);
--> statement-breakpoint
CREATE TABLE "coaching_recommendation_decisions" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"recommendation_id" uuid NOT NULL,
	"person_id" uuid NOT NULL,
	"actor_person_id" uuid NOT NULL,
	"outcome" "coaching_decision_outcome" NOT NULL,
	"reason" varchar(512) NOT NULL,
	"dedupe_key" varchar(256) NOT NULL,
	"decided_at" timestamp with time zone DEFAULT now() NOT NULL,
	CONSTRAINT "coaching_decisions_recommendation_uq" UNIQUE("recommendation_id"),
	CONSTRAINT "coaching_decisions_person_dedupe_uq" UNIQUE("person_id","dedupe_key"),
	CONSTRAINT "coaching_decisions_actor_is_owner" CHECK ("coaching_recommendation_decisions"."actor_person_id" = "coaching_recommendation_decisions"."person_id")
);
--> statement-breakpoint
CREATE TABLE "coaching_recommendation_recovery_evidence" (
	"recommendation_id" uuid NOT NULL,
	"person_id" uuid NOT NULL,
	"recovery_assessment_id" uuid NOT NULL,
	CONSTRAINT "coaching_recovery_evidence_recommendation_uq" UNIQUE("recommendation_id")
);
--> statement-breakpoint
CREATE TABLE "coaching_recommendation_training_session_evidence" (
	"recommendation_id" uuid NOT NULL,
	"person_id" uuid NOT NULL,
	"workout_session_id" uuid NOT NULL,
	CONSTRAINT "coaching_training_evidence_uq" UNIQUE("recommendation_id","workout_session_id")
);
--> statement-breakpoint
CREATE TABLE "coaching_recommendations" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"person_id" uuid NOT NULL,
	"kind" "coaching_recommendation_kind" NOT NULL,
	"policy_version_id" uuid NOT NULL,
	"as_of" timestamp with time zone NOT NULL,
	"expires_at" timestamp with time zone NOT NULL,
	"evidence_checksum" varchar(128) NOT NULL,
	"explanation" varchar(2048) NOT NULL,
	"dedupe_key" varchar(256) NOT NULL,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	CONSTRAINT "coaching_recommendations_id_person_uq" UNIQUE("id","person_id"),
	CONSTRAINT "coaching_recommendations_person_dedupe_uq" UNIQUE("person_id","dedupe_key"),
	CONSTRAINT "coaching_recommendations_person_evidence_uq" UNIQUE("person_id","policy_version_id","evidence_checksum"),
	CONSTRAINT "coaching_recommendations_expiry" CHECK ("coaching_recommendations"."expires_at" > "coaching_recommendations"."as_of")
);
--> statement-breakpoint
CREATE TABLE "coaching_training_adjustment_details" (
	"recommendation_id" uuid PRIMARY KEY NOT NULL,
	"person_id" uuid NOT NULL,
	"program_id" uuid NOT NULL,
	"program_version_id" uuid NOT NULL,
	"prescription_id" uuid NOT NULL,
	"workout_position" smallint NOT NULL,
	"prescription_position" smallint NOT NULL,
	"exercise_id" uuid NOT NULL,
	"exercise_version_id" uuid NOT NULL,
	"action" "coaching_training_adjustment_action" NOT NULL,
	"reason_code" "coaching_training_adjustment_reason" NOT NULL,
	"current_target_weight_kg" numeric(12, 3),
	"suggested_target_weight_kg" numeric(12, 3),
	"current_reps_min" integer NOT NULL,
	"current_reps_max" integer NOT NULL,
	"suggested_reps_min" integer,
	"suggested_reps_max" integer,
	CONSTRAINT "coaching_training_adjustment_values" CHECK ("coaching_training_adjustment_details"."workout_position" > 0
          AND "coaching_training_adjustment_details"."prescription_position" > 0
          AND "coaching_training_adjustment_details"."current_reps_min" > 0
          AND "coaching_training_adjustment_details"."current_reps_max" >= "coaching_training_adjustment_details"."current_reps_min"
          AND ("coaching_training_adjustment_details"."current_target_weight_kg" IS NULL OR "coaching_training_adjustment_details"."current_target_weight_kg" >= 0)
          AND (
            ("coaching_training_adjustment_details"."action" = 'hold'
              AND "coaching_training_adjustment_details"."suggested_target_weight_kg" IS NULL
              AND "coaching_training_adjustment_details"."suggested_reps_min" IS NULL
              AND "coaching_training_adjustment_details"."suggested_reps_max" IS NULL)
            OR ("coaching_training_adjustment_details"."action" = 'target_weight'
              AND "coaching_training_adjustment_details"."current_target_weight_kg" IS NOT NULL
              AND "coaching_training_adjustment_details"."suggested_target_weight_kg" IS NOT NULL
              AND "coaching_training_adjustment_details"."suggested_target_weight_kg" >= 0
              AND "coaching_training_adjustment_details"."suggested_target_weight_kg" <> "coaching_training_adjustment_details"."current_target_weight_kg"
              AND "coaching_training_adjustment_details"."suggested_reps_min" IS NULL
              AND "coaching_training_adjustment_details"."suggested_reps_max" IS NULL)
            OR ("coaching_training_adjustment_details"."action" = 'repetition_range'
              AND "coaching_training_adjustment_details"."suggested_target_weight_kg" IS NULL
              AND "coaching_training_adjustment_details"."suggested_reps_min" > 0
              AND "coaching_training_adjustment_details"."suggested_reps_max" >= "coaching_training_adjustment_details"."suggested_reps_min"
              AND ("coaching_training_adjustment_details"."suggested_reps_min" <> "coaching_training_adjustment_details"."current_reps_min"
                OR "coaching_training_adjustment_details"."suggested_reps_max" <> "coaching_training_adjustment_details"."current_reps_max"))
          ))
);
--> statement-breakpoint
ALTER TABLE "coaching_policy_versions" ADD CONSTRAINT "coaching_policy_version_policy_fk" FOREIGN KEY ("policy_id") REFERENCES "public"."coaching_policies"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "coaching_recommendation_decisions" ADD CONSTRAINT "coaching_decision_recommendation_fk" FOREIGN KEY ("recommendation_id","person_id") REFERENCES "public"."coaching_recommendations"("id","person_id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "coaching_recommendation_decisions" ADD CONSTRAINT "coaching_decision_actor_fk" FOREIGN KEY ("actor_person_id") REFERENCES "public"."persons"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "coaching_recommendation_recovery_evidence" ADD CONSTRAINT "coaching_recovery_evidence_recommendation_fk" FOREIGN KEY ("recommendation_id","person_id") REFERENCES "public"."coaching_recommendations"("id","person_id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "coaching_recommendation_recovery_evidence" ADD CONSTRAINT "coaching_recovery_evidence_assessment_fk" FOREIGN KEY ("recovery_assessment_id","person_id") REFERENCES "public"."recovery_assessments"("id","person_id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "coaching_recommendation_training_session_evidence" ADD CONSTRAINT "coaching_training_evidence_recommendation_fk" FOREIGN KEY ("recommendation_id","person_id") REFERENCES "public"."coaching_recommendations"("id","person_id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "coaching_recommendation_training_session_evidence" ADD CONSTRAINT "coaching_training_evidence_session_fk" FOREIGN KEY ("workout_session_id","person_id") REFERENCES "public"."workout_sessions"("id","person_id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "coaching_recommendations" ADD CONSTRAINT "coaching_recommendation_person_fk" FOREIGN KEY ("person_id") REFERENCES "public"."persons"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "coaching_recommendations" ADD CONSTRAINT "coaching_recommendation_policy_version_fk" FOREIGN KEY ("policy_version_id") REFERENCES "public"."coaching_policy_versions"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "coaching_training_adjustment_details" ADD CONSTRAINT "coaching_training_adjustment_recommendation_fk" FOREIGN KEY ("recommendation_id","person_id") REFERENCES "public"."coaching_recommendations"("id","person_id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "coaching_training_adjustment_details" ADD CONSTRAINT "coaching_training_adjustment_program_version_fk" FOREIGN KEY ("program_version_id","program_id","person_id") REFERENCES "public"."training_program_versions"("id","program_id","person_id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "coaching_training_adjustment_details" ADD CONSTRAINT "coaching_training_adjustment_prescription_fk" FOREIGN KEY ("prescription_id") REFERENCES "public"."training_program_prescriptions"("id") ON DELETE no action ON UPDATE no action;