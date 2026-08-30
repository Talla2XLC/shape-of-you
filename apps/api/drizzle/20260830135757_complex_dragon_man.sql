CREATE TYPE "public"."meal_item_amount_kind" AS ENUM('unknown', 'described', 'quantified', 'estimated');--> statement-breakpoint
CREATE TYPE "public"."meal_item_estimate_method" AS ENUM('text', 'photo');--> statement-breakpoint
ALTER TABLE "meal_items" DROP CONSTRAINT "meal_items_positive_values";--> statement-breakpoint
ALTER TABLE "meal_items" ALTER COLUMN "quantity" DROP NOT NULL;--> statement-breakpoint
ALTER TABLE "meal_items" ALTER COLUMN "unit" DROP NOT NULL;--> statement-breakpoint
ALTER TABLE "meal_items" ADD COLUMN "amount_kind" "meal_item_amount_kind" DEFAULT 'quantified' NOT NULL;--> statement-breakpoint
ALTER TABLE "meal_items" ADD COLUMN "amount_description" varchar(256);--> statement-breakpoint
ALTER TABLE "meal_items" ADD COLUMN "estimate_method" "meal_item_estimate_method";--> statement-breakpoint
ALTER TABLE "meal_items" ADD COLUMN "amount_confidence" numeric(4, 3);--> statement-breakpoint
ALTER TABLE "meal_items" ALTER COLUMN "amount_kind" DROP DEFAULT;--> statement-breakpoint
ALTER TABLE "meal_items" ADD CONSTRAINT "meal_items_amount_evidence_shape" CHECK ((
            "meal_items"."amount_kind" = 'unknown'
            AND "meal_items"."quantity" IS NULL
            AND "meal_items"."unit" IS NULL
            AND "meal_items"."amount_description" IS NULL
            AND "meal_items"."estimate_method" IS NULL
            AND "meal_items"."amount_confidence" IS NULL
          ) OR (
            "meal_items"."amount_kind" = 'described'
            AND "meal_items"."quantity" IS NULL
            AND "meal_items"."unit" IS NULL
            AND "meal_items"."amount_description" IS NOT NULL
            AND "meal_items"."estimate_method" IS NULL
            AND "meal_items"."amount_confidence" IS NULL
          ) OR (
            "meal_items"."amount_kind" = 'quantified'
            AND "meal_items"."quantity" IS NOT NULL
            AND "meal_items"."unit" IS NOT NULL
            AND "meal_items"."estimate_method" IS NULL
            AND "meal_items"."amount_confidence" IS NULL
          ) OR (
            "meal_items"."amount_kind" = 'estimated'
            AND "meal_items"."quantity" IS NOT NULL
            AND "meal_items"."unit" IS NOT NULL
            AND "meal_items"."estimate_method" IS NOT NULL
            AND "meal_items"."amount_confidence" IS NOT NULL
            AND "meal_items"."amount_confidence" >= 0
            AND "meal_items"."amount_confidence" <= 1
          ));--> statement-breakpoint
ALTER TABLE "meal_items" ADD CONSTRAINT "meal_items_positive_values" CHECK ("meal_items"."position" > 0
          AND ("meal_items"."quantity" IS NULL OR "meal_items"."quantity" > 0)
          AND "meal_items"."calories_kcal" >= 0
          AND "meal_items"."protein_g" >= 0
          AND "meal_items"."fat_g" >= 0
          AND "meal_items"."carbs_g" >= 0);
