import type {
  FoodCompositionInput,
  MealItemInput,
  NutrientValues,
  UpsertFoodOverlay
} from "@shape-of-you/contracts";

import { DomainValidationError } from "./errors.js";

function round(value: number): number {
  return Math.round((value + Number.EPSILON) * 1000) / 1000;
}

/**
 * Sums immutable nutrient snapshots without consulting mutable catalog state.
 *
 * @param items - Validated Meal item snapshots.
 * @returns Nutrient totals rounded to the public three-decimal contract.
 */
export function sumMealNutrition(
  items: readonly MealItemInput[]
): NutrientValues {
  return items.reduce<NutrientValues>(
    (total, item) => ({
      caloriesKcal: round(
        total.caloriesKcal + item.nutrients.caloriesKcal
      ),
      proteinG: round(total.proteinG + item.nutrients.proteinG),
      fatG: round(total.fatG + item.nutrients.fatG),
      carbsG: round(total.carbsG + item.nutrients.carbsG)
    }),
    { caloriesKcal: 0, proteinG: 0, fatG: 0, carbsG: 0 }
  );
}

/**
 * Validates that one ingredient revision appears at most once per FoodVersion.
 *
 * @param composition - Proposed immutable Food composition.
 * @throws DomainValidationError when a revision is duplicated.
 */
export function validateFoodComposition(
  composition: readonly FoodCompositionInput[]
): void {
  const ids = new Set<string>();
  for (const item of composition) {
    if (ids.has(item.ingredientVersionId)) {
      throw new DomainValidationError(
        "Food composition cannot repeat an IngredientVersion"
      );
    }
    ids.add(item.ingredientVersionId);
  }
}

/**
 * Validates the nullable preferred-serving pair used by a Person overlay.
 *
 * @param overlay - Validated transport input.
 * @throws DomainValidationError when quantity and unit are not both present.
 */
export function validateFoodOverlay(
  overlay: UpsertFoodOverlay
): void {
  if (
    (overlay.preferredQuantity === null) !==
    (overlay.preferredUnit === null)
  ) {
    throw new DomainValidationError(
      "preferredQuantity and preferredUnit must be supplied together"
    );
  }
}

/**
 * Tests whether a Person may use a shared or private catalog entity.
 *
 * @param visibility - Catalog visibility.
 * @param ownerPersonId - Owner for a private entity, otherwise null.
 * @param personId - Active Person.
 * @returns True for shared entities or private entities owned by the Person.
 */
export function canAccessCatalogEntity(
  visibility: "shared" | "private",
  ownerPersonId: string | null,
  personId: string
): boolean {
  return visibility === "shared" || ownerPersonId === personId;
}
