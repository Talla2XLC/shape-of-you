CREATE TABLE "nutrition_day_closure_import_records" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"batch_id" uuid NOT NULL,
	"person_id" uuid NOT NULL,
	"source_sheet_id" integer,
	"source_locator" varchar(128) NOT NULL,
	"source_record_id" varchar(512),
	"source_checksum" varchar(64),
	"outcome" "import_record_outcome" NOT NULL,
	"finding_code" varchar(64) NOT NULL,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	"normalized_local_date" date,
	"source_status" varchar(64),
	"target_closure_id" uuid,
	CONSTRAINT "nutrition_day_closure_import_record_uq" UNIQUE("batch_id","source_locator","finding_code")
);
--> statement-breakpoint
ALTER TABLE "nutrition_day_closure_import_records" ADD CONSTRAINT "nutrition_day_closure_import_batch_fk" FOREIGN KEY ("batch_id","person_id") REFERENCES "public"."import_batches"("id","person_id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "nutrition_day_closure_import_records" ADD CONSTRAINT "nutrition_day_closure_import_target_fk" FOREIGN KEY ("target_closure_id","person_id") REFERENCES "public"."day_closures"("id","person_id") ON DELETE no action ON UPDATE no action;