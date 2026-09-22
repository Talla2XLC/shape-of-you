CREATE TABLE "training_program_cadence_workouts" (
	"program_version_id" uuid NOT NULL,
	"sequence_position" smallint NOT NULL,
	"workout_position" smallint NOT NULL,
	CONSTRAINT "training_program_cadence_workouts_sequence_uq" UNIQUE("program_version_id","sequence_position"),
	CONSTRAINT "training_program_cadence_workouts_positions" CHECK ("training_program_cadence_workouts"."sequence_position" > 0 AND "training_program_cadence_workouts"."workout_position" > 0)
);
--> statement-breakpoint
CREATE TABLE "training_program_cadences" (
	"program_version_id" uuid PRIMARY KEY NOT NULL,
	"kind" varchar(32) NOT NULL,
	"strength_sessions_per_week" smallint NOT NULL,
	"cardio_sessions_per_week" smallint,
	"cardio_duration_seconds" integer,
	"cardio_heart_rate_min" smallint,
	"cardio_heart_rate_max" smallint,
	"cardio_warmup_seconds" integer,
	"cardio_work_seconds" integer,
	"cardio_cooldown_seconds" integer,
	CONSTRAINT "training_program_cadence_values" CHECK ("training_program_cadences"."kind" = 'rolling_weekly'
        AND "training_program_cadences"."strength_sessions_per_week" BETWEEN 1 AND 14
        AND (
          ("training_program_cadences"."cardio_sessions_per_week" IS NULL
            AND "training_program_cadences"."cardio_duration_seconds" IS NULL
            AND "training_program_cadences"."cardio_heart_rate_min" IS NULL
            AND "training_program_cadences"."cardio_heart_rate_max" IS NULL
            AND "training_program_cadences"."cardio_warmup_seconds" IS NULL
            AND "training_program_cadences"."cardio_work_seconds" IS NULL
            AND "training_program_cadences"."cardio_cooldown_seconds" IS NULL)
          OR
          ("training_program_cadences"."cardio_sessions_per_week" BETWEEN 1 AND 14
            AND "training_program_cadences"."cardio_duration_seconds" > 0
            AND "training_program_cadences"."cardio_heart_rate_min" BETWEEN 30 AND 250
            AND "training_program_cadences"."cardio_heart_rate_max" >= "training_program_cadences"."cardio_heart_rate_min"
            AND "training_program_cadences"."cardio_heart_rate_max" <= 250
            AND "training_program_cadences"."cardio_warmup_seconds" >= 0
            AND "training_program_cadences"."cardio_work_seconds" > 0
            AND "training_program_cadences"."cardio_cooldown_seconds" >= 0
            AND "training_program_cadences"."cardio_warmup_seconds" + "training_program_cadences"."cardio_work_seconds" + "training_program_cadences"."cardio_cooldown_seconds" = "training_program_cadences"."cardio_duration_seconds")
        ))
);
--> statement-breakpoint
CREATE TABLE "training_workout_session_activity_links" (
	"session_id" uuid PRIMARY KEY NOT NULL,
	"person_id" uuid NOT NULL,
	"external_activity_id" uuid NOT NULL
);
--> statement-breakpoint
ALTER TABLE "workout_sessions" ADD COLUMN "program_workout_position" smallint;--> statement-breakpoint
ALTER TABLE "training_program_cadence_workouts" ADD CONSTRAINT "training_program_cadence_workout_version_fk" FOREIGN KEY ("program_version_id") REFERENCES "public"."training_program_cadences"("program_version_id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "training_program_cadence_workouts" ADD CONSTRAINT "training_program_cadence_workout_target_fk" FOREIGN KEY ("program_version_id","workout_position") REFERENCES "public"."training_program_workouts"("program_version_id","position") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "training_program_cadences" ADD CONSTRAINT "training_program_cadence_version_fk" FOREIGN KEY ("program_version_id") REFERENCES "public"."training_program_versions"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "training_workout_session_activity_links" ADD CONSTRAINT "training_workout_activity_link_session_fk" FOREIGN KEY ("session_id","person_id") REFERENCES "public"."workout_sessions"("id","person_id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "training_workout_session_activity_links" ADD CONSTRAINT "training_workout_activity_link_external_fk" FOREIGN KEY ("external_activity_id","person_id") REFERENCES "public"."integration_activity_facts"("id","person_id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
CREATE INDEX "training_workout_activity_link_external_idx" ON "training_workout_session_activity_links" USING btree ("person_id","external_activity_id");--> statement-breakpoint
ALTER TABLE "workout_sessions" ADD CONSTRAINT "workout_session_program_workout_fk" FOREIGN KEY ("program_version_id","program_workout_position") REFERENCES "public"."training_program_workouts"("program_version_id","position") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "workout_sessions" ADD CONSTRAINT "workout_sessions_program_workout_shape" CHECK ("workout_sessions"."program_workout_position" IS NULL OR "workout_sessions"."program_version_id" IS NOT NULL);