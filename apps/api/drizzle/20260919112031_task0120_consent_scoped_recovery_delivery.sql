ALTER TABLE "integration_inbox" DROP CONSTRAINT "integration_inbox_delivery_uq";--> statement-breakpoint
ALTER TABLE "integration_inbox" ADD COLUMN "consent_id" uuid;--> statement-breakpoint
ALTER TABLE "integration_recovery_facts" ADD COLUMN "confirmed_consent_id" uuid;--> statement-breakpoint
ALTER TABLE "integration_recovery_facts" ADD COLUMN "confirmed_delivery_id" uuid;--> statement-breakpoint
ALTER TABLE "integration_inbox" ADD CONSTRAINT "integration_inbox_consent_fk" FOREIGN KEY ("consent_id") REFERENCES "public"."recovery_consents"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "integration_recovery_facts" ADD CONSTRAINT "integration_recovery_fact_consent_fk" FOREIGN KEY ("confirmed_consent_id") REFERENCES "public"."recovery_consents"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "integration_recovery_facts" ADD CONSTRAINT "integration_recovery_fact_delivery_fk" FOREIGN KEY ("confirmed_delivery_id") REFERENCES "public"."integration_inbox"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
CREATE INDEX "integration_inbox_delivery_idx" ON "integration_inbox" USING btree ("connection_id","consent_id","kind","provider_identity","received_at");
