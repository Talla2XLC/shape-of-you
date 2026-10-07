ALTER TABLE "training_workout_session_activity_links" DROP CONSTRAINT "training_workout_activity_link_match_shape";--> statement-breakpoint
ALTER TABLE "training_workout_session_activity_links" ADD CONSTRAINT "training_workout_activity_link_match_shape" CHECK (("training_workout_session_activity_links"."match_basis" IS NULL AND "training_workout_session_activity_links"."match_policy_version" IS NULL)
          OR ("training_workout_session_activity_links"."match_basis" IN ('source_identity', 'trusted_title_and_time')
              AND "training_workout_session_activity_links"."match_policy_version" = 'automatic-activity-link-v2')
          OR ("training_workout_session_activity_links"."match_basis" = 'confirmed_recording_context'
              AND "training_workout_session_activity_links"."match_policy_version" = 'automatic-activity-link-v3')
          OR ("training_workout_session_activity_links"."match_basis" = 'reported_strength_day'
              AND "training_workout_session_activity_links"."match_policy_version" = 'automatic-activity-link-v4'));