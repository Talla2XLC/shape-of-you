CREATE TYPE "public"."daily_recommendation_feedback_status" AS ENUM('accepted', 'completed', 'skipped', 'too_heavy', 'unsuitable');--> statement-breakpoint
CREATE TABLE "coaching_daily_recommendation_feedback" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"recommendation_id" uuid NOT NULL,
	"person_id" uuid NOT NULL,
	"actor_person_id" uuid NOT NULL,
	"status" "daily_recommendation_feedback_status" NOT NULL,
	"comment" varchar(1000),
	"idempotency_key" varchar(256) NOT NULL,
	"reported_at" timestamp with time zone DEFAULT now() NOT NULL,
	CONSTRAINT "coach_daily_feedback_person_dedupe_uq" UNIQUE("person_id","idempotency_key"),
	CONSTRAINT "coach_daily_feedback_status_uq" UNIQUE("recommendation_id","status"),
	CONSTRAINT "coach_daily_feedback_actor_owner" CHECK ("coaching_daily_recommendation_feedback"."actor_person_id" = "coaching_daily_recommendation_feedback"."person_id"),
	CONSTRAINT "coach_daily_feedback_comment_nonblank" CHECK ("coaching_daily_recommendation_feedback"."comment" IS NULL OR btrim("coaching_daily_recommendation_feedback"."comment") <> '')
);
--> statement-breakpoint
ALTER TABLE "coaching_daily_assessment_details" ADD CONSTRAINT "coach_daily_assessment_id_person_uq" UNIQUE("recommendation_id","person_id");--> statement-breakpoint
ALTER TABLE "coaching_daily_recommendation_feedback" ADD CONSTRAINT "coach_daily_feedback_snapshot_fk" FOREIGN KEY ("recommendation_id","person_id") REFERENCES "public"."coaching_daily_assessment_details"("recommendation_id","person_id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "coaching_daily_recommendation_feedback" ADD CONSTRAINT "coach_daily_feedback_actor_fk" FOREIGN KEY ("actor_person_id") REFERENCES "public"."persons"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
CREATE UNIQUE INDEX "coach_daily_feedback_disposition_uq" ON "coaching_daily_recommendation_feedback" USING btree ("recommendation_id") WHERE "coaching_daily_recommendation_feedback"."status" in ('completed', 'skipped');--> statement-breakpoint
CREATE INDEX "coach_daily_feedback_person_time_idx" ON "coaching_daily_recommendation_feedback" USING btree ("person_id","reported_at");
