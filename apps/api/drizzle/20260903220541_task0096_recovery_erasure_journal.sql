ALTER TABLE "recovery_erasure_requests" ADD COLUMN "journal_accepted_at" timestamp with time zone;--> statement-breakpoint
ALTER TABLE "recovery_erasure_requests" ADD COLUMN "journal_completed_at" timestamp with time zone;--> statement-breakpoint
ALTER TABLE "recovery_erasure_requests" ADD CONSTRAINT "recovery_erasure_journal_shape" CHECK ("recovery_erasure_requests"."journal_completed_at" IS NULL
          OR ("recovery_erasure_requests"."journal_accepted_at" IS NOT NULL AND "recovery_erasure_requests"."completed_at" IS NOT NULL));