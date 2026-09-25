CREATE TABLE "training_activity_recording_modes" (
  "person_id" uuid PRIMARY KEY NOT NULL,
  "title" varchar(256),
  "normalized_title" varchar(256),
  "lock_version" integer DEFAULT 0 NOT NULL,
  "updated_at" timestamp with time zone DEFAULT now() NOT NULL,
  CONSTRAINT "training_activity_recording_modes_person_fk" FOREIGN KEY ("person_id") REFERENCES "persons"("id"),
  CONSTRAINT "training_activity_recording_modes_title_shape" CHECK (("title" IS NULL AND "normalized_title" IS NULL) OR ("title" IS NOT NULL AND "normalized_title" IS NOT NULL)),
  CONSTRAINT "training_activity_recording_modes_lock_positive" CHECK ("lock_version" >= 0)
);
--> statement-breakpoint
ALTER TABLE "workout_sessions" ADD COLUMN "venue_label" varchar(256);
--> statement-breakpoint
ALTER TABLE "training_workout_session_activity_links" DROP CONSTRAINT "training_workout_activity_link_match_shape";
--> statement-breakpoint
ALTER TABLE "training_workout_session_activity_links" ADD CONSTRAINT "training_workout_activity_link_match_shape" CHECK (("match_basis" IS NULL AND "match_policy_version" IS NULL)
  OR ("match_basis" IN ('source_identity', 'trusted_title_and_time') AND "match_policy_version" = 'automatic-activity-link-v2')
  OR ("match_basis" = 'confirmed_recording_context' AND "match_policy_version" = 'automatic-activity-link-v3'));
