CREATE TYPE "public"."oauth_client_status" AS ENUM('active', 'disabled');--> statement-breakpoint
CREATE TYPE "public"."oauth_code_challenge_method" AS ENUM('S256');--> statement-breakpoint
CREATE TYPE "public"."oauth_interaction_prompt" AS ENUM('login', 'consent');--> statement-breakpoint
CREATE TYPE "public"."oauth_interaction_status" AS ENUM('pending', 'completed', 'abandoned');--> statement-breakpoint
CREATE TABLE "oauth_authorization_codes" (
	"id" uuid PRIMARY KEY NOT NULL,
	"code_hash" "bytea" NOT NULL,
	"account_id" uuid NOT NULL,
	"client_id" varchar(200) NOT NULL,
	"session_id" uuid NOT NULL,
	"grant_id" uuid NOT NULL,
	"redirect_uri" text NOT NULL,
	"code_challenge" varchar(128) NOT NULL,
	"code_challenge_method" "oauth_code_challenge_method" DEFAULT 'S256' NOT NULL,
	"resource" text NOT NULL,
	"issued_scopes" text[] NOT NULL,
	"oidc_nonce" text,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	"expires_at" timestamp with time zone NOT NULL,
	"consumed_at" timestamp with time zone,
	CONSTRAINT "oauth_authorization_codes_hash_uq" UNIQUE("code_hash"),
	CONSTRAINT "oauth_authorization_codes_hash_length" CHECK (octet_length("oauth_authorization_codes"."code_hash") = 32),
	CONSTRAINT "oauth_authorization_codes_pkce_s256" CHECK (length("oauth_authorization_codes"."code_challenge") = 43 AND "oauth_authorization_codes"."code_challenge" ~ '^[A-Za-z0-9_-]+$'),
	CONSTRAINT "oauth_authorization_codes_resource_nonempty" CHECK (length(btrim("oauth_authorization_codes"."resource")) > 0),
	CONSTRAINT "oauth_authorization_codes_scopes_nonempty" CHECK (cardinality("oauth_authorization_codes"."issued_scopes") > 0 AND array_position("oauth_authorization_codes"."issued_scopes", NULL) IS NULL),
	CONSTRAINT "oauth_authorization_codes_expiry_after_creation" CHECK ("oauth_authorization_codes"."expires_at" > "oauth_authorization_codes"."created_at"),
	CONSTRAINT "oauth_authorization_codes_consumption_window" CHECK ("oauth_authorization_codes"."consumed_at" IS NULL OR ("oauth_authorization_codes"."consumed_at" >= "oauth_authorization_codes"."created_at" AND "oauth_authorization_codes"."consumed_at" <= "oauth_authorization_codes"."expires_at"))
);
--> statement-breakpoint
CREATE TABLE "oauth_client_allowed_scopes" (
	"client_id" varchar(200) NOT NULL,
	"scope" varchar(200) NOT NULL,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	CONSTRAINT "oauth_client_allowed_scopes_pk" PRIMARY KEY("client_id","scope"),
	CONSTRAINT "oauth_client_allowed_scopes_format" CHECK (length(btrim("oauth_client_allowed_scopes"."scope")) > 0 AND "oauth_client_allowed_scopes"."scope" !~ '[[:space:]]')
);
--> statement-breakpoint
CREATE TABLE "oauth_client_redirect_uris" (
	"id" uuid PRIMARY KEY NOT NULL,
	"client_id" varchar(200) NOT NULL,
	"redirect_uri" text NOT NULL,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	CONSTRAINT "oauth_client_redirect_uris_client_uri_uq" UNIQUE("client_id","redirect_uri"),
	CONSTRAINT "oauth_client_redirect_uris_nonempty" CHECK (length(btrim("oauth_client_redirect_uris"."redirect_uri")) > 0),
	CONSTRAINT "oauth_client_redirect_uris_no_fragment" CHECK (position('#' in "oauth_client_redirect_uris"."redirect_uri") = 0)
);
--> statement-breakpoint
CREATE TABLE "oauth_clients" (
	"id" varchar(200) PRIMARY KEY NOT NULL,
	"display_name" varchar(200) NOT NULL,
	"status" "oauth_client_status" DEFAULT 'active' NOT NULL,
	"refresh_tokens_enabled" boolean DEFAULT false NOT NULL,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	"updated_at" timestamp with time zone DEFAULT now() NOT NULL,
	"disabled_at" timestamp with time zone,
	CONSTRAINT "oauth_clients_id_nonempty" CHECK (length(btrim("oauth_clients"."id")) > 0),
	CONSTRAINT "oauth_clients_display_name_nonempty" CHECK (length(btrim("oauth_clients"."display_name")) > 0),
	CONSTRAINT "oauth_clients_disabled_state" CHECK (("oauth_clients"."status" = 'active' AND "oauth_clients"."disabled_at" IS NULL) OR ("oauth_clients"."status" = 'disabled' AND "oauth_clients"."disabled_at" IS NOT NULL))
);
--> statement-breakpoint
CREATE TABLE "oauth_grant_oidc_scopes" (
	"grant_id" uuid NOT NULL,
	"client_id" varchar(200) NOT NULL,
	"scope" varchar(200) NOT NULL,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	CONSTRAINT "oauth_grant_oidc_scopes_pk" PRIMARY KEY("grant_id","scope")
);
--> statement-breakpoint
CREATE TABLE "oauth_grant_resource_scopes" (
	"grant_id" uuid NOT NULL,
	"client_id" varchar(200) NOT NULL,
	"resource" text NOT NULL,
	"scope" varchar(200) NOT NULL,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	CONSTRAINT "oauth_grant_resource_scopes_pk" PRIMARY KEY("grant_id","resource","scope"),
	CONSTRAINT "oauth_grant_resource_scopes_resource_nonempty" CHECK (length(btrim("oauth_grant_resource_scopes"."resource")) > 0)
);
--> statement-breakpoint
CREATE TABLE "oauth_grants" (
	"id" uuid PRIMARY KEY NOT NULL,
	"account_id" uuid NOT NULL,
	"client_id" varchar(200) NOT NULL,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	"expires_at" timestamp with time zone,
	"revoked_at" timestamp with time zone,
	CONSTRAINT "oauth_grants_id_account_client_uq" UNIQUE("id","account_id","client_id"),
	CONSTRAINT "oauth_grants_id_client_uq" UNIQUE("id","client_id"),
	CONSTRAINT "oauth_grants_expiry_after_creation" CHECK ("oauth_grants"."expires_at" IS NULL OR "oauth_grants"."expires_at" > "oauth_grants"."created_at"),
	CONSTRAINT "oauth_grants_revocation_after_creation" CHECK ("oauth_grants"."revoked_at" IS NULL OR "oauth_grants"."revoked_at" >= "oauth_grants"."created_at")
);
--> statement-breakpoint
CREATE TABLE "oauth_interaction_requested_resources" (
	"interaction_id" uuid NOT NULL,
	"resource" text NOT NULL,
	CONSTRAINT "oauth_interaction_requested_resources_pk" PRIMARY KEY("interaction_id","resource"),
	CONSTRAINT "oauth_interaction_resources_nonempty" CHECK (length(btrim("oauth_interaction_requested_resources"."resource")) > 0)
);
--> statement-breakpoint
CREATE TABLE "oauth_interaction_requested_scopes" (
	"interaction_id" uuid NOT NULL,
	"client_id" varchar(200) NOT NULL,
	"scope" varchar(200) NOT NULL,
	CONSTRAINT "oauth_interaction_requested_scopes_pk" PRIMARY KEY("interaction_id","scope")
);
--> statement-breakpoint
CREATE TABLE "oauth_interactions" (
	"id" uuid PRIMARY KEY NOT NULL,
	"credential_hash" "bytea" NOT NULL,
	"client_id" varchar(200) NOT NULL,
	"account_id" uuid,
	"session_id" uuid,
	"grant_id" uuid,
	"prompt" "oauth_interaction_prompt" NOT NULL,
	"status" "oauth_interaction_status" DEFAULT 'pending' NOT NULL,
	"redirect_uri" text NOT NULL,
	"code_challenge" varchar(128) NOT NULL,
	"code_challenge_method" "oauth_code_challenge_method" DEFAULT 'S256' NOT NULL,
	"client_state" text,
	"oidc_nonce" text,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	"expires_at" timestamp with time zone NOT NULL,
	"completed_at" timestamp with time zone,
	"abandoned_at" timestamp with time zone,
	CONSTRAINT "oauth_interactions_id_client_uq" UNIQUE("id","client_id"),
	CONSTRAINT "oauth_interactions_credential_hash_uq" UNIQUE("credential_hash"),
	CONSTRAINT "oauth_interactions_credential_hash_length" CHECK (octet_length("oauth_interactions"."credential_hash") = 32),
	CONSTRAINT "oauth_interactions_pkce_s256" CHECK (length("oauth_interactions"."code_challenge") = 43 AND "oauth_interactions"."code_challenge" ~ '^[A-Za-z0-9_-]+$'),
	CONSTRAINT "oauth_interactions_expiry_after_creation" CHECK ("oauth_interactions"."expires_at" > "oauth_interactions"."created_at"),
	CONSTRAINT "oauth_interactions_account_session_pair" CHECK (("oauth_interactions"."account_id" IS NULL AND "oauth_interactions"."session_id" IS NULL AND "oauth_interactions"."grant_id" IS NULL) OR ("oauth_interactions"."account_id" IS NOT NULL AND "oauth_interactions"."session_id" IS NOT NULL)),
	CONSTRAINT "oauth_interactions_terminal_state" CHECK (("oauth_interactions"."status" = 'pending' AND "oauth_interactions"."completed_at" IS NULL AND "oauth_interactions"."abandoned_at" IS NULL) OR ("oauth_interactions"."status" = 'completed' AND "oauth_interactions"."completed_at" IS NOT NULL AND "oauth_interactions"."abandoned_at" IS NULL) OR ("oauth_interactions"."status" = 'abandoned' AND "oauth_interactions"."completed_at" IS NULL AND "oauth_interactions"."abandoned_at" IS NOT NULL)),
	CONSTRAINT "oauth_interactions_completion_window" CHECK ("oauth_interactions"."completed_at" IS NULL OR ("oauth_interactions"."completed_at" >= "oauth_interactions"."created_at" AND "oauth_interactions"."completed_at" <= "oauth_interactions"."expires_at")),
	CONSTRAINT "oauth_interactions_abandonment_after_creation" CHECK ("oauth_interactions"."abandoned_at" IS NULL OR "oauth_interactions"."abandoned_at" >= "oauth_interactions"."created_at")
);
--> statement-breakpoint
CREATE TABLE "oauth_refresh_token_families" (
	"id" uuid PRIMARY KEY NOT NULL,
	"account_id" uuid NOT NULL,
	"client_id" varchar(200) NOT NULL,
	"session_id" uuid NOT NULL,
	"grant_id" uuid NOT NULL,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	"expires_at" timestamp with time zone NOT NULL,
	"revoked_at" timestamp with time zone,
	"reuse_detected_at" timestamp with time zone,
	CONSTRAINT "oauth_refresh_families_binding_uq" UNIQUE("id","account_id","client_id","session_id","grant_id"),
	CONSTRAINT "oauth_refresh_families_expiry_after_creation" CHECK ("oauth_refresh_token_families"."expires_at" > "oauth_refresh_token_families"."created_at"),
	CONSTRAINT "oauth_refresh_families_revocation_after_creation" CHECK ("oauth_refresh_token_families"."revoked_at" IS NULL OR "oauth_refresh_token_families"."revoked_at" >= "oauth_refresh_token_families"."created_at"),
	CONSTRAINT "oauth_refresh_families_reuse_revokes" CHECK ("oauth_refresh_token_families"."reuse_detected_at" IS NULL OR ("oauth_refresh_token_families"."reuse_detected_at" >= "oauth_refresh_token_families"."created_at" AND "oauth_refresh_token_families"."revoked_at" IS NOT NULL AND "oauth_refresh_token_families"."revoked_at" <= "oauth_refresh_token_families"."reuse_detected_at"))
);
--> statement-breakpoint
CREATE TABLE "oauth_refresh_tokens" (
	"id" uuid PRIMARY KEY NOT NULL,
	"family_id" uuid NOT NULL,
	"generation" integer NOT NULL,
	"token_hash" "bytea" NOT NULL,
	"account_id" uuid NOT NULL,
	"client_id" varchar(200) NOT NULL,
	"session_id" uuid NOT NULL,
	"grant_id" uuid NOT NULL,
	"resource" text NOT NULL,
	"issued_scopes" text[] NOT NULL,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	"expires_at" timestamp with time zone NOT NULL,
	"consumed_at" timestamp with time zone,
	"revoked_at" timestamp with time zone,
	"replaced_by_generation" integer,
	CONSTRAINT "oauth_refresh_tokens_hash_uq" UNIQUE("token_hash"),
	CONSTRAINT "oauth_refresh_tokens_family_generation_uq" UNIQUE("family_id","generation"),
	CONSTRAINT "oauth_refresh_tokens_hash_length" CHECK (octet_length("oauth_refresh_tokens"."token_hash") = 32),
	CONSTRAINT "oauth_refresh_tokens_generation_nonnegative" CHECK ("oauth_refresh_tokens"."generation" >= 0),
	CONSTRAINT "oauth_refresh_tokens_resource_nonempty" CHECK (length(btrim("oauth_refresh_tokens"."resource")) > 0),
	CONSTRAINT "oauth_refresh_tokens_scopes_nonempty" CHECK (cardinality("oauth_refresh_tokens"."issued_scopes") > 0 AND array_position("oauth_refresh_tokens"."issued_scopes", NULL) IS NULL),
	CONSTRAINT "oauth_refresh_tokens_expiry_after_creation" CHECK ("oauth_refresh_tokens"."expires_at" > "oauth_refresh_tokens"."created_at"),
	CONSTRAINT "oauth_refresh_tokens_consumption_window" CHECK ("oauth_refresh_tokens"."consumed_at" IS NULL OR ("oauth_refresh_tokens"."consumed_at" >= "oauth_refresh_tokens"."created_at" AND "oauth_refresh_tokens"."consumed_at" <= "oauth_refresh_tokens"."expires_at")),
	CONSTRAINT "oauth_refresh_tokens_revocation_after_creation" CHECK ("oauth_refresh_tokens"."revoked_at" IS NULL OR "oauth_refresh_tokens"."revoked_at" >= "oauth_refresh_tokens"."created_at"),
	CONSTRAINT "oauth_refresh_tokens_replacement_consumed" CHECK ("oauth_refresh_tokens"."replaced_by_generation" IS NULL OR "oauth_refresh_tokens"."consumed_at" IS NOT NULL),
	CONSTRAINT "oauth_refresh_tokens_next_generation" CHECK ("oauth_refresh_tokens"."replaced_by_generation" IS NULL OR "oauth_refresh_tokens"."replaced_by_generation" = "oauth_refresh_tokens"."generation" + 1)
);
--> statement-breakpoint
CREATE TABLE "oauth_session_authorizations" (
	"session_id" uuid NOT NULL,
	"account_id" uuid NOT NULL,
	"client_id" varchar(200) NOT NULL,
	"grant_id" uuid NOT NULL,
	"authorized_at" timestamp with time zone DEFAULT now() NOT NULL,
	"revoked_at" timestamp with time zone,
	CONSTRAINT "oauth_session_authorizations_pk" PRIMARY KEY("session_id","client_id"),
	CONSTRAINT "oauth_session_authorizations_revocation_time" CHECK ("oauth_session_authorizations"."revoked_at" IS NULL OR "oauth_session_authorizations"."revoked_at" >= "oauth_session_authorizations"."authorized_at")
);
--> statement-breakpoint
CREATE TABLE "oauth_sessions" (
	"id" uuid PRIMARY KEY NOT NULL,
	"account_id" uuid NOT NULL,
	"credential_hash" "bytea" NOT NULL,
	"provider_uid" varchar(200) NOT NULL,
	"authenticated_at" timestamp with time zone NOT NULL,
	"acr" varchar(200) NOT NULL,
	"amr" text[] NOT NULL,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	"expires_at" timestamp with time zone NOT NULL,
	"revoked_at" timestamp with time zone,
	CONSTRAINT "oauth_sessions_id_account_uq" UNIQUE("id","account_id"),
	CONSTRAINT "oauth_sessions_credential_hash_uq" UNIQUE("credential_hash"),
	CONSTRAINT "oauth_sessions_provider_uid_uq" UNIQUE("provider_uid"),
	CONSTRAINT "oauth_sessions_credential_hash_length" CHECK (octet_length("oauth_sessions"."credential_hash") = 32),
	CONSTRAINT "oauth_sessions_provider_uid_nonempty" CHECK (length(btrim("oauth_sessions"."provider_uid")) > 0),
	CONSTRAINT "oauth_sessions_acr_nonempty" CHECK (length(btrim("oauth_sessions"."acr")) > 0),
	CONSTRAINT "oauth_sessions_amr_nonempty" CHECK (cardinality("oauth_sessions"."amr") > 0 AND array_position("oauth_sessions"."amr", NULL) IS NULL),
	CONSTRAINT "oauth_sessions_authentication_time" CHECK ("oauth_sessions"."authenticated_at" <= "oauth_sessions"."created_at"),
	CONSTRAINT "oauth_sessions_expiry_after_creation" CHECK ("oauth_sessions"."expires_at" > "oauth_sessions"."created_at"),
	CONSTRAINT "oauth_sessions_revocation_after_creation" CHECK ("oauth_sessions"."revoked_at" IS NULL OR "oauth_sessions"."revoked_at" >= "oauth_sessions"."created_at")
);
--> statement-breakpoint
ALTER TABLE "oauth_authorization_codes" ADD CONSTRAINT "oauth_authorization_codes_session_account_fk" FOREIGN KEY ("session_id","account_id") REFERENCES "public"."oauth_sessions"("id","account_id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "oauth_authorization_codes" ADD CONSTRAINT "oauth_authorization_codes_grant_binding_fk" FOREIGN KEY ("grant_id","account_id","client_id") REFERENCES "public"."oauth_grants"("id","account_id","client_id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "oauth_authorization_codes" ADD CONSTRAINT "oauth_authorization_codes_redirect_uri_fk" FOREIGN KEY ("client_id","redirect_uri") REFERENCES "public"."oauth_client_redirect_uris"("client_id","redirect_uri") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "oauth_client_allowed_scopes" ADD CONSTRAINT "oauth_client_allowed_scopes_client_id_oauth_clients_id_fk" FOREIGN KEY ("client_id") REFERENCES "public"."oauth_clients"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "oauth_client_redirect_uris" ADD CONSTRAINT "oauth_client_redirect_uris_client_id_oauth_clients_id_fk" FOREIGN KEY ("client_id") REFERENCES "public"."oauth_clients"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "oauth_grant_oidc_scopes" ADD CONSTRAINT "oauth_grant_oidc_scopes_grant_client_fk" FOREIGN KEY ("grant_id","client_id") REFERENCES "public"."oauth_grants"("id","client_id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "oauth_grant_oidc_scopes" ADD CONSTRAINT "oauth_grant_oidc_scopes_client_scope_fk" FOREIGN KEY ("client_id","scope") REFERENCES "public"."oauth_client_allowed_scopes"("client_id","scope") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "oauth_grant_resource_scopes" ADD CONSTRAINT "oauth_grant_resource_scopes_grant_client_fk" FOREIGN KEY ("grant_id","client_id") REFERENCES "public"."oauth_grants"("id","client_id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "oauth_grant_resource_scopes" ADD CONSTRAINT "oauth_grant_resource_scopes_client_scope_fk" FOREIGN KEY ("client_id","scope") REFERENCES "public"."oauth_client_allowed_scopes"("client_id","scope") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "oauth_grants" ADD CONSTRAINT "oauth_grants_account_id_identity_accounts_id_fk" FOREIGN KEY ("account_id") REFERENCES "public"."identity_accounts"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "oauth_grants" ADD CONSTRAINT "oauth_grants_client_id_oauth_clients_id_fk" FOREIGN KEY ("client_id") REFERENCES "public"."oauth_clients"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "oauth_interaction_requested_resources" ADD CONSTRAINT "oauth_interaction_resources_interaction_fk" FOREIGN KEY ("interaction_id") REFERENCES "public"."oauth_interactions"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "oauth_interaction_requested_scopes" ADD CONSTRAINT "oauth_interaction_scopes_interaction_client_fk" FOREIGN KEY ("interaction_id","client_id") REFERENCES "public"."oauth_interactions"("id","client_id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "oauth_interaction_requested_scopes" ADD CONSTRAINT "oauth_interaction_scopes_client_scope_fk" FOREIGN KEY ("client_id","scope") REFERENCES "public"."oauth_client_allowed_scopes"("client_id","scope") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "oauth_interactions" ADD CONSTRAINT "oauth_interactions_client_id_oauth_clients_id_fk" FOREIGN KEY ("client_id") REFERENCES "public"."oauth_clients"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "oauth_interactions" ADD CONSTRAINT "oauth_interactions_redirect_uri_fk" FOREIGN KEY ("client_id","redirect_uri") REFERENCES "public"."oauth_client_redirect_uris"("client_id","redirect_uri") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "oauth_interactions" ADD CONSTRAINT "oauth_interactions_session_account_fk" FOREIGN KEY ("session_id","account_id") REFERENCES "public"."oauth_sessions"("id","account_id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "oauth_interactions" ADD CONSTRAINT "oauth_interactions_grant_binding_fk" FOREIGN KEY ("grant_id","account_id","client_id") REFERENCES "public"."oauth_grants"("id","account_id","client_id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "oauth_refresh_token_families" ADD CONSTRAINT "oauth_refresh_families_session_account_fk" FOREIGN KEY ("session_id","account_id") REFERENCES "public"."oauth_sessions"("id","account_id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "oauth_refresh_token_families" ADD CONSTRAINT "oauth_refresh_families_grant_binding_fk" FOREIGN KEY ("grant_id","account_id","client_id") REFERENCES "public"."oauth_grants"("id","account_id","client_id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "oauth_refresh_tokens" ADD CONSTRAINT "oauth_refresh_tokens_family_binding_fk" FOREIGN KEY ("family_id","account_id","client_id","session_id","grant_id") REFERENCES "public"."oauth_refresh_token_families"("id","account_id","client_id","session_id","grant_id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "oauth_refresh_tokens" ADD CONSTRAINT "oauth_refresh_tokens_replacement_fk" FOREIGN KEY ("family_id","replaced_by_generation") REFERENCES "public"."oauth_refresh_tokens"("family_id","generation") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "oauth_session_authorizations" ADD CONSTRAINT "oauth_session_authorizations_session_account_fk" FOREIGN KEY ("session_id","account_id") REFERENCES "public"."oauth_sessions"("id","account_id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "oauth_session_authorizations" ADD CONSTRAINT "oauth_session_authorizations_grant_binding_fk" FOREIGN KEY ("grant_id","account_id","client_id") REFERENCES "public"."oauth_grants"("id","account_id","client_id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "oauth_sessions" ADD CONSTRAINT "oauth_sessions_account_id_identity_accounts_id_fk" FOREIGN KEY ("account_id") REFERENCES "public"."identity_accounts"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
CREATE INDEX "oauth_authorization_codes_expiry_idx" ON "oauth_authorization_codes" USING btree ("expires_at");--> statement-breakpoint
CREATE INDEX "oauth_client_redirect_uris_client_idx" ON "oauth_client_redirect_uris" USING btree ("client_id");--> statement-breakpoint
CREATE INDEX "oauth_grants_account_idx" ON "oauth_grants" USING btree ("account_id");--> statement-breakpoint
CREATE INDEX "oauth_grants_client_idx" ON "oauth_grants" USING btree ("client_id");--> statement-breakpoint
CREATE UNIQUE INDEX "oauth_grants_active_account_client_uq" ON "oauth_grants" USING btree ("account_id","client_id") WHERE "oauth_grants"."revoked_at" IS NULL;--> statement-breakpoint
CREATE INDEX "oauth_interactions_expiry_idx" ON "oauth_interactions" USING btree ("expires_at");--> statement-breakpoint
CREATE INDEX "oauth_refresh_families_session_idx" ON "oauth_refresh_token_families" USING btree ("session_id");--> statement-breakpoint
CREATE INDEX "oauth_refresh_tokens_expiry_idx" ON "oauth_refresh_tokens" USING btree ("expires_at");--> statement-breakpoint
CREATE INDEX "oauth_sessions_account_idx" ON "oauth_sessions" USING btree ("account_id");--> statement-breakpoint
CREATE INDEX "oauth_sessions_expiry_idx" ON "oauth_sessions" USING btree ("expires_at");