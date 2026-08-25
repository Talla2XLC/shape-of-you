ALTER TABLE "meal_items" ALTER COLUMN "calories_kcal" DROP NOT NULL;--> statement-breakpoint
ALTER TABLE "meal_items" ALTER COLUMN "protein_g" DROP NOT NULL;--> statement-breakpoint
ALTER TABLE "meal_items" ALTER COLUMN "fat_g" DROP NOT NULL;--> statement-breakpoint
ALTER TABLE "meal_items" ALTER COLUMN "carbs_g" DROP NOT NULL;--> statement-breakpoint
ALTER TABLE "nutrition_meal_import_records" ADD COLUMN "source_kind" varchar(128);--> statement-breakpoint
ALTER TABLE "nutrition_meal_import_records" ADD COLUMN "source_photo_reference" text;