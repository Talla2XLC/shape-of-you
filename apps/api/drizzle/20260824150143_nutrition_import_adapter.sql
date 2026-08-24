CREATE TYPE "public"."meal_temporal_precision" AS ENUM('instant', 'local_date');--> statement-breakpoint
CREATE TABLE "nutrition_brand_import_records" (
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
	"normalized_name" varchar(256),
	"normalized_type" varchar(256),
	"normalized_note" text,
	"target_brand_id" uuid,
	CONSTRAINT "nutrition_brand_import_record_uq" UNIQUE("batch_id","source_locator","finding_code")
);
--> statement-breakpoint
CREATE TABLE "nutrition_composition_import_records" (
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
	"food_source_id" varchar(512),
	"ingredient_source_id" varchar(512),
	"normalized_quantity" numeric(12, 3),
	"normalized_unit" "nutrition_unit",
	"normalized_preparation" varchar(256),
	"normalized_required" boolean,
	"normalized_note" text,
	"normalized_confidence" numeric(4, 3),
	"target_composition_id" uuid,
	CONSTRAINT "nutrition_composition_import_record_uq" UNIQUE("batch_id","source_locator","finding_code")
);
--> statement-breakpoint
CREATE TABLE "nutrition_food_import_records" (
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
	"normalized_name" varchar(256),
	"normalized_type" varchar(256),
	"normalized_category" varchar(256),
	"reference_quantity" numeric(12, 3),
	"reference_unit" "nutrition_unit",
	"calories_kcal" numeric(12, 3),
	"protein_g" numeric(12, 3),
	"fat_g" numeric(12, 3),
	"carbs_g" numeric(12, 3),
	"brand_source_id" varchar(512),
	"target_food_id" uuid,
	CONSTRAINT "nutrition_food_import_record_uq" UNIQUE("batch_id","source_locator","finding_code")
);
--> statement-breakpoint
CREATE TABLE "nutrition_ingredient_import_records" (
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
	"normalized_name" varchar(256),
	"normalized_category" varchar(256),
	"reference_quantity" numeric(12, 3),
	"reference_unit" "nutrition_unit",
	"calories_kcal" numeric(12, 3),
	"protein_g" numeric(12, 3),
	"fat_g" numeric(12, 3),
	"carbs_g" numeric(12, 3),
	"target_ingredient_id" uuid,
	CONSTRAINT "nutrition_ingredient_import_record_uq" UNIQUE("batch_id","source_locator","finding_code")
);
--> statement-breakpoint
CREATE TABLE "nutrition_meal_import_records" (
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
	"normalized_kind" "meal_kind",
	"normalized_label" varchar(256),
	"normalized_description" text,
	"normalized_note" text,
	"calories_kcal" numeric(12, 3),
	"protein_g" numeric(12, 3),
	"fat_g" numeric(12, 3),
	"carbs_g" numeric(12, 3),
	"food_source_id" varchar(512),
	"normalized_confidence" numeric(4, 3),
	"target_meal_id" uuid,
	CONSTRAINT "nutrition_meal_import_record_uq" UNIQUE("batch_id","source_locator","finding_code")
);
--> statement-breakpoint
ALTER TABLE "meals" ALTER COLUMN "occurred_at" DROP NOT NULL;--> statement-breakpoint
ALTER TABLE "meals" ADD COLUMN "temporal_precision" "meal_temporal_precision" DEFAULT 'instant' NOT NULL;--> statement-breakpoint
ALTER TABLE "nutrition_food_version_ingredients" ADD COLUMN "source_record_id" uuid;--> statement-breakpoint
ALTER TABLE "nutrition_brand_import_records" ADD CONSTRAINT "nutrition_brand_import_batch_fk" FOREIGN KEY ("batch_id","person_id") REFERENCES "public"."import_batches"("id","person_id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "nutrition_brand_import_records" ADD CONSTRAINT "nutrition_brand_import_target_fk" FOREIGN KEY ("target_brand_id") REFERENCES "public"."nutrition_brands"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "nutrition_composition_import_records" ADD CONSTRAINT "nutrition_composition_import_batch_fk" FOREIGN KEY ("batch_id","person_id") REFERENCES "public"."import_batches"("id","person_id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "nutrition_composition_import_records" ADD CONSTRAINT "nutrition_composition_import_target_fk" FOREIGN KEY ("target_composition_id") REFERENCES "public"."nutrition_food_version_ingredients"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "nutrition_food_import_records" ADD CONSTRAINT "nutrition_food_import_batch_fk" FOREIGN KEY ("batch_id","person_id") REFERENCES "public"."import_batches"("id","person_id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "nutrition_food_import_records" ADD CONSTRAINT "nutrition_food_import_target_fk" FOREIGN KEY ("target_food_id") REFERENCES "public"."nutrition_foods"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "nutrition_ingredient_import_records" ADD CONSTRAINT "nutrition_ingredient_import_batch_fk" FOREIGN KEY ("batch_id","person_id") REFERENCES "public"."import_batches"("id","person_id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "nutrition_ingredient_import_records" ADD CONSTRAINT "nutrition_ingredient_import_target_fk" FOREIGN KEY ("target_ingredient_id") REFERENCES "public"."nutrition_ingredients"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "nutrition_meal_import_records" ADD CONSTRAINT "nutrition_meal_import_batch_fk" FOREIGN KEY ("batch_id","person_id") REFERENCES "public"."import_batches"("id","person_id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "nutrition_meal_import_records" ADD CONSTRAINT "nutrition_meal_import_target_fk" FOREIGN KEY ("target_meal_id","person_id") REFERENCES "public"."meals"("id","person_id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "nutrition_food_version_ingredients" ADD CONSTRAINT "nutrition_food_composition_source_fk" FOREIGN KEY ("source_record_id") REFERENCES "public"."nutrition_catalog_source_records"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "meals" ADD CONSTRAINT "meals_temporal_shape" CHECK (("meals"."temporal_precision" = 'instant' AND "meals"."occurred_at" IS NOT NULL) OR ("meals"."temporal_precision" = 'local_date' AND "meals"."occurred_at" IS NULL));