import { describe, expect, it } from "vitest";

import {
  FITNESS_TRACKER_SPREADSHEET_ID,
  type FitnessTrackerNutritionSnapshot
} from "../src/import/fitness-tracker-sheets-reader.js";
import {
  NutritionDryRunAdapter,
  nutritionBrandSemanticChecksum,
  nutritionDayClosureSemanticChecksum,
  nutritionMealSemanticChecksum,
  type NutritionImportTarget
} from "../src/import/nutrition-dry-run.js";

describe("unified Fitness Tracker Nutrition dry-run", () => {
  it("reconciles Nutrition facts and closed-day lifecycle as one domain", () => {
    const adapter = new NutritionDryRunAdapter();
    const source = snapshot();
    const created = adapter.classify(source, []);

    expect(created.safeReport.counts).toEqual({
      created: 6,
      unchanged: 0,
      conflict: 0,
      invalid: 0
    });
    expect(created.privateDetail.candidates.map(({ kind }) => kind).sort()).toEqual([
      "brand", "composition", "day_closure", "food", "ingredient", "meal"
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
      unchanged: 6,
      conflict: 0,
      invalid: 0
    });
    const safe = JSON.stringify(unchanged.safeReport);
    expect(safe).not.toContain("Private meal");
    expect(safe).not.toContain("2026-08-24");
    expect(safe).not.toContain("brand-1");
  });

  it("keeps catalog blockers local while accepting legacy kinds and photo evidence", () => {
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
    expect(result.safeReport.counts.conflict).toBe(0);
    expect(result.safeReport.findings.map(({ code }) => code)).toEqual(
      expect.arrayContaining([
        "invalid_ingredient_row",
        "invalid_catalog_dependency"
      ])
    );
    expect(result.safeReport.findings.map(({ code }) => code)).not.toContain("unsupported_photo_reference");
    expect(result.privateDetail.records).toEqual(expect.arrayContaining([
      expect.objectContaining({
        kind: "composition",
        outcome: "invalid",
        findingCode: "invalid_catalog_dependency",
        candidate: expect.objectContaining({ kind: "composition" })
      })
    ]));
    const meals = result.privateDetail.candidates.filter(({ kind }) => kind === "meal");
    expect(meals).toHaveLength(2);
    expect(meals[0]).toMatchObject({ mealKind: "other", sourceMealKind: "Lunch-Dinner" });
    expect(meals[1]).toMatchObject({ sourcePhotoReference: "photo" });
  });

  it("accepts missing historical nutrients as explicit unknown values", () => {
    const source = snapshot();
    const partial: FitnessTrackerNutritionSnapshot = {
      ...source,
      meals: {
        ...source.meals,
        rows: [{
          locator: "Meals!2",
          values: [45527, "Lunch", "Private meal", "", "", "", "", "", "", "", "Medium", "11111111-1111-4111-8111-111111111111"]
        }]
      }
    };

    const result = new NutritionDryRunAdapter().classify(partial, []);

    expect(result.safeReport.counts.created).toBe(6);
    expect(result.privateDetail.candidates.find(({ kind }) => kind === "meal")).toMatchObject({
      nutrients: { caloriesKcal: null, proteinG: null, fatG: null, carbsG: null }
    });
  });

  it("imports a complete Food as one source-defined serving", () => {
    const source = snapshot();
    const result = new NutritionDryRunAdapter().classify({
      ...source,
      foods: {
        ...source.foods,
        rows: [{
          locator: "Foods!2",
          values: ["food-1", "Food", "Meal", "Lunch", "source portion text", 500,
            30, 20, 40, "manual", "High", true, "brand-1"]
        }]
      }
    }, []);

    expect(result.privateDetail.candidates.find(({ kind }) => kind === "food"))
      .toMatchObject({
        sourceDefaultPortion: "source portion text",
        referenceQuantity: 1,
        referenceUnit: "serving"
      });
  });

  it("keeps an absent catalog dependency as conflict", () => {
    const source = snapshot();
    const result = new NutritionDryRunAdapter().classify({
      ...source,
      foodIngredients: {
        ...source.foodIngredients,
        rows: [{
          locator: "Food_Ingredients!2",
          values: ["missing-food", "ingredient-1", 250, "г", "", true, "", "High"]
        }]
      }
    }, []);

    expect(result.safeReport.findings).toEqual(expect.arrayContaining([
      expect.objectContaining({ outcome: "conflict", code: "unresolved_food_reference" })
    ]));
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

  it("accepts relationally equal Brands, Meals, and closed days despite raw changes", () => {
    const source = snapshot();
    const initial = new NutritionDryRunAdapter().classify(source, []);
    const projected = initial.privateDetail.candidates.map((candidate, index) => {
      const semanticChecksum = candidate.kind === "brand"
        ? nutritionBrandSemanticChecksum(candidate)
        : candidate.kind === "meal"
          ? nutritionMealSemanticChecksum(candidate)
          : candidate.kind === "day_closure"
            ? nutritionDayClosureSemanticChecksum(candidate.localDate)
            : null;
      return {
        id: `target-${index}`,
        kind: candidate.kind,
        sourceIdentity: candidate.sourceIdentity,
        checksum: `different-${index}`,
        semanticChecksum
      } satisfies NutritionImportTarget;
    });

    const result = new NutritionDryRunAdapter().classify(source, projected);
    const outcomes = new Map(result.privateDetail.records
      .filter(({ candidate }) => candidate !== null)
      .map(({ kind, outcome }) => [kind, outcome]));

    expect(outcomes.get("brand")).toBe("unchanged");
    expect(outcomes.get("meal")).toBe("unchanged");
    expect(outcomes.get("day_closure")).toBe("unchanged");
    expect(outcomes.get("ingredient")).toBe("conflict");
    expect(outcomes.get("food")).toBe("conflict");
    expect(outcomes.get("composition")).toBe("conflict");
  });

  it("does not treat missing semantic projections as equal", () => {
    const source = snapshot();
    const ingredient = new NutritionDryRunAdapter().classify(source, [])
      .privateDetail.candidates.find(({ kind }) => kind === "ingredient")!;
    const target: NutritionImportTarget[] = [{
      id: "ingredient-target",
      kind: "ingredient",
      sourceIdentity: ingredient.sourceIdentity,
      checksum: "different",
      semanticChecksum: null
    }];

    const result = new NutritionDryRunAdapter().classify({
      ...source,
      brands: { ...source.brands, rows: [] },
      foods: { ...source.foods, rows: [] },
      foodIngredients: { ...source.foodIngredients, rows: [] },
      meals: { ...source.meals, rows: [] },
      dailyLog: { ...source.dailyLog, rows: [] }
    }, target);

    expect(result.safeReport.counts).toEqual({
      created: 0,
      unchanged: 0,
      conflict: 1,
      invalid: 0
    });
    expect(result.safeReport.findings[0]?.code).toBe("target_mismatch");
  });

  it("blocks duplicate creation when a stable ID has drifted to another sheet identity", () => {
    const source = snapshot();
    const brand = new NutritionDryRunAdapter().classify(source, [])
      .privateDetail.candidates.find(({ kind }) => kind === "brand")!;
    if (brand.kind !== "brand") throw new Error("Brand fixture is missing");
    const target: NutritionImportTarget[] = [{
      id: "brand-with-wrong-sheet",
      kind: "brand",
      sourceIdentity: { ...brand.sourceIdentity, sheetId: source.foods.sheetId },
      checksum: brand.checksum,
      semanticChecksum: nutritionBrandSemanticChecksum(brand)
    }];

    const result = new NutritionDryRunAdapter().classify({
      ...source,
      ingredients: { ...source.ingredients, rows: [] },
      foods: { ...source.foods, rows: [] },
      foodIngredients: { ...source.foodIngredients, rows: [] },
      meals: { ...source.meals, rows: [] },
      dailyLog: { ...source.dailyLog, rows: [] }
    }, target);

    expect(result.safeReport.counts).toEqual({
      created: 0,
      unchanged: 0,
      conflict: 1,
      invalid: 0
    });
    expect(result.safeReport.findings[0]?.code).toBe("source_identity_mismatch");
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
    ], [[45527, "Lunch", "Private meal", 500, 30, 20, 40, "", "", "food-1", "Medium", "11111111-1111-4111-8111-111111111111"]]),
    dailyLog: sheet(106, "Daily_Log", ["Date", "DayStatus"], [[45527, "Closed"]])
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
