CREATE TABLE "external_activity_details" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"person_id" uuid NOT NULL,
	"connection_id" uuid NOT NULL,
	"consent_id" uuid NOT NULL,
	"lineage_root_activity_id" uuid NOT NULL,
	"source_activity_version" uuid NOT NULL,
	"file_checksum" varchar(64) NOT NULL,
	"normalization_version" varchar(64) NOT NULL,
	"payload" jsonb,
	"supersedes_id" uuid,
	"imported_at" timestamp with time zone DEFAULT now() NOT NULL,
	CONSTRAINT "activity_details_id_person_uq" UNIQUE("id","person_id"),
	CONSTRAINT "activity_details_checksum_shape" CHECK ("external_activity_details"."file_checksum" ~ '^[0-9a-f]{64}$')
);
--> statement-breakpoint
ALTER TABLE "external_activity_details" ADD CONSTRAINT "activity_details_person_fk" FOREIGN KEY ("person_id") REFERENCES "public"."persons"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "external_activity_details" ADD CONSTRAINT "activity_details_connection_fk" FOREIGN KEY ("connection_id") REFERENCES "public"."integration_connections"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "external_activity_details" ADD CONSTRAINT "activity_details_consent_fk" FOREIGN KEY ("consent_id") REFERENCES "public"."recovery_consents"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "external_activity_details" ADD CONSTRAINT "activity_details_root_person_fk" FOREIGN KEY ("lineage_root_activity_id","person_id") REFERENCES "public"."integration_activity_facts"("id","person_id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "external_activity_details" ADD CONSTRAINT "activity_details_source_person_fk" FOREIGN KEY ("source_activity_version","person_id") REFERENCES "public"."integration_activity_facts"("id","person_id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "external_activity_details" ADD CONSTRAINT "activity_details_successor_person_fk" FOREIGN KEY ("supersedes_id","person_id") REFERENCES "public"."external_activity_details"("id","person_id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
CREATE UNIQUE INDEX "activity_details_successor_uq" ON "external_activity_details" USING btree ("supersedes_id") WHERE "external_activity_details"."supersedes_id" IS NOT NULL;--> statement-breakpoint
CREATE INDEX "activity_details_root_consent_idx" ON "external_activity_details" USING btree ("lineage_root_activity_id","consent_id");