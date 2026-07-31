CREATE TYPE "public"."catalog_source_record_status" AS ENUM('staged', 'matched', 'rejected');--> statement-breakpoint
CREATE TYPE "public"."catalog_visibility" AS ENUM('shared', 'private');--> statement-breakpoint
CREATE TYPE "public"."meal_kind" AS ENUM('breakfast', 'lunch', 'dinner', 'snack', 'other');--> statement-breakpoint
CREATE TYPE "public"."nutrition_unit" AS ENUM('g', 'ml', 'serving', 'piece');--> statement-breakpoint
CREATE TABLE "meal_items" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"meal_id" uuid NOT NULL,
	"position" smallint NOT NULL,
	"food_version_id" uuid,
	"label" varchar(256) NOT NULL,
	"quantity" numeric(12, 3) NOT NULL,
	"unit" "nutrition_unit" NOT NULL,
	"calories_kcal" numeric(12, 3) NOT NULL,
	"protein_g" numeric(12, 3) NOT NULL,
	"fat_g" numeric(12, 3) NOT NULL,
	"carbs_g" numeric(12, 3) NOT NULL,
	CONSTRAINT "meal_items_meal_position_uq" UNIQUE("meal_id","position"),
	CONSTRAINT "meal_items_positive_values" CHECK ("meal_items"."position" > 0
          AND "meal_items"."quantity" > 0
          AND "meal_items"."calories_kcal" >= 0
          AND "meal_items"."protein_g" >= 0
          AND "meal_items"."fat_g" >= 0
          AND "meal_items"."carbs_g" >= 0)
);
--> statement-breakpoint
CREATE TABLE "meals" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"person_id" uuid NOT NULL,
	"occurred_at" timestamp with time zone NOT NULL,
	"local_date" date NOT NULL,
	"timezone" varchar(64) NOT NULL,
	"kind" "meal_kind" NOT NULL,
	"description" text,
	"note" text,
	"photo_media_id" uuid,
	"source" "source_channel" NOT NULL,
	"source_reference_id" uuid NOT NULL,
	"dedupe_key" varchar(256) NOT NULL,
	"confidence" numeric(4, 3),
	"supersedes_id" uuid,
	"correction_reason" varchar(512),
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	CONSTRAINT "meals_id_person_uq" UNIQUE("id","person_id"),
	CONSTRAINT "meals_confidence_range" CHECK ("meals"."confidence" IS NULL
          OR ("meals"."confidence" >= 0 AND "meals"."confidence" <= 1)),
	CONSTRAINT "meals_correction_shape" CHECK (("meals"."supersedes_id" IS NULL AND "meals"."correction_reason" IS NULL)
          OR ("meals"."supersedes_id" IS NOT NULL AND "meals"."correction_reason" IS NOT NULL)),
	CONSTRAINT "meals_no_self_supersession" CHECK ("meals"."supersedes_id" IS NULL OR "meals"."supersedes_id" <> "meals"."id")
);
--> statement-breakpoint
CREATE TABLE "nutrition_brand_versions" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"brand_id" uuid NOT NULL,
	"version" integer NOT NULL,
	"name" varchar(256) NOT NULL,
	"type" varchar(256),
	"note" text,
	"source_record_id" uuid,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	CONSTRAINT "nutrition_brand_versions_brand_version_uq" UNIQUE("brand_id","version"),
	CONSTRAINT "nutrition_brand_versions_id_brand_uq" UNIQUE("id","brand_id"),
	CONSTRAINT "nutrition_brand_versions_version_positive" CHECK ("nutrition_brand_versions"."version" > 0)
);
--> statement-breakpoint
CREATE TABLE "nutrition_brands" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"visibility" "catalog_visibility" NOT NULL,
	"owner_person_id" uuid,
	"current_version_id" uuid,
	"lock_version" integer DEFAULT 0 NOT NULL,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	CONSTRAINT "nutrition_brands_visibility_owner" CHECK (("nutrition_brands"."visibility" = 'shared' AND "nutrition_brands"."owner_person_id" IS NULL)
          OR ("nutrition_brands"."visibility" = 'private' AND "nutrition_brands"."owner_person_id" IS NOT NULL))
);
--> statement-breakpoint
CREATE TABLE "nutrition_catalog_source_records" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"source_id" uuid NOT NULL,
	"external_record_id" varchar(512) NOT NULL,
	"fetched_at" timestamp with time zone NOT NULL,
	"checksum" varchar(128) NOT NULL,
	"parser_version" varchar(128) NOT NULL,
	"status" "catalog_source_record_status" DEFAULT 'staged' NOT NULL,
	"raw_snapshot" jsonb,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	CONSTRAINT "nutrition_source_records_source_external_uq" UNIQUE("source_id","external_record_id")
);
--> statement-breakpoint
CREATE TABLE "nutrition_catalog_sources" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"key" varchar(128) NOT NULL,
	"name" varchar(256) NOT NULL,
	"license_name" varchar(256),
	"terms_url" text,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	CONSTRAINT "nutrition_catalog_sources_key_uq" UNIQUE("key")
);
--> statement-breakpoint
CREATE TABLE "nutrition_food_overlays" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"person_id" uuid NOT NULL,
	"food_id" uuid NOT NULL,
	"alias" varchar(256),
	"favorite" boolean DEFAULT false NOT NULL,
	"hidden" boolean DEFAULT false NOT NULL,
	"preferred_quantity" numeric(12, 3),
	"preferred_unit" "nutrition_unit",
	"updated_at" timestamp with time zone DEFAULT now() NOT NULL,
	CONSTRAINT "nutrition_food_overlays_person_food_uq" UNIQUE("person_id","food_id"),
	CONSTRAINT "nutrition_food_overlays_preferred_shape" CHECK (("nutrition_food_overlays"."preferred_quantity" IS NULL AND "nutrition_food_overlays"."preferred_unit" IS NULL)
          OR ("nutrition_food_overlays"."preferred_quantity" > 0 AND "nutrition_food_overlays"."preferred_unit" IS NOT NULL))
);
--> statement-breakpoint
CREATE TABLE "nutrition_food_version_ingredients" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"food_version_id" uuid NOT NULL,
	"position" smallint NOT NULL,
	"ingredient_version_id" uuid NOT NULL,
	"quantity" numeric(12, 3) NOT NULL,
	"unit" "nutrition_unit" NOT NULL,
	"preparation" varchar(256),
	"required" boolean DEFAULT true NOT NULL,
	"note" text,
	"confidence" numeric(4, 3),
	CONSTRAINT "nutrition_food_composition_position_uq" UNIQUE("food_version_id","position"),
	CONSTRAINT "nutrition_food_composition_ingredient_uq" UNIQUE("food_version_id","ingredient_version_id"),
	CONSTRAINT "nutrition_food_composition_values" CHECK ("nutrition_food_version_ingredients"."position" > 0
          AND "nutrition_food_version_ingredients"."quantity" > 0
          AND ("nutrition_food_version_ingredients"."confidence" IS NULL
               OR ("nutrition_food_version_ingredients"."confidence" >= 0 AND "nutrition_food_version_ingredients"."confidence" <= 1)))
);
--> statement-breakpoint
CREATE TABLE "nutrition_food_versions" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"food_id" uuid NOT NULL,
	"version" integer NOT NULL,
	"name" varchar(256) NOT NULL,
	"type" varchar(256),
	"category" varchar(256),
	"reference_quantity" numeric(12, 3) NOT NULL,
	"reference_unit" "nutrition_unit" NOT NULL,
	"calories_kcal" numeric(12, 3) NOT NULL,
	"protein_g" numeric(12, 3) NOT NULL,
	"fat_g" numeric(12, 3) NOT NULL,
	"carbs_g" numeric(12, 3) NOT NULL,
	"brand_version_id" uuid,
	"source_record_id" uuid,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	CONSTRAINT "nutrition_food_versions_food_version_uq" UNIQUE("food_id","version"),
	CONSTRAINT "nutrition_food_versions_id_food_uq" UNIQUE("id","food_id"),
	CONSTRAINT "nutrition_food_versions_positive_values" CHECK ("nutrition_food_versions"."version" > 0
          AND "nutrition_food_versions"."reference_quantity" > 0
          AND "nutrition_food_versions"."calories_kcal" >= 0
          AND "nutrition_food_versions"."protein_g" >= 0
          AND "nutrition_food_versions"."fat_g" >= 0
          AND "nutrition_food_versions"."carbs_g" >= 0)
);
--> statement-breakpoint
CREATE TABLE "nutrition_foods" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"visibility" "catalog_visibility" NOT NULL,
	"owner_person_id" uuid,
	"current_version_id" uuid,
	"lock_version" integer DEFAULT 0 NOT NULL,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	CONSTRAINT "nutrition_foods_visibility_owner" CHECK (("nutrition_foods"."visibility" = 'shared' AND "nutrition_foods"."owner_person_id" IS NULL)
          OR ("nutrition_foods"."visibility" = 'private' AND "nutrition_foods"."owner_person_id" IS NOT NULL))
);
--> statement-breakpoint
CREATE TABLE "nutrition_ingredient_versions" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"ingredient_id" uuid NOT NULL,
	"version" integer NOT NULL,
	"name" varchar(256) NOT NULL,
	"category" varchar(256),
	"reference_quantity" numeric(12, 3) NOT NULL,
	"reference_unit" "nutrition_unit" NOT NULL,
	"calories_kcal" numeric(12, 3) NOT NULL,
	"protein_g" numeric(12, 3) NOT NULL,
	"fat_g" numeric(12, 3) NOT NULL,
	"carbs_g" numeric(12, 3) NOT NULL,
	"source_record_id" uuid,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	CONSTRAINT "nutrition_ingredient_versions_item_version_uq" UNIQUE("ingredient_id","version"),
	CONSTRAINT "nutrition_ingredient_versions_id_item_uq" UNIQUE("id","ingredient_id"),
	CONSTRAINT "nutrition_ingredient_versions_positive_values" CHECK ("nutrition_ingredient_versions"."version" > 0
          AND "nutrition_ingredient_versions"."reference_quantity" > 0
          AND "nutrition_ingredient_versions"."calories_kcal" >= 0
          AND "nutrition_ingredient_versions"."protein_g" >= 0
          AND "nutrition_ingredient_versions"."fat_g" >= 0
          AND "nutrition_ingredient_versions"."carbs_g" >= 0)
);
--> statement-breakpoint
CREATE TABLE "nutrition_ingredients" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"visibility" "catalog_visibility" NOT NULL,
	"owner_person_id" uuid,
	"current_version_id" uuid,
	"lock_version" integer DEFAULT 0 NOT NULL,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	CONSTRAINT "nutrition_ingredients_visibility_owner" CHECK (("nutrition_ingredients"."visibility" = 'shared' AND "nutrition_ingredients"."owner_person_id" IS NULL)
          OR ("nutrition_ingredients"."visibility" = 'private' AND "nutrition_ingredients"."owner_person_id" IS NOT NULL))
);
--> statement-breakpoint
ALTER TABLE "meal_items" ADD CONSTRAINT "meal_item_meal_fk" FOREIGN KEY ("meal_id") REFERENCES "public"."meals"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "meal_items" ADD CONSTRAINT "meal_item_food_version_fk" FOREIGN KEY ("food_version_id") REFERENCES "public"."nutrition_food_versions"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "meals" ADD CONSTRAINT "meals_person_id_persons_id_fk" FOREIGN KEY ("person_id") REFERENCES "public"."persons"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "meals" ADD CONSTRAINT "meals_supersedes_same_person_fk" FOREIGN KEY ("supersedes_id","person_id") REFERENCES "public"."meals"("id","person_id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "meals" ADD CONSTRAINT "meals_source_reference_same_person_fk" FOREIGN KEY ("source_reference_id","person_id") REFERENCES "public"."source_references"("id","person_id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "nutrition_brand_versions" ADD CONSTRAINT "nutrition_brand_version_brand_fk" FOREIGN KEY ("brand_id") REFERENCES "public"."nutrition_brands"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "nutrition_brand_versions" ADD CONSTRAINT "nutrition_brand_version_source_fk" FOREIGN KEY ("source_record_id") REFERENCES "public"."nutrition_catalog_source_records"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "nutrition_brands" ADD CONSTRAINT "nutrition_brand_owner_fk" FOREIGN KEY ("owner_person_id") REFERENCES "public"."persons"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "nutrition_brands" ADD CONSTRAINT "nutrition_brand_current_version_fk" FOREIGN KEY ("current_version_id","id") REFERENCES "public"."nutrition_brand_versions"("id","brand_id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "nutrition_catalog_source_records" ADD CONSTRAINT "nutrition_source_record_source_fk" FOREIGN KEY ("source_id") REFERENCES "public"."nutrition_catalog_sources"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "nutrition_food_overlays" ADD CONSTRAINT "nutrition_food_overlay_person_fk" FOREIGN KEY ("person_id") REFERENCES "public"."persons"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "nutrition_food_overlays" ADD CONSTRAINT "nutrition_food_overlay_food_fk" FOREIGN KEY ("food_id") REFERENCES "public"."nutrition_foods"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "nutrition_food_version_ingredients" ADD CONSTRAINT "nutrition_food_composition_food_fk" FOREIGN KEY ("food_version_id") REFERENCES "public"."nutrition_food_versions"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "nutrition_food_version_ingredients" ADD CONSTRAINT "nutrition_food_composition_ingredient_fk" FOREIGN KEY ("ingredient_version_id") REFERENCES "public"."nutrition_ingredient_versions"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "nutrition_food_versions" ADD CONSTRAINT "nutrition_food_version_food_fk" FOREIGN KEY ("food_id") REFERENCES "public"."nutrition_foods"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "nutrition_food_versions" ADD CONSTRAINT "nutrition_food_version_brand_fk" FOREIGN KEY ("brand_version_id") REFERENCES "public"."nutrition_brand_versions"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "nutrition_food_versions" ADD CONSTRAINT "nutrition_food_version_source_fk" FOREIGN KEY ("source_record_id") REFERENCES "public"."nutrition_catalog_source_records"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "nutrition_foods" ADD CONSTRAINT "nutrition_food_owner_fk" FOREIGN KEY ("owner_person_id") REFERENCES "public"."persons"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "nutrition_foods" ADD CONSTRAINT "nutrition_food_current_version_fk" FOREIGN KEY ("current_version_id","id") REFERENCES "public"."nutrition_food_versions"("id","food_id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "nutrition_ingredient_versions" ADD CONSTRAINT "nutrition_ingredient_version_item_fk" FOREIGN KEY ("ingredient_id") REFERENCES "public"."nutrition_ingredients"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "nutrition_ingredient_versions" ADD CONSTRAINT "nutrition_ingredient_version_source_fk" FOREIGN KEY ("source_record_id") REFERENCES "public"."nutrition_catalog_source_records"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "nutrition_ingredients" ADD CONSTRAINT "nutrition_ingredient_owner_fk" FOREIGN KEY ("owner_person_id") REFERENCES "public"."persons"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "nutrition_ingredients" ADD CONSTRAINT "nutrition_ingredient_current_version_fk" FOREIGN KEY ("current_version_id","id") REFERENCES "public"."nutrition_ingredient_versions"("id","ingredient_id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
CREATE UNIQUE INDEX "meals_person_source_dedupe_uq" ON "meals" USING btree ("person_id","source","dedupe_key");--> statement-breakpoint
CREATE UNIQUE INDEX "meals_supersedes_uq" ON "meals" USING btree ("supersedes_id") WHERE "meals"."supersedes_id" IS NOT NULL;