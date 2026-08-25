import {
  PostgreSqlContainer,
  type StartedPostgreSqlContainer
} from "@testcontainers/postgresql";
import { Pool } from "pg";
import { afterAll, beforeAll, describe, expect, it } from "vitest";

import { runMigrations } from "../src/database/migrate.js";
import {
  FITNESS_TRACKER_SPREADSHEET_ID,
  type FitnessTrackerNutritionSnapshot
} from "../src/import/fitness-tracker-sheets-reader.js";
import { NutritionImportApplyService } from "../src/import/nutrition-import-apply.js";
import { PostgresNutritionTargetReader } from "../src/import/postgres-nutrition-target-reader.js";

let container: StartedPostgreSqlContainer;
let pool: Pool;
const sheetIds = {
  brands: 101,
  ingredients: 102,
  foods: 103,
  foodIngredients: 104,
  meals: 105,
  dailyLog: 106
};

beforeAll(async () => {
  process.env.PERSON_CONTEXT_MODE = "synthetic";
  process.env.SYNTHETIC_PERSON_ID = "00000000-0000-4000-8000-000000000001";
  container = await new PostgreSqlContainer("postgres:17-alpine")
    .withDatabase("shape_of_you_nutrition_import")
    .withUsername("shape_of_you")
    .withPassword("shape_of_you")
    .start();
  await runMigrations(container.getConnectionUri());
  pool = new Pool({ connectionString: container.getConnectionUri() });
}, 120_000);

afterAll(async () => {
  await pool?.end();
  await container?.stop();
});

describe("unified Fitness Tracker Nutrition apply", () => {
  it("creates one linked private graph and becomes unchanged on repeat", async () => {
    const personId = "00000000-0000-4000-8000-000000000049";
    await pool.query("insert into persons (id, kind) values ($1, 'synthetic')", [personId]);
    const service = new NutritionImportApplyService(
      pool,
      FITNESS_TRACKER_SPREADSHEET_ID,
      sheetIds
    );
    const source = snapshot();

    const first = await service.apply(personId, source);
    const second = await service.apply(personId, source);
    const state = await pool.query<{
      brands: string;
      ingredients: string;
      foods: string;
      compositions: string;
      meals: string;
      meal_items: string;
      closures: string;
      closure_source: string;
      audits: string;
      temporal_precision: string;
      occurred_at: Date | null;
    }>(
      `select
         (select count(*) from nutrition_brands where owner_person_id = $1)::text brands,
         (select count(*) from nutrition_ingredients where owner_person_id = $1)::text ingredients,
         (select count(*) from nutrition_foods where owner_person_id = $1)::text foods,
         (select count(*) from nutrition_food_version_ingredients c
           join nutrition_food_versions v on v.id = c.food_version_id
           join nutrition_foods f on f.id = v.food_id where f.owner_person_id = $1)::text compositions,
         (select count(*) from meals where person_id = $1)::text meals,
         (select count(*) from meal_items i join meals m on m.id = i.meal_id
           where m.person_id = $1)::text meal_items,
         (select count(*) from day_closures where person_id = $1 and status = 'active')::text closures,
         (select source::text from day_closures where person_id = $1 and status = 'active' limit 1) closure_source,
         ((select count(*) from nutrition_brand_import_records where person_id = $1) +
          (select count(*) from nutrition_ingredient_import_records where person_id = $1) +
          (select count(*) from nutrition_food_import_records where person_id = $1) +
          (select count(*) from nutrition_composition_import_records where person_id = $1) +
          (select count(*) from nutrition_meal_import_records where person_id = $1) +
          (select count(*) from nutrition_day_closure_import_records where person_id = $1))::text audits,
         m.temporal_precision, m.occurred_at
       from meals m where m.person_id = $1`,
      [personId]
    );
    const target = await new PostgresNutritionTargetReader(
      pool,
      FITNESS_TRACKER_SPREADSHEET_ID,
      sheetIds
    ).readTarget(personId);

    expect(first).toEqual(expect.objectContaining({
      status: "completed",
      counts: { created: 6, unchanged: 0, conflict: 0, invalid: 0 }
    }));
    expect(second).toEqual(expect.objectContaining({
      status: "completed",
      counts: { created: 0, unchanged: 6, conflict: 0, invalid: 0 }
    }));
    expect(state.rows[0]).toEqual({
      brands: "1",
      ingredients: "1",
      foods: "1",
      compositions: "1",
      meals: "1",
      meal_items: "1",
      closures: "1",
      closure_source: "google_sheets",
      audits: "12",
      temporal_precision: "local_date",
      occurred_at: null
    });
    expect(target).toHaveLength(6);
  });

  it("preserves photo evidence without blocking independent facts", async () => {
    const personId = "00000000-0000-4000-8000-000000000050";
    await pool.query("insert into persons (id, kind) values ($1, 'synthetic')", [personId]);
    const source = snapshot();
    const blocked: FitnessTrackerNutritionSnapshot = {
      ...source,
      manifestChecksum: "b".repeat(64),
      meals: {
        ...source.meals,
        rows: [{
          locator: "Meals!2",
          values: [45527, "Lunch", "Private meal", 500, 30, 20, 40, "photo", "", "food-1", "Medium", "11111111-1111-4111-8111-111111111111"]
        }]
      }
    };

    const report = await new NutritionImportApplyService(
      pool,
      FITNESS_TRACKER_SPREADSHEET_ID,
      sheetIds
    ).apply(personId, blocked);
    const facts = await pool.query<{ count: string }>(
      `select ((select count(*) from nutrition_brands where owner_person_id = $1) +
               (select count(*) from nutrition_ingredients where owner_person_id = $1) +
               (select count(*) from nutrition_foods where owner_person_id = $1) +
               (select count(*) from meals where person_id = $1))::text count`,
      [personId]
    );

    expect(report.status).toBe("completed");
    expect(report.counts.conflict).toBe(0);
    expect(facts.rows[0]?.count).toBe("4");
    const audit = await pool.query<{ source_photo_reference: string | null }>(
      "select source_photo_reference from nutrition_meal_import_records where person_id = $1",
      [personId]
    );
    expect(audit.rows[0]?.source_photo_reference).toBe("photo");
  });

  it("persists partial historical nutrients as null instead of zero", async () => {
    const personId = "00000000-0000-4000-8000-000000000051";
    await pool.query("insert into persons (id, kind) values ($1, 'synthetic')", [personId]);
    const source = snapshot();
    const partial: FitnessTrackerNutritionSnapshot = {
      ...source,
      manifestChecksum: "c".repeat(64),
      ingredients: {
        ...source.ingredients,
        rows: [{
          locator: "Ingredients!2",
          values: ["ingredient-1", "Ingredient", "Base", "шт", "", "", "", "", "manual", true]
        }]
      },
      foods: {
        ...source.foods,
        rows: [{
          locator: "Foods!2",
          values: ["food-1", "Food", "Meal", "Lunch", "250 г", 500, 30, 20, 40, "manual", "High", true, "brand-1"]
        }]
      },
      foodIngredients: {
        ...source.foodIngredients,
        rows: [["food-1", "ingredient-1", "", "часть порции", "", true, "", "High"]]
          .map((values) => ({ locator: "Food_Ingredients!2", values }))
      },
      meals: {
        ...source.meals,
        rows: [{
          locator: "Meals!2",
          values: [45527, "Lunch", "Private meal", "", "", "", "", "", "", "", "Medium", "11111111-1111-4111-8111-111111111111"]
        }]
      }
    };

    const report = await new NutritionImportApplyService(
      pool,
      FITNESS_TRACKER_SPREADSHEET_ID,
      sheetIds
    ).apply(personId, partial);
    const item = await pool.query<{
      calories_kcal: string | null;
      protein_g: string | null;
      fat_g: string | null;
      carbs_g: string | null;
    }>(
      "select calories_kcal, protein_g, fat_g, carbs_g from meal_items i join meals m on m.id = i.meal_id where m.person_id = $1",
      [personId]
    );
    const closure = await pool.query<{ completeness: string; incomplete_meals: string }>(
      `select snapshot #>> '{nutrition,totals,nutritionCompleteness}' completeness,
              snapshot #>> '{nutrition,totals,incompleteMealCount}' incomplete_meals
         from day_closures where person_id = $1 and status = 'active'`,
      [personId]
    );
    const evidence = await pool.query<{
      ingredient_unit: string | null;
      food_portion: string | null;
      composition_unit: string | null;
    }>(
      `select
         (select source_default_unit from nutrition_ingredient_import_records where person_id = $1) ingredient_unit,
         (select source_default_portion from nutrition_food_import_records where person_id = $1) food_portion,
         (select source_unit from nutrition_composition_import_records where person_id = $1) composition_unit`,
      [personId]
    );

    expect(report.status).toBe("completed");
    expect(item.rows[0]).toEqual({
      calories_kcal: null,
      protein_g: null,
      fat_g: null,
      carbs_g: null
    });
    expect(closure.rows[0]).toEqual({ completeness: "partial", incomplete_meals: "1" });
    expect(evidence.rows[0]).toEqual({
      ingredient_unit: "шт",
      food_portion: "250 г",
      composition_unit: "часть порции"
    });
  });
});

function snapshot(): FitnessTrackerNutritionSnapshot {
  return {
    spreadsheetId: FITNESS_TRACKER_SPREADSHEET_ID,
    locale: "ru_RU",
    timeZone: "Europe/Moscow",
    manifestChecksum: "a".repeat(64),
    brands: sheet(sheetIds.brands, "Brands", [
      "Brand_ID", "Name", "Type", "Notes", "Active", "Source"
    ], [["brand-1", "Brand", "Producer", "", true, "manual"]]),
    ingredients: sheet(sheetIds.ingredients, "Ingredients", [
      "Ingredient_ID", "Name", "Category", "Default_unit", "Calories_per_100g",
      "Protein_per_100g", "Fat_per_100g", "Carbs_per_100g", "Source", "Active"
    ], [["ingredient-1", "Ingredient", "Base", "г", 100, 10, 2, 12, "manual", true]]),
    foods: sheet(sheetIds.foods, "Foods", [
      "Food_ID", "Name", "Type", "Category", "Default_portion", "Calories",
      "Protein", "Fat", "Carbs", "Source", "Confidence", "Active", "Brand_ID"
    ], [["food-1", "Food", "Meal", "Lunch", 250, 500, 30, 20, 40, "manual", "High", true, "brand-1"]]),
    foodIngredients: sheet(sheetIds.foodIngredients, "Food_Ingredients", [
      "Food_ID", "Ingredient_ID", "Quantity", "Unit", "Preparation", "Required",
      "Notes", "Confidence"
    ], [["food-1", "ingredient-1", 250, "г", "", true, "", "High"]]),
    meals: sheet(sheetIds.meals, "Meals", [
      "Date", "Meal", "Description", "Calories", "Protein", "Fat", "Carbs",
      "Photo", "Notes", "Food_ID", "Confidence", "Meal_ID"
    ], [[45527, "Lunch", "Private meal", 500, 30, 20, 40, "", "", "food-1", "Medium", "11111111-1111-4111-8111-111111111111"]]),
    dailyLog: sheet(sheetIds.dailyLog, "Daily_Log", ["Date", "DayStatus"], [[45527, "Closed"]])
  };
}

function sheet(
  sheetId: number,
  title: string,
  headers: readonly string[],
  rows: readonly (readonly (string | number | boolean | null)[])[]
) {
  return {
    sheetId,
    title,
    headers,
    rows: rows.map((values, index) => ({ locator: `${title}!${index + 2}`, values }))
  };
}
