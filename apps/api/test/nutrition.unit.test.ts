import { Ajv } from "ajv";
import addFormats from "ajv-formats";
import { describe, expect, it } from "vitest";

import {
  MealItemInputSchema,
  type FoodCompositionInput,
  type MealItemInput,
  type UpsertFoodOverlay
} from "@shape-of-you/contracts";

import {
  canAccessCatalogEntity,
  sumMealNutrition,
  validateFoodComposition,
  validateFoodOverlay
} from "../src/domain/nutrition.js";

const item = (
  caloriesKcal: number | null,
  proteinG: number | null,
  fatG: number | null,
  carbsG: number | null
): MealItemInput => ({
  foodVersionId: null,
  label: "Snapshot",
  amountKind: "quantified",
  quantity: 1,
  unit: "serving",
  amountDescription: null,
  estimateMethod: null,
  amountConfidence: null,
  nutrients: { caloriesKcal, proteinG, fatG, carbsG }
});

const ajv = new Ajv({ allErrors: true, multipleOfPrecision: 6, strict: false });
const installFormats = addFormats as unknown as (instance: Ajv) => Ajv;
installFormats(ajv);
const validateMealItem = ajv.compile(MealItemInputSchema);

const amountItem = (overrides: Record<string, unknown>) => ({
  foodVersionId: null,
  label: "Чечевичный суп",
  amountKind: "unknown",
  quantity: null,
  unit: null,
  amountDescription: null,
  estimateMethod: null,
  amountConfidence: null,
  nutrients: {
    caloriesKcal: null,
    proteinG: null,
    fatG: null,
    carbsG: null
  },
  ...overrides
});

describe("Nutrition domain", () => {
  it("validates every Meal amount evidence shape", () => {
    const valid = [
      amountItem({}),
      amountItem({
        amountKind: "described",
        amountDescription: "большая тарелка"
      }),
      amountItem({
        amountKind: "quantified",
        quantity: 250,
        unit: "g"
      }),
      amountItem({
        amountKind: "estimated",
        quantity: 250,
        unit: "g",
        amountDescription: "примерно полтарелки",
        estimateMethod: "text",
        amountConfidence: 0.6
      }),
      amountItem({
        amountKind: "estimated",
        quantity: 220,
        unit: "g",
        estimateMethod: "photo",
        amountConfidence: 0.65
      })
    ];
    const invalid = [
      amountItem({ quantity: 1, unit: "serving" }),
      amountItem({ amountKind: "described" }),
      amountItem({
        amountKind: "described",
        amountDescription: "большая тарелка",
        quantity: 250,
        unit: "g"
      }),
      amountItem({ amountKind: "quantified", quantity: 250 }),
      amountItem({
        amountKind: "quantified",
        quantity: 250,
        unit: "g",
        estimateMethod: "text"
      }),
      amountItem({
        amountKind: "estimated",
        quantity: 250,
        unit: "g",
        amountConfidence: 0.6
      }),
      amountItem({
        amountKind: "estimated",
        quantity: 250,
        unit: "g",
        estimateMethod: "photo"
      })
    ];

    for (const candidate of valid) {
      expect(
        validateMealItem(candidate),
        JSON.stringify(validateMealItem.errors)
      ).toBe(true);
    }
    for (const candidate of invalid) {
      expect(validateMealItem(candidate)).toBe(false);
    }
  });

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

  it("preserves unknown nutrient totals instead of inventing zero", () => {
    expect(sumMealNutrition([
      item(100, 10, 4, 20),
      item(null, null, 2, 5)
    ])).toEqual({
      caloriesKcal: null,
      proteinG: null,
      fatG: 6,
      carbsG: 25
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
