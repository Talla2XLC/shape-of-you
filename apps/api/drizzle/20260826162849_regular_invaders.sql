ALTER TYPE "public"."day_closure_reference_kind" ADD VALUE 'daily_context_note' BEFORE 'recovery_observation';--> statement-breakpoint
CREATE TABLE "daily_context_notes" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"person_id" uuid NOT NULL,
	"local_date" date NOT NULL,
	"timezone" varchar(64) NOT NULL,
	"text" text NOT NULL,
	"source" "source_channel" NOT NULL,
	"source_reference_id" uuid NOT NULL,
	"dedupe_key" varchar(256) NOT NULL,
	"confidence" numeric(4, 3),
	"supersedes_id" uuid,
	"correction_reason" varchar(512),
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	CONSTRAINT "daily_context_notes_id_person_uq" UNIQUE("id","person_id"),
	CONSTRAINT "daily_context_notes_text_nonempty" CHECK (length("daily_context_notes"."text") > 0),
	CONSTRAINT "daily_context_notes_confidence_range" CHECK ("daily_context_notes"."confidence" IS NULL OR ("daily_context_notes"."confidence" >= 0 AND "daily_context_notes"."confidence" <= 1)),
	CONSTRAINT "daily_context_notes_correction_shape" CHECK (("daily_context_notes"."supersedes_id" IS NULL AND "daily_context_notes"."correction_reason" IS NULL) OR ("daily_context_notes"."supersedes_id" IS NOT NULL AND "daily_context_notes"."correction_reason" IS NOT NULL)),
	CONSTRAINT "daily_context_notes_no_self_supersession" CHECK ("daily_context_notes"."supersedes_id" IS NULL OR "daily_context_notes"."supersedes_id" <> "daily_context_notes"."id")
);
--> statement-breakpoint
ALTER TABLE "daily_context_notes" ADD CONSTRAINT "daily_context_notes_person_id_persons_id_fk" FOREIGN KEY ("person_id") REFERENCES "public"."persons"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "daily_context_notes" ADD CONSTRAINT "daily_context_notes_source_person_fk" FOREIGN KEY ("source_reference_id","person_id") REFERENCES "public"."source_references"("id","person_id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "daily_context_notes" ADD CONSTRAINT "daily_context_notes_supersedes_person_fk" FOREIGN KEY ("supersedes_id","person_id") REFERENCES "public"."daily_context_notes"("id","person_id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
CREATE UNIQUE INDEX "daily_context_notes_person_source_dedupe_uq" ON "daily_context_notes" USING btree ("person_id","source","dedupe_key");--> statement-breakpoint
CREATE UNIQUE INDEX "daily_context_notes_supersedes_uq" ON "daily_context_notes" USING btree ("supersedes_id") WHERE "daily_context_notes"."supersedes_id" IS NOT NULL;--> statement-breakpoint
CREATE INDEX "daily_context_notes_person_date_idx" ON "daily_context_notes" USING btree ("person_id","local_date","created_at");