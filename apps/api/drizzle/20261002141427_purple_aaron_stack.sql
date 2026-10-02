ALTER TABLE "performed_sets" DROP CONSTRAINT "performed_sets_values";--> statement-breakpoint
ALTER TABLE "performed_exercises" ALTER COLUMN "exercise_id" DROP NOT NULL;--> statement-breakpoint
ALTER TABLE "performed_exercises" ALTER COLUMN "exercise_version_id" DROP NOT NULL;--> statement-breakpoint
ALTER TABLE "performed_exercises" ALTER COLUMN "load_basis" DROP NOT NULL;--> statement-breakpoint
ALTER TABLE "workout_sessions" ADD COLUMN "completion_state" varchar(16) DEFAULT 'completed' NOT NULL;--> statement-breakpoint
ALTER TABLE "performed_exercises" ADD CONSTRAINT "performed_exercises_identity_shape" CHECK (("performed_exercises"."exercise_id" IS NULL) = ("performed_exercises"."exercise_version_id" IS NULL));--> statement-breakpoint
ALTER TABLE "performed_sets" ADD CONSTRAINT "performed_sets_values" CHECK ("performed_sets"."position" > 0
          AND ("performed_sets"."weight_kg" IS NULL OR "performed_sets"."weight_kg" >= 0)
          AND ("performed_sets"."reps" IS NULL OR "performed_sets"."reps" > 0)
          AND ("performed_sets"."duration_seconds" IS NULL OR "performed_sets"."duration_seconds" > 0)
          AND ("performed_sets"."distance_meters" IS NULL OR "performed_sets"."distance_meters" > 0)
          AND ("performed_sets"."weight_kg" IS NOT NULL OR "performed_sets"."reps" IS NOT NULL OR "performed_sets"."duration_seconds" IS NOT NULL OR "performed_sets"."distance_meters" IS NOT NULL OR "performed_sets"."rir" IS NOT NULL)
          AND ("performed_sets"."rir" IS NULL OR "performed_sets"."rir" >= 0));--> statement-breakpoint
ALTER TABLE "workout_sessions" ADD CONSTRAINT "workout_sessions_completion_shape" CHECK ("workout_sessions"."completion_state" IN ('in_progress', 'completed'));