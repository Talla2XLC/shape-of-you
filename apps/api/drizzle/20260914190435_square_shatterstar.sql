CREATE TYPE "public"."daily_assessment_status" AS ENUM('ready', 'caution', 'recovery_priority', 'insufficient_data');--> statement-breakpoint
ALTER TYPE "public"."coaching_recommendation_kind" ADD VALUE 'daily_next_action';--> statement-breakpoint
CREATE TABLE "coaching_daily_assessment_details" (
	"recommendation_id" uuid PRIMARY KEY NOT NULL,
	"person_id" uuid NOT NULL,
	"local_date" date NOT NULL,
	"timezone" varchar(64) NOT NULL,
	"status" "daily_assessment_status" NOT NULL,
	"confidence" numeric(4, 3) NOT NULL,
	"policy_version" varchar(128) NOT NULL,
	"used_facts" jsonb NOT NULL,
	"missing_important_data" text[] NOT NULL,
	"reasons" text[] NOT NULL,
	"recommended_action" jsonb NOT NULL,
	"alternatives" jsonb NOT NULL,
	"limitations" text[] NOT NULL,
	CONSTRAINT "coaching_daily_assessment_confidence" CHECK ("coaching_daily_assessment_details"."confidence" BETWEEN 0 AND 1)
);
--> statement-breakpoint
ALTER TABLE "persons" ADD COLUMN "timezone" varchar(64);--> statement-breakpoint
ALTER TABLE "coaching_daily_assessment_details" ADD CONSTRAINT "coaching_daily_assessment_recommendation_fk" FOREIGN KEY ("recommendation_id","person_id") REFERENCES "public"."coaching_recommendations"("id","person_id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
CREATE INDEX "coaching_daily_assessment_person_date_idx" ON "coaching_daily_assessment_details" USING btree ("person_id","local_date");