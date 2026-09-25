ALTER TABLE "training_workout_session_activity_links" ADD COLUMN "match_basis" varchar(32);--> statement-breakpoint
ALTER TABLE "training_workout_session_activity_links" ADD COLUMN "match_policy_version" varchar(32);--> statement-breakpoint
ALTER TABLE "training_workout_session_activity_links" ADD CONSTRAINT "training_workout_activity_link_match_shape" CHECK (("training_workout_session_activity_links"."match_basis" IS NULL AND "training_workout_session_activity_links"."match_policy_version" IS NULL)
          OR ("training_workout_session_activity_links"."match_basis" IN ('source_identity', 'program_name_and_time')
              AND "training_workout_session_activity_links"."match_policy_version" = 'automatic-activity-link-v1'));