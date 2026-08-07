ALTER TABLE "oauth_interactions" ADD COLUMN "provider_cid" varchar(200);--> statement-breakpoint
ALTER TABLE "oauth_interactions" ADD COLUMN "provider_return_to" text;--> statement-breakpoint
ALTER TABLE "oauth_sessions" ADD COLUMN "provider_credential_hash" "bytea";--> statement-breakpoint
DO $$
BEGIN
	IF EXISTS (SELECT 1 FROM "oauth_interactions") THEN
		RAISE EXCEPTION 'OAuth interaction provider state cannot be backfilled; expected oauth_interactions to be empty before enabling the provider runtime';
	END IF;
END
$$;--> statement-breakpoint
ALTER TABLE "oauth_interactions" ALTER COLUMN "provider_cid" SET NOT NULL;--> statement-breakpoint
ALTER TABLE "oauth_interactions" ALTER COLUMN "provider_return_to" SET NOT NULL;--> statement-breakpoint
ALTER TABLE "oauth_sessions" ADD CONSTRAINT "oauth_sessions_provider_credential_hash_uq" UNIQUE("provider_credential_hash");--> statement-breakpoint
ALTER TABLE "oauth_interactions" ADD CONSTRAINT "oauth_interactions_provider_cid_format" CHECK (length("oauth_interactions"."provider_cid") = 43 AND "oauth_interactions"."provider_cid" ~ '^[A-Za-z0-9_-]+$');--> statement-breakpoint
ALTER TABLE "oauth_interactions" ADD CONSTRAINT "oauth_interactions_provider_return_to_nonempty" CHECK (length(btrim("oauth_interactions"."provider_return_to")) > 0);--> statement-breakpoint
ALTER TABLE "oauth_sessions" ADD CONSTRAINT "oauth_sessions_provider_credential_hash_length" CHECK ("oauth_sessions"."provider_credential_hash" IS NULL OR octet_length("oauth_sessions"."provider_credential_hash") = 32);
