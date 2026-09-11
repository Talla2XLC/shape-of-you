CREATE TYPE "public"."integration_historical_import_status" AS ENUM('not_requested', 'running', 'completed', 'failed');--> statement-breakpoint
ALTER TABLE "integration_connections" ADD COLUMN "historical_import_status" "integration_historical_import_status" DEFAULT 'not_requested' NOT NULL;--> statement-breakpoint
ALTER TABLE "integration_connections" ADD COLUMN "historical_cursor_before" date;--> statement-breakpoint
ALTER TABLE "integration_connections" ADD COLUMN "historical_requested_at" timestamp with time zone;--> statement-breakpoint
ALTER TABLE "integration_connections" ADD COLUMN "historical_last_attempt_at" timestamp with time zone;--> statement-breakpoint
ALTER TABLE "integration_connections" ADD COLUMN "historical_completed_at" timestamp with time zone;--> statement-breakpoint
ALTER TABLE "integration_connections" ADD COLUMN "historical_next_attempt_at" timestamp with time zone;--> statement-breakpoint
ALTER TABLE "integration_connections" ADD COLUMN "historical_failure_code" "integration_sync_failure";