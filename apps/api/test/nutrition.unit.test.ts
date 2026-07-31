import { describe, expect, it } from "vitest";

import type {
  FoodCompositionInput,
  MealItemInput,
  UpsertFoodOverlay
} from "@shape-of-you/contracts";

import {
  canAccessCatalogEntity,
  sumMealNutrition,
  validateFoodComposition,
  validateFoodOverlay
} from "../src/domain/nutrition.js";

const item = (
  caloriesKcal: number,
  proteinG: number,
  fatG: number,
  carbsG: number
): MealItemInput => ({
  foodVersionId: null,
  label: "Snapshot",
  quantity: 1,
  unit: "serving",
  nutrients: { caloriesKcal, proteinG, fatG, carbsG }
});

describe("Nutrition domain", () => {
  it("sums immutable Meal snapshots with contract precision", () => {
    expect(
      sumMealNutrition([
        item(100.111, 10.111, 4.111, 20.111),
        item(50.222, 5.222, 2.222, 10.222)
      ])
    ).toEqual({
      caloriesKcal: 150.333,
      proteinG: 15.333,
      fatG: 6.333,
      carbsG: 30.333
    });
  });

  it("rejects duplicate IngredientVersion references", () => {
    const composition: FoodCompositionInput[] = [
      {
        ingredientVersionId:
          "00000000-0000-4000-8000-000000000001",
        quantity: 100,
        unit: "g",
        preparation: null,
        required: true,
        note: null,
        confidence: null
      },
      {
        ingredientVersionId:
          "00000000-0000-4000-8000-000000000001",
        quantity: 50,
        unit: "g",
        preparation: null,
        required: true,
        note: null,
        confidence: null
      }
    ];

    expect(() => validateFoodComposition(composition)).toThrow(
      "cannot repeat"
    );
  });

  it("requires a complete preferred serving pair", () => {
    const overlay: UpsertFoodOverlay = {
      alias: null,
      favorite: false,
      hidden: false,
      preferredQuantity: 100,
      preferredUnit: null
    };

    expect(() => validateFoodOverlay(overlay)).toThrow(
      "must be supplied together"
    );
  });

  it("allows shared entries and isolates private entries by Person", () => {
    expect(canAccessCatalogEntity("shared", null, "person-a")).toBe(true);
    expect(
      canAccessCatalogEntity("private", "person-a", "person-a")
    ).toBe(true);
    expect(
      canAccessCatalogEntity("private", "person-a", "person-b")
    ).toBe(false);
  });
});
