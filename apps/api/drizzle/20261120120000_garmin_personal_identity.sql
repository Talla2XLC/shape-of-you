ALTER TABLE integration_connections ALTER COLUMN external_user_id DROP NOT NULL;
--> statement-breakpoint
ALTER TABLE integration_connections ADD CONSTRAINT integration_external_identity_shape CHECK (
  (provider_key = 'garmin_personal' AND (external_user_id IS NULL OR length(external_user_id) > 0))
  OR (provider_key <> 'garmin_personal' AND external_user_id IS NOT NULL AND length(external_user_id) > 0)
);
