import { describe, expect, it } from "vitest";

import {
  FITNESS_TRACKER_SPREADSHEET_ID,
  type FitnessTrackerNutritionSnapshot
} from "../src/import/fitness-tracker-sheets-reader.js";
import {
  NutritionDryRunAdapter,
  type NutritionImportTarget
} from "../src/import/nutrition-dry-run.js";

describe("unified Fitness Tracker Nutrition dry-run", () => {
  it("reconciles the linked five-sheet graph as one domain", () => {
    const adapter = new NutritionDryRunAdapter();
    const source = snapshot();
    const created = adapter.classify(source, []);

    expect(created.safeReport.counts).toEqual({
      created: 5,
      unchanged: 0,
      conflict: 0,
      invalid: 0
    });
    expect(created.privateDetail.candidates.map(({ kind }) => kind).sort()).toEqual([
      "brand", "composition", "food", "ingredient", "meal"
    ]);
    const target: NutritionImportTarget[] = created.privateDetail.candidates.map(
      (candidate, index) => ({
        id: `target-${index}`,
        kind: candidate.kind,
        sourceIdentity: candidate.sourceIdentity,
        checksum: candidate.checksum
      })
    );
    const unchanged = adapter.classify(source, target);
    expect(unchanged.safeReport.counts).toEqual({
      created: 0,
      unchanged: 5,
      conflict: 0,
      invalid: 0
    });
    const safe = JSON.stringify(unchanged.safeReport);
    expect(safe).not.toContain("Private meal");
    expect(safe).not.toContain("2026-08-24");
    expect(safe).not.toContain("brand-1");
  });

  it("blocks missing catalog values, unsupported kinds and photo markers", () => {
    const source = snapshot();
    const broken: FitnessTrackerNutritionSnapshot = {
      ...source,
      ingredients: {
        ...source.ingredients,
        rows: [{
          locator: "Ingredients!2",
          values: ["ingredient-1", "Ingredient", "Base", "г", "", "", "", "", "manual", true]
        }]
      },
      meals: {
        ...source.meals,
        rows: [
          {
            locator: "Meals!2",
            values: [45527, "Lunch-Dinner", "Private meal", 500, 30, 20, 40, "", "", "food-1", "Medium", "11111111-1111-4111-8111-111111111111"]
          },
          {
            locator: "Meals!3",
            values: [45527, "Lunch", "Private meal", 500, 30, 20, 40, "photo", "", "", "Medium", "22222222-2222-4222-8222-222222222222"]
          }
        ]
      }
    };

    const result = new NutritionDryRunAdapter().classify(broken, []);

    expect(result.safeReport.counts.invalid).toBeGreaterThan(0);
    expect(result.safeReport.counts.conflict).toBeGreaterThan(0);
    expect(result.safeReport.findings.map(({ code }) => code)).toEqual(
      expect.arrayContaining([
        "invalid_ingredient_row",
        "invalid_meal_row",
        "unsupported_photo_reference",
        "unresolved_ingredient_reference"
      ])
    );
  });

  it("keeps invalid identities scoped to their exact sheet", () => {
    const source = snapshot();
    const broken: FitnessTrackerNutritionSnapshot = {
      ...source,
      ingredients: {
        ...source.ingredients,
        rows: [{
          locator: "Ingredients!2",
          values: ["food-1", "Ingredient", "Base", "г", "", "", "", "", "manual", true]
        }]
      }
    };
    const target: NutritionImportTarget[] = [{
      id: "existing-invalid-ingredient",
      kind: "ingredient",
      sourceIdentity: {
        spreadsheetId: FITNESS_TRACKER_SPREADSHEET_ID,
        sheetId: broken.ingredients.sheetId,
        sourceKey: "food-1"
      },
      checksum: "old-checksum"
    }];

    const result = new NutritionDryRunAdapter().classify(broken, target);
    const codes = result.safeReport.findings.map(({ code }) => code);

    expect(codes).toContain("invalid_ingredient_row");
    expect(codes).not.toContain("unresolved_food_reference");
    expect(codes).not.toContain("target_only");
  });
});

function snapshot(): FitnessTrackerNutritionSnapshot {
  return {
    spreadsheetId: FITNESS_TRACKER_SPREADSHEET_ID,
    locale: "ru_RU",
    timeZone: "Europe/Moscow",
    manifestChecksum: "nutrition-fixture-manifest",
    brands: sheet(101, "Brands", [
      "Brand_ID", "Name", "Type", "Notes", "Active", "Source"
    ], [["brand-1", "Brand", "Producer", "", true, "manual"]]),
    ingredients: sheet(102, "Ingredients", [
      "Ingredient_ID", "Name", "Category", "Default_unit", "Calories_per_100g",
      "Protein_per_100g", "Fat_per_100g", "Carbs_per_100g", "Source", "Active"
    ], [["ingredient-1", "Ingredient", "Base", "г", 100, 10, 2, 12, "manual", true]]),
    foods: sheet(103, "Foods", [
      "Food_ID", "Name", "Type", "Category", "Default_portion", "Calories",
      "Protein", "Fat", "Carbs", "Source", "Confidence", "Active", "Brand_ID"
    ], [["food-1", "Food", "Meal", "Lunch", 250, 500, 30, 20, 40, "manual", "High", true, "brand-1"]]),
    foodIngredients: sheet(104, "Food_Ingredients", [
      "Food_ID", "Ingredient_ID", "Quantity", "Unit", "Preparation", "Required",
      "Notes", "Confidence"
    ], [["food-1", "ingredient-1", 250, "г", "", true, "", "High"]]),
    meals: sheet(105, "Meals", [
      "Date", "Meal", "Description", "Calories", "Protein", "Fat", "Carbs",
      "Photo", "Notes", "Food_ID", "Confidence", "Meal_ID"
    ], [[45527, "Lunch", "Private meal", 500, 30, 20, 40, "", "", "food-1", "Medium", "11111111-1111-4111-8111-111111111111"]])
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
