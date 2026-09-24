CREATE TABLE "external_activity_program_classifications" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"person_id" uuid NOT NULL,
	"lineage_root_activity_id" uuid NOT NULL,
	"activity_id" uuid NOT NULL,
	"program_id" uuid NOT NULL,
	"program_version_id" uuid NOT NULL,
	"kind" varchar(32) NOT NULL,
	"workout_position" smallint,
	"supersedes_id" uuid,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	CONSTRAINT "ext_activity_class_id_person_uq" UNIQUE("id","person_id"),
	CONSTRAINT "ext_activity_class_id_owner_root_uq" UNIQUE("id","person_id","lineage_root_activity_id"),
	CONSTRAINT "ext_activity_class_shape" CHECK (("kind" = 'program_workout' AND "workout_position" IS NOT NULL) OR ("kind" = 'not_program_workout' AND "workout_position" IS NULL)),
	CONSTRAINT "ext_activity_class_no_self_supersession" CHECK ("supersedes_id" IS NULL OR "supersedes_id" <> "id")
);
--> statement-breakpoint
ALTER TABLE "external_activity_program_classifications" ADD CONSTRAINT "ext_activity_class_person_fk" FOREIGN KEY ("person_id") REFERENCES "public"."persons"("id") ON DELETE cascade ON UPDATE no action;
--> statement-breakpoint
ALTER TABLE "external_activity_program_classifications" ADD CONSTRAINT "ext_activity_class_root_fk" FOREIGN KEY ("lineage_root_activity_id","person_id") REFERENCES "public"."integration_activity_facts"("id","person_id") ON DELETE cascade ON UPDATE no action;
--> statement-breakpoint
ALTER TABLE "external_activity_program_classifications" ADD CONSTRAINT "ext_activity_class_fact_fk" FOREIGN KEY ("activity_id","person_id") REFERENCES "public"."integration_activity_facts"("id","person_id") ON DELETE cascade ON UPDATE no action;
--> statement-breakpoint
ALTER TABLE "external_activity_program_classifications" ADD CONSTRAINT "ext_activity_class_version_fk" FOREIGN KEY ("program_version_id","program_id","person_id") REFERENCES "public"."training_program_versions"("id","program_id","person_id") ON DELETE cascade ON UPDATE no action;
--> statement-breakpoint
ALTER TABLE "external_activity_program_classifications" ADD CONSTRAINT "ext_activity_class_workout_fk" FOREIGN KEY ("program_version_id","workout_position") REFERENCES "public"."training_program_workouts"("program_version_id","position") ON DELETE no action ON UPDATE no action;
--> statement-breakpoint
ALTER TABLE "external_activity_program_classifications" ADD CONSTRAINT "ext_activity_class_supersedes_fk" FOREIGN KEY ("supersedes_id","person_id","lineage_root_activity_id") REFERENCES "public"."external_activity_program_classifications"("id","person_id","lineage_root_activity_id") ON DELETE no action ON UPDATE no action;
--> statement-breakpoint
CREATE UNIQUE INDEX "ext_activity_class_initial_uq" ON "external_activity_program_classifications" USING btree ("lineage_root_activity_id") WHERE "supersedes_id" IS NULL;
--> statement-breakpoint
CREATE UNIQUE INDEX "ext_activity_class_supersedes_uq" ON "external_activity_program_classifications" USING btree ("supersedes_id") WHERE "supersedes_id" IS NOT NULL;
--> statement-breakpoint
CREATE INDEX "ext_activity_class_current_idx" ON "external_activity_program_classifications" USING btree ("person_id","lineage_root_activity_id","created_at");
