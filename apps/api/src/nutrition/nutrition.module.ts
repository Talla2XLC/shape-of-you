import { Module } from "@nestjs/common";

import { MealController } from "./meal.controller.js";
import { NutritionCatalogController } from "./nutrition-catalog.controller.js";
import { NutritionService } from "./nutrition.service.js";

/** Encapsulates Nutrition catalog, Meal facts, and read projections. */
@Module({
  controllers: [NutritionCatalogController, MealController],
  providers: [NutritionService],
  exports: [NutritionService]
})
export class NutritionModule {}
