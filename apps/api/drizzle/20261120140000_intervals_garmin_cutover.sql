ALTER TYPE "integration_sync_failure" ADD VALUE IF NOT EXISTS 'cutover_source_stopped';
--> statement-breakpoint
ALTER TABLE "integration_connections" ADD COLUMN "historical_scope_from_date" date DEFAULT '2000-01-01' NOT NULL;
--> statement-breakpoint
ALTER TABLE "integration_connections" ADD COLUMN "remote_disconnect_attempts" integer DEFAULT 0 NOT NULL, ADD COLUMN "remote_revoke_unconfirmed" boolean DEFAULT false NOT NULL;
--> statement-breakpoint
ALTER TABLE "integration_connections" DROP CONSTRAINT "integration_connections_historical_state_shape";
--> statement-breakpoint
ALTER TABLE "integration_connections" ADD CONSTRAINT "integration_connections_historical_state_shape" CHECK (
 (historical_import_status = 'not_requested' AND historical_cursor_before IS NULL AND historical_requested_at IS NULL AND historical_last_attempt_at IS NULL AND historical_completed_at IS NULL AND historical_next_attempt_at IS NULL AND historical_failure_code IS NULL AND historical_claim_token IS NULL)
 OR (historical_import_status = 'running' AND historical_requested_at IS NOT NULL AND historical_completed_at IS NULL)
 OR (historical_import_status = 'completed' AND historical_cursor_before = historical_scope_from_date AND historical_requested_at IS NOT NULL AND historical_completed_at IS NOT NULL AND historical_next_attempt_at IS NULL AND historical_failure_code IS NULL AND historical_claim_token IS NULL)
 OR (historical_import_status = 'failed' AND historical_requested_at IS NOT NULL AND historical_completed_at IS NULL AND historical_next_attempt_at IS NULL AND historical_failure_code IS NOT NULL AND historical_claim_token IS NULL)
);
--> statement-breakpoint
CREATE TABLE "integration_cutovers" (
 "id" uuid PRIMARY KEY DEFAULT gen_random_uuid(),
 "person_id" uuid NOT NULL REFERENCES persons(id) ON DELETE CASCADE,
 "source_provider" varchar(64) DEFAULT 'intervals_icu' NOT NULL,
 "target_provider" varchar(64) DEFAULT 'garmin_personal' NOT NULL,
 "source_connection_id" uuid,
 "target_connection_id" uuid,
 "source_recovery_connection_id" uuid,
 "target_recovery_connection_id" uuid,
 "source_consent_id" uuid,
 "target_consent_id" uuid,
 "starts_on" date NOT NULL,
 "timezone" varchar(64) NOT NULL,
 "starts_at" timestamptz NOT NULL,
 "source_drains_until" timestamptz NOT NULL,
 "state" varchar(16) DEFAULT 'scheduled' NOT NULL,
 "version" integer DEFAULT 1 NOT NULL,
 "capability_version" varchar(128) NOT NULL,
 "accepted_coverage_gaps" text[] DEFAULT '{}'::text[] NOT NULL,
 "dedupe_key" varchar(200) NOT NULL,
 "actor_person_id" uuid REFERENCES persons(id) ON DELETE SET NULL,
 "created_at" timestamptz DEFAULT now() NOT NULL,
 "activated_at" timestamptz,
 "cancelled_at" timestamptz,
 "updated_at" timestamptz DEFAULT now() NOT NULL,
 "failure_code" varchar(64),
 "last_attempt_at" timestamptz,
 "source_revocation_unconfirmed" boolean DEFAULT false NOT NULL,
 CONSTRAINT "cutover_source_connection_fk" FOREIGN KEY(source_connection_id) REFERENCES integration_connections(id) ON DELETE SET NULL,
 CONSTRAINT "cutover_target_connection_fk" FOREIGN KEY(target_connection_id) REFERENCES integration_connections(id) ON DELETE SET NULL,
 CONSTRAINT "cutover_source_recovery_fk" FOREIGN KEY(source_recovery_connection_id) REFERENCES recovery_connections(id) ON DELETE SET NULL,
 CONSTRAINT "cutover_target_recovery_fk" FOREIGN KEY(target_recovery_connection_id) REFERENCES recovery_connections(id) ON DELETE SET NULL,
 CONSTRAINT "cutover_source_consent_fk" FOREIGN KEY(source_consent_id) REFERENCES recovery_consents(id) ON DELETE SET NULL,
 CONSTRAINT "cutover_target_consent_fk" FOREIGN KEY(target_consent_id) REFERENCES recovery_consents(id) ON DELETE SET NULL,
 CONSTRAINT "integration_cutovers_pair" CHECK (source_provider = 'intervals_icu' AND target_provider = 'garmin_personal'),
 CONSTRAINT "integration_cutovers_state" CHECK (state IN ('scheduled','draining','active','failed','cancelled') AND version > 0),
 CONSTRAINT "integration_cutovers_dates" CHECK (source_drains_until > starts_at),
 CONSTRAINT "integration_cutovers_activation" CHECK ((state IN ('draining','active')) = (activated_at IS NOT NULL)),
 CONSTRAINT "integration_cutovers_gaps" CHECK (accepted_coverage_gaps <@ ARRAY['recovery.hrv_rmssd','recovery.sleep_score','training.normalized_load','training.device_attribution','training.original_fit']::text[]),
 CONSTRAINT "integration_cutovers_request_uq" UNIQUE(person_id,dedupe_key)
);
--> statement-breakpoint
CREATE UNIQUE INDEX "integration_cutovers_pending_person_uq" ON integration_cutovers(person_id) WHERE state IN ('scheduled','draining','active');
--> statement-breakpoint
CREATE INDEX "integration_cutovers_due_idx" ON integration_cutovers(state,starts_at,source_drains_until);
