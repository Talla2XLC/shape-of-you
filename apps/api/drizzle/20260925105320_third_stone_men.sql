CREATE TABLE "training_program_workout_activity_titles" (
	"program_version_id" uuid NOT NULL,
	"workout_position" smallint NOT NULL,
	"person_id" uuid NOT NULL,
	"title" varchar(256) NOT NULL,
	"normalized_title" varchar(256) NOT NULL,
	"updated_at" timestamp with time zone DEFAULT now() NOT NULL,
	CONSTRAINT "training_program_workout_activity_titles_pk" PRIMARY KEY("program_version_id","workout_position"),
	CONSTRAINT "training_program_workout_activity_titles_name_uq" UNIQUE("program_version_id","normalized_title")
);
--> statement-breakpoint
ALTER TABLE "training_workout_session_activity_links" DROP CONSTRAINT "training_workout_activity_link_match_shape";--> statement-breakpoint
ALTER TABLE "training_program_workout_activity_titles" ADD CONSTRAINT "training_program_workout_activity_titles_workout_fk" FOREIGN KEY ("program_version_id","workout_position") REFERENCES "public"."training_program_workouts"("program_version_id","position") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "training_program_workout_activity_titles" ADD CONSTRAINT "training_program_workout_activity_titles_person_fk" FOREIGN KEY ("program_version_id","person_id") REFERENCES "public"."training_program_versions"("id","person_id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "training_workout_session_activity_links" ADD CONSTRAINT "training_workout_activity_link_match_shape" CHECK (("training_workout_session_activity_links"."match_basis" IS NULL AND "training_workout_session_activity_links"."match_policy_version" IS NULL)
          OR ("training_workout_session_activity_links"."match_basis" IN ('source_identity', 'trusted_title_and_time')
              AND "training_workout_session_activity_links"."match_policy_version" = 'automatic-activity-link-v2'));