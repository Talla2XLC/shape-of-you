ALTER TABLE "nutrition_composition_import_records" ADD COLUMN "source_quantity" varchar(256);--> statement-breakpoint
ALTER TABLE "nutrition_composition_import_records" ADD COLUMN "source_unit" varchar(64);--> statement-breakpoint
ALTER TABLE "nutrition_food_import_records" ADD COLUMN "source_default_portion" varchar(256);--> statement-breakpoint
ALTER TABLE "nutrition_ingredient_import_records" ADD COLUMN "source_default_unit" varchar(64);