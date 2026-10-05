ALTER TABLE "integration_inbox" ADD COLUMN "activity_details_issue" varchar(64);--> statement-breakpoint
ALTER TABLE "integration_inbox" ADD COLUMN "activity_details_attempted_at" timestamp with time zone;
