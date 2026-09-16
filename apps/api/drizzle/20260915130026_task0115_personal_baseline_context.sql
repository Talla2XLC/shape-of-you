CREATE TYPE "public"."baseline_eligibility" AS ENUM('include', 'exclude');--> statement-breakpoint
CREATE TYPE "public"."daily_context_kind" AS ENUM('general', 'travel');--> statement-breakpoint
ALTER TABLE "daily_context_notes" ADD COLUMN "context_kind" "daily_context_kind" DEFAULT 'general' NOT NULL;--> statement-breakpoint
ALTER TABLE "daily_context_notes" ADD COLUMN "baseline_eligibility" "baseline_eligibility" DEFAULT 'include' NOT NULL;--> statement-breakpoint
ALTER TABLE "daily_context_notes" ADD CONSTRAINT "daily_context_notes_baseline_eligibility" CHECK (("daily_context_notes"."context_kind" = 'travel' AND "daily_context_notes"."baseline_eligibility" = 'exclude') OR ("daily_context_notes"."context_kind" = 'general' AND "daily_context_notes"."baseline_eligibility" = 'include'));