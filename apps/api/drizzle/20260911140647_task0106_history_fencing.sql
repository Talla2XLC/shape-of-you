ALTER TABLE "integration_connections" ADD COLUMN "historical_claim_token" uuid;--> statement-breakpoint
ALTER TABLE "integration_connections" ADD COLUMN "historical_claim_until" timestamp with time zone;--> statement-breakpoint
ALTER TABLE "integration_connections" ADD CONSTRAINT "integration_connections_historical_claim_shape" CHECK (("integration_connections"."historical_claim_token" IS NULL AND "integration_connections"."historical_claim_until" IS NULL)
        OR ("integration_connections"."historical_claim_token" IS NOT NULL AND "integration_connections"."historical_claim_until" IS NOT NULL));--> statement-breakpoint
ALTER TABLE "integration_connections" ADD CONSTRAINT "integration_connections_historical_state_shape" CHECK (("integration_connections"."historical_import_status" = 'not_requested'
          AND "integration_connections"."historical_cursor_before" IS NULL
          AND "integration_connections"."historical_requested_at" IS NULL
          AND "integration_connections"."historical_last_attempt_at" IS NULL
          AND "integration_connections"."historical_completed_at" IS NULL
          AND "integration_connections"."historical_next_attempt_at" IS NULL
          AND "integration_connections"."historical_failure_code" IS NULL
          AND "integration_connections"."historical_claim_token" IS NULL)
        OR ("integration_connections"."historical_import_status" = 'running'
          AND "integration_connections"."historical_requested_at" IS NOT NULL
          AND "integration_connections"."historical_completed_at" IS NULL)
        OR ("integration_connections"."historical_import_status" = 'completed'
          AND "integration_connections"."historical_cursor_before" = '2000-01-01'
          AND "integration_connections"."historical_requested_at" IS NOT NULL
          AND "integration_connections"."historical_completed_at" IS NOT NULL
          AND "integration_connections"."historical_next_attempt_at" IS NULL
          AND "integration_connections"."historical_failure_code" IS NULL
          AND "integration_connections"."historical_claim_token" IS NULL)
        OR ("integration_connections"."historical_import_status" = 'failed'
          AND "integration_connections"."historical_requested_at" IS NOT NULL
          AND "integration_connections"."historical_completed_at" IS NULL
          AND "integration_connections"."historical_next_attempt_at" IS NULL
          AND "integration_connections"."historical_failure_code" IS NOT NULL
          AND "integration_connections"."historical_claim_token" IS NULL));