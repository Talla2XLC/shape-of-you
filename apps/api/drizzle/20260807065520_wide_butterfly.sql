CREATE TABLE "identity_subject_mappings" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"issuer" varchar(512) NOT NULL,
	"subject" varchar(512) NOT NULL,
	"user_id" uuid NOT NULL,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	CONSTRAINT "id_subj_map_iss_sub_uq" UNIQUE("issuer","subject"),
	CONSTRAINT "id_subj_map_user_iss_uq" UNIQUE("user_id","issuer"),
	CONSTRAINT "id_subj_map_issuer_nonempty" CHECK (length(btrim("identity_subject_mappings"."issuer")) > 0),
	CONSTRAINT "id_subj_map_subject_nonempty" CHECK (length(btrim("identity_subject_mappings"."subject")) > 0)
);
--> statement-breakpoint
ALTER TABLE "identity_subject_mappings" ADD CONSTRAINT "identity_subject_mappings_user_id_users_id_fk" FOREIGN KEY ("user_id") REFERENCES "public"."users"("id") ON DELETE no action ON UPDATE no action;