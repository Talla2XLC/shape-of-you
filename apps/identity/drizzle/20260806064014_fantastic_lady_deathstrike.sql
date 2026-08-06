ALTER TABLE "oauth_sessions" ADD COLUMN "webauthn_credential_id" uuid;--> statement-breakpoint
ALTER TABLE "oauth_sessions" ADD COLUMN "last_activity_at" timestamp with time zone;--> statement-breakpoint
UPDATE "oauth_sessions" SET "last_activity_at" = "authenticated_at", "expires_at" = LEAST("expires_at", "authenticated_at" + interval '30 days');--> statement-breakpoint
ALTER TABLE "oauth_sessions" ALTER COLUMN "last_activity_at" SET NOT NULL;--> statement-breakpoint
ALTER TABLE "webauthn_credentials" ADD CONSTRAINT "webauthn_credentials_id_account_uq" UNIQUE("id","account_id");--> statement-breakpoint
ALTER TABLE "oauth_sessions" ADD CONSTRAINT "oauth_sessions_webauthn_credential_account_fk" FOREIGN KEY ("webauthn_credential_id","account_id") REFERENCES "public"."webauthn_credentials"("id","account_id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
CREATE INDEX "oauth_sessions_webauthn_credential_idx" ON "oauth_sessions" USING btree ("webauthn_credential_id");--> statement-breakpoint
ALTER TABLE "oauth_sessions" ADD CONSTRAINT "oauth_sessions_activity_window" CHECK ("oauth_sessions"."last_activity_at" >= "oauth_sessions"."authenticated_at" AND "oauth_sessions"."last_activity_at" < "oauth_sessions"."expires_at" AND "oauth_sessions"."expires_at" <= "oauth_sessions"."last_activity_at" + interval '30 days');--> statement-breakpoint
ALTER TABLE "oauth_sessions" ADD CONSTRAINT "oauth_sessions_passkey_binding" CHECK (array_position("oauth_sessions"."amr", 'passkey') IS NULL OR "oauth_sessions"."webauthn_credential_id" IS NOT NULL);--> statement-breakpoint
ALTER TABLE "webauthn_challenges" ADD CONSTRAINT "webauthn_challenges_max_lifetime" CHECK ("webauthn_challenges"."expires_at" <= "webauthn_challenges"."created_at" + interval '5 minutes');
