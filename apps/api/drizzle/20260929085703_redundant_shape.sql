CREATE TABLE "training_program_weight_changes" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"person_id" uuid NOT NULL,
	"request_id" uuid NOT NULL,
	"payload_hash" varchar(64) NOT NULL,
	"program_id" uuid NOT NULL,
	"base_version_id" uuid NOT NULL,
	"new_version_id" uuid NOT NULL,
	"workout_position" smallint NOT NULL,
	"prescription_position" smallint NOT NULL,
	"exercise_version_id" uuid NOT NULL,
	"old_weight_kg" numeric(9, 3) NOT NULL,
	"new_weight_kg" numeric(9, 3) NOT NULL,
	"evidence_session_one_id" uuid NOT NULL,
	"evidence_session_two_id" uuid NOT NULL,
	"local_date" date NOT NULL,
	"assessment_checksum" varchar(64) NOT NULL,
	"evidence_revision" varchar(64) NOT NULL,
	"confirmation_source" varchar(32) NOT NULL,
	"confirmed_at" timestamp with time zone DEFAULT now() NOT NULL,
	CONSTRAINT "training_weight_change_request_uq" UNIQUE("person_id","request_id"),
	CONSTRAINT "training_weight_change_new_version_uq" UNIQUE("new_version_id"),
	CONSTRAINT "training_weight_change_weight_increase" CHECK ("training_program_weight_changes"."new_weight_kg" > "training_program_weight_changes"."old_weight_kg"),
	CONSTRAINT "training_weight_change_distinct_sessions" CHECK ("training_program_weight_changes"."evidence_session_one_id" <> "training_program_weight_changes"."evidence_session_two_id"),
	CONSTRAINT "training_weight_change_source" CHECK ("training_program_weight_changes"."confirmation_source" = 'coach_explicit_confirmation')
);
--> statement-breakpoint
ALTER TABLE "training_program_weight_changes" ADD CONSTRAINT "training_weight_change_program_fk" FOREIGN KEY ("program_id","person_id") REFERENCES "public"."training_programs"("id","person_id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "training_program_weight_changes" ADD CONSTRAINT "training_weight_change_base_version_fk" FOREIGN KEY ("base_version_id","program_id","person_id") REFERENCES "public"."training_program_versions"("id","program_id","person_id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "training_program_weight_changes" ADD CONSTRAINT "training_weight_change_new_version_fk" FOREIGN KEY ("new_version_id","program_id","person_id") REFERENCES "public"."training_program_versions"("id","program_id","person_id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "training_program_weight_changes" ADD CONSTRAINT "training_weight_change_session_one_fk" FOREIGN KEY ("evidence_session_one_id","person_id") REFERENCES "public"."workout_sessions"("id","person_id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "training_program_weight_changes" ADD CONSTRAINT "training_weight_change_session_two_fk" FOREIGN KEY ("evidence_session_two_id","person_id") REFERENCES "public"."workout_sessions"("id","person_id") ON DELETE no action ON UPDATE no action;