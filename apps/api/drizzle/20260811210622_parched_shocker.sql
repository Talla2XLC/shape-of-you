CREATE TYPE "public"."day_closure_operation" AS ENUM('close', 'reopen');--> statement-breakpoint
CREATE TYPE "public"."day_closure_reference_kind" AS ENUM('weight_measurement', 'body_measurement_session', 'meal', 'workout_session', 'recovery_observation', 'recovery_assessment', 'coaching_recommendation');--> statement-breakpoint
CREATE TYPE "public"."day_closure_status" AS ENUM('active', 'superseded');--> statement-breakpoint
CREATE TABLE "day_closure_operations" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"person_id" uuid NOT NULL,
	"operation" "day_closure_operation" NOT NULL,
	"local_date" date NOT NULL,
	"idempotency_key" varchar(256) NOT NULL,
	"request_fingerprint" varchar(128) NOT NULL,
	"closure_id" uuid NOT NULL,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	CONSTRAINT "day_closure_ops_person_op_key_uq" UNIQUE("person_id","operation","idempotency_key")
);
--> statement-breakpoint
CREATE TABLE "day_closure_references" (
	"closure_id" uuid NOT NULL,
	"kind" "day_closure_reference_kind" NOT NULL,
	"reference_id" uuid NOT NULL,
	CONSTRAINT "day_closure_refs_closure_kind_id_uq" UNIQUE("closure_id","kind","reference_id")
);
--> statement-breakpoint
CREATE TABLE "day_closures" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"person_id" uuid NOT NULL,
	"local_date" date NOT NULL,
	"timezone" varchar(64) NOT NULL,
	"version" integer NOT NULL,
	"status" "day_closure_status" DEFAULT 'active' NOT NULL,
	"policy_version" varchar(128) NOT NULL,
	"snapshot" jsonb NOT NULL,
	"state_fingerprint" varchar(128) NOT NULL,
	"supersedes_id" uuid,
	"closed_at" timestamp with time zone DEFAULT now() NOT NULL,
	"reopened_at" timestamp with time zone,
	"reopen_reason" varchar(512),
	CONSTRAINT "day_closures_id_person_uq" UNIQUE("id","person_id"),
	CONSTRAINT "day_closures_person_date_version_uq" UNIQUE("person_id","local_date","version"),
	CONSTRAINT "day_closures_version_positive" CHECK ("day_closures"."version" > 0),
	CONSTRAINT "day_closures_reopen_shape" CHECK (("day_closures"."status" = 'active' AND "day_closures"."reopened_at" IS NULL AND "day_closures"."reopen_reason" IS NULL)
          OR ("day_closures"."status" = 'superseded' AND "day_closures"."reopened_at" IS NOT NULL AND "day_closures"."reopen_reason" IS NOT NULL)),
	CONSTRAINT "day_closures_no_self_supersede" CHECK ("day_closures"."supersedes_id" IS NULL OR "day_closures"."supersedes_id" <> "day_closures"."id")
);
--> statement-breakpoint
ALTER TABLE "day_closure_operations" ADD CONSTRAINT "day_closure_operations_person_id_persons_id_fk" FOREIGN KEY ("person_id") REFERENCES "public"."persons"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "day_closure_operations" ADD CONSTRAINT "day_closure_ops_closure_person_fk" FOREIGN KEY ("closure_id","person_id") REFERENCES "public"."day_closures"("id","person_id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "day_closure_references" ADD CONSTRAINT "day_closure_refs_closure_fk" FOREIGN KEY ("closure_id") REFERENCES "public"."day_closures"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "day_closures" ADD CONSTRAINT "day_closures_person_id_persons_id_fk" FOREIGN KEY ("person_id") REFERENCES "public"."persons"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "day_closures" ADD CONSTRAINT "day_closures_supersedes_fk" FOREIGN KEY ("supersedes_id","person_id") REFERENCES "public"."day_closures"("id","person_id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
CREATE UNIQUE INDEX "day_closures_active_date_uq" ON "day_closures" USING btree ("person_id","local_date") WHERE "day_closures"."status" = 'active';