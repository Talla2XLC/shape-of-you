import {
  and,
  desc,
  eq,
  gte,
  inArray,
  isNull,
  lt,
  lte,
  notExists,
  or,
  sql
} from "drizzle-orm";
import { alias } from "drizzle-orm/pg-core";

import type {
  Brand,
  CorrectMeal,
  CreateBrand,
  CreateBrandVersion,
  CreateFood,
  CreateFoodVersion,
  CreateIngredient,
  CreateIngredientVersion,
  CreateMeal,
  DailyNutritionTotals,
  Food,
  FoodOverlay,
  Ingredient,
  Meal,
  MealHistory,
  MealList,
  NutrientValues,
  UpsertFoodOverlay
} from "@shape-of-you/contracts";

import type { DatabaseContext } from "../database/context.js";
import {
  mealItems,
  meals,
  nutritionBrands,
  nutritionBrandVersions,
  nutritionFoodOverlays,
  nutritionFoods,
  nutritionFoodVersionIngredients,
  nutritionFoodVersions,
  nutritionIngredients,
  nutritionIngredientVersions,
  sourceReferences,
  type MealItemRow,
  type MealRow,
  type NutritionBrandRow,
  type NutritionBrandVersionRow,
  type NutritionFoodCompositionRow,
  type NutritionFoodOverlayRow,
  type NutritionFoodRow,
  type NutritionFoodVersionRow,
  type NutritionIngredientRow,
  type NutritionIngredientVersionRow,
  type SourceReferenceRow
} from "../database/schema.js";
import {
  decodeMealCursor,
  encodeMealCursor
} from "../domain/cursor.js";
import {
  canAccessCatalogEntity,
  sumMealNutrition,
  validateFoodComposition,
  validateFoodOverlay
} from "../domain/nutrition.js";
import { deriveLocalDate } from "../domain/weight-measurement.js";
import {
  ConflictError,
  NotFoundError
} from "../domain/errors.js";
import { toSourceReference } from "../domain/source-reference.js";
import {
  discardUnusedSourceReference,
  ensureSourceReference,
  type DatabaseTransaction
} from "./source-reference-repository.js";

/** Result of an idempotent create or correction operation. */
export interface CreateMealResult {
  /** Whether this call inserted a new immutable fact. */
  readonly created: boolean;
  /** Inserted or existing Meal for the dedupe key. */
  readonly meal: Meal;
}

/** Persistence contract for the Nutrition catalog and Meal facts. */
export interface NutritionStore {
  createBrand(personId: string, input: CreateBrand): Promise<Brand>;
  appendBrandVersion(
    personId: string,
    id: string,
    input: CreateBrandVersion
  ): Promise<Brand>;
  findBrand(personId: string, id: string): Promise<Brand | null>;
  createIngredient(
    personId: string,
    input: CreateIngredient
  ): Promise<Ingredient>;
  appendIngredientVersion(
    personId: string,
    id: string,
    input: CreateIngredientVersion
  ): Promise<Ingredient>;
  findIngredient(
    personId: string,
    id: string
  ): Promise<Ingredient | null>;
  createFood(personId: string, input: CreateFood): Promise<Food>;
  appendFoodVersion(
    personId: string,
    id: string,
    input: CreateFoodVersion
  ): Promise<Food>;
  findFood(personId: string, id: string): Promise<Food | null>;
  upsertFoodOverlay(
    personId: string,
    foodId: string,
    input: UpsertFoodOverlay
  ): Promise<FoodOverlay>;
  createMeal(
    personId: string,
    input: CreateMeal
  ): Promise<CreateMealResult>;
  correctMeal(
    personId: string,
    id: string,
    input: CorrectMeal
  ): Promise<CreateMealResult>;
  findMeal(personId: string, id: string): Promise<Meal | null>;
  listMeals(
    personId: string,
    limit: number,
    cursor?: string,
    localDate?: string
  ): Promise<MealList>;
  /** Reads every current meal for one exact Person-local calendar date. */
  listMealsForLocalDate(personId: string, localDate: string): Promise<readonly Meal[]>;
  listMealsForLocalDateRange(personId: string, from: string, to: string): Promise<readonly Meal[]>;
  mealHistory(
    personId: string,
    id: string
  ): Promise<MealHistory | null>;
  dailyTotals(
    personId: string,
    localDate: string
  ): Promise<DailyNutritionTotals>;
}

function catalogOwner(
  personId: string,
  visibility: "shared" | "private"
): string | null {
  return visibility === "private" ? personId : null;
}

function nutrientsFromRow(row: {
  readonly caloriesKcal: string;
  readonly proteinG: string;
  readonly fatG: string;
  readonly carbsG: string;
}): NutrientValues {
  return {
    caloriesKcal: Number(row.caloriesKcal),
    proteinG: Number(row.proteinG),
    fatG: Number(row.fatG),
    carbsG: Number(row.carbsG)
  };
}

function nutrientsToRow(nutrients: NutrientValues): {
  readonly caloriesKcal: string;
  readonly proteinG: string;
  readonly fatG: string;
  readonly carbsG: string;
} {
  return {
    caloriesKcal: nutrients.caloriesKcal.toFixed(3),
    proteinG: nutrients.proteinG.toFixed(3),
    fatG: nutrients.fatG.toFixed(3),
    carbsG: nutrients.carbsG.toFixed(3)
  };
}

function serializeBrand(
  brand: NutritionBrandRow,
  version: NutritionBrandVersionRow
): Brand {
  return {
    id: brand.id,
    visibility: brand.visibility,
    ownerPersonId: brand.ownerPersonId,
    lockVersion: brand.lockVersion,
    createdAt: brand.createdAt.toISOString(),
    currentVersion: {
      id: version.id,
      version: version.version,
      name: version.name,
      type: version.type,
      note: version.note,
      createdAt: version.createdAt.toISOString()
    }
  };
}

function serializeIngredient(
  ingredient: NutritionIngredientRow,
  version: NutritionIngredientVersionRow
): Ingredient {
  return {
    id: ingredient.id,
    visibility: ingredient.visibility,
    ownerPersonId: ingredient.ownerPersonId,
    lockVersion: ingredient.lockVersion,
    createdAt: ingredient.createdAt.toISOString(),
    currentVersion: {
      id: version.id,
      version: version.version,
      name: version.name,
      category: version.category,
      referenceQuantity: Number(version.referenceQuantity),
      referenceUnit: version.referenceUnit,
      nutrients: nutrientsFromRow(version),
      createdAt: version.createdAt.toISOString()
    }
  };
}

function serializeFood(
  food: NutritionFoodRow,
  version: NutritionFoodVersionRow,
  composition: readonly NutritionFoodCompositionRow[]
): Food {
  return {
    id: food.id,
    visibility: food.visibility,
    ownerPersonId: food.ownerPersonId,
    lockVersion: food.lockVersion,
    createdAt: food.createdAt.toISOString(),
    currentVersion: {
      id: version.id,
      version: version.version,
      name: version.name,
      type: version.type,
      category: version.category,
      referenceQuantity: Number(version.referenceQuantity),
      referenceUnit: version.referenceUnit,
      nutrients: nutrientsFromRow(version),
      brandVersionId: version.brandVersionId,
      composition: composition.map((item) => ({
        ingredientVersionId: item.ingredientVersionId,
        quantity: Number(item.quantity),
        unit: item.unit,
        preparation: item.preparation,
        required: item.required,
        note: item.note,
        confidence:
          item.confidence === null ? null : Number(item.confidence)
      })),
      createdAt: version.createdAt.toISOString()
    }
  };
}

function serializeOverlay(row: NutritionFoodOverlayRow): FoodOverlay {
  return {
    personId: row.personId,
    foodId: row.foodId,
    alias: row.alias,
    favorite: row.favorite,
    hidden: row.hidden,
    preferredQuantity:
      row.preferredQuantity === null
        ? null
        : Number(row.preferredQuantity),
    preferredUnit: row.preferredUnit,
    updatedAt: row.updatedAt.toISOString()
  };
}

function serializeMeal(
  meal: MealRow,
  items: readonly MealItemRow[],
  sourceReference: SourceReferenceRow
): Meal {
  const publicItems = items.map((item) => ({
    position: item.position,
    foodVersionId: item.foodVersionId,
    label: item.label,
    quantity: Number(item.quantity),
    unit: item.unit,
    nutrients: nutrientsFromRow(item)
  }));
  return {
    id: meal.id,
    personId: meal.personId,
    occurredAt: meal.occurredAt?.toISOString() ?? null,
    temporalPrecision: meal.temporalPrecision,
    localDate: meal.localDate,
    timezone: meal.timezone,
    kind: meal.kind,
    description: meal.description,
    note: meal.note,
    photoMediaId: meal.photoMediaId,
    items: publicItems,
    totals: sumMealNutrition(publicItems),
    sourceReference: toSourceReference(sourceReference),
    dedupeKey: meal.dedupeKey,
    confidence:
      meal.confidence === null ? null : Number(meal.confidence),
    supersedesId: meal.supersedesId,
    correctionReason: meal.correctionReason,
    createdAt: meal.createdAt.toISOString()
  };
}

/** PostgreSQL implementation of the typed Nutrition persistence boundary. */
export class NutritionRepository implements NutritionStore {
  public constructor(private readonly database: DatabaseContext) {}

  private accessible(
    visibility: "shared" | "private",
    ownerPersonId: string | null,
    personId: string
  ): boolean {
    return canAccessCatalogEntity(
      visibility,
      ownerPersonId,
      personId
    );
  }

  private async readBrand(
    transaction: DatabaseTransaction,
    personId: string,
    id: string
  ): Promise<Brand | null> {
    const rows = await transaction
      .select({
        brand: nutritionBrands,
        version: nutritionBrandVersions
      })
      .from(nutritionBrands)
      .innerJoin(
        nutritionBrandVersions,
        eq(
          nutritionBrands.currentVersionId,
          nutritionBrandVersions.id
        )
      )
      .where(eq(nutritionBrands.id, id))
      .limit(1);
    const row = rows[0];
    return row &&
      this.accessible(
        row.brand.visibility,
        row.brand.ownerPersonId,
        personId
      )
      ? serializeBrand(row.brand, row.version)
      : null;
  }

  public createBrand(
    personId: string,
    input: CreateBrand
  ): Promise<Brand> {
    return this.database.db.transaction(async (transaction) => {
      const roots = await transaction
        .insert(nutritionBrands)
        .values({
          visibility: input.visibility,
          ownerPersonId: catalogOwner(personId, input.visibility)
        })
        .returning();
      const root = roots[0];
      if (!root) {
        throw new Error("Brand insert failed");
      }
      const versions = await transaction
        .insert(nutritionBrandVersions)
        .values({
          brandId: root.id,
          version: 1,
          name: input.name,
          type: input.type ?? null,
          note: input.note ?? null
        })
        .returning();
      const version = versions[0];
      if (!version) {
        throw new Error("BrandVersion insert failed");
      }
      const updated = await transaction
        .update(nutritionBrands)
        .set({ currentVersionId: version.id, lockVersion: 1 })
        .where(eq(nutritionBrands.id, root.id))
        .returning();
      return serializeBrand(updated[0] ?? root, version);
    });
  }

  public appendBrandVersion(
    personId: string,
    id: string,
    input: CreateBrandVersion
  ): Promise<Brand> {
    return this.database.db.transaction(async (transaction) => {
      await transaction.execute(
        sql`select id from ${nutritionBrands}
            where ${nutritionBrands.id} = ${id} for update`
      );
      const root = await transaction.query.nutritionBrands.findFirst({
        where: eq(nutritionBrands.id, id)
      });
      if (
        !root ||
        !this.accessible(root.visibility, root.ownerPersonId, personId)
      ) {
        throw new NotFoundError("Brand was not found");
      }
      if (root.lockVersion !== input.expectedLockVersion) {
        throw new ConflictError("Brand lock version is stale");
      }
      const versions = await transaction
        .insert(nutritionBrandVersions)
        .values({
          brandId: id,
          version: root.lockVersion + 1,
          name: input.name,
          type: input.type ?? null,
          note: input.note ?? null
        })
        .returning();
      const version = versions[0];
      if (!version) {
        throw new Error("BrandVersion insert failed");
      }
      const updated = await transaction
        .update(nutritionBrands)
        .set({
          currentVersionId: version.id,
          lockVersion: root.lockVersion + 1
        })
        .where(
          and(
            eq(nutritionBrands.id, id),
            eq(nutritionBrands.lockVersion, input.expectedLockVersion)
          )
        )
        .returning();
      if (!updated[0]) {
        throw new ConflictError("Brand lock version is stale");
      }
      return serializeBrand(updated[0], version);
    });
  }

  public findBrand(
    personId: string,
    id: string
  ): Promise<Brand | null> {
    return this.database.db.transaction((transaction) =>
      this.readBrand(transaction, personId, id)
    );
  }

  private async readIngredient(
    transaction: DatabaseTransaction,
    personId: string,
    id: string
  ): Promise<Ingredient | null> {
    const rows = await transaction
      .select({
        ingredient: nutritionIngredients,
        version: nutritionIngredientVersions
      })
      .from(nutritionIngredients)
      .innerJoin(
        nutritionIngredientVersions,
        eq(
          nutritionIngredients.currentVersionId,
          nutritionIngredientVersions.id
        )
      )
      .where(eq(nutritionIngredients.id, id))
      .limit(1);
    const row = rows[0];
    return row &&
      this.accessible(
        row.ingredient.visibility,
        row.ingredient.ownerPersonId,
        personId
      )
      ? serializeIngredient(row.ingredient, row.version)
      : null;
  }

  public createIngredient(
    personId: string,
    input: CreateIngredient
  ): Promise<Ingredient> {
    return this.database.db.transaction(async (transaction) => {
      const roots = await transaction
        .insert(nutritionIngredients)
        .values({
          visibility: input.visibility,
          ownerPersonId: catalogOwner(personId, input.visibility)
        })
        .returning();
      const root = roots[0];
      if (!root) {
        throw new Error("Ingredient insert failed");
      }
      const versions = await transaction
        .insert(nutritionIngredientVersions)
        .values({
          ingredientId: root.id,
          version: 1,
          name: input.name,
          category: input.category ?? null,
          referenceQuantity: input.referenceQuantity.toFixed(3),
          referenceUnit: input.referenceUnit,
          ...nutrientsToRow(input.nutrients)
        })
        .returning();
      const version = versions[0];
      if (!version) {
        throw new Error("IngredientVersion insert failed");
      }
      const updated = await transaction
        .update(nutritionIngredients)
        .set({ currentVersionId: version.id, lockVersion: 1 })
        .where(eq(nutritionIngredients.id, root.id))
        .returning();
      return serializeIngredient(updated[0] ?? root, version);
    });
  }

  public appendIngredientVersion(
    personId: string,
    id: string,
    input: CreateIngredientVersion
  ): Promise<Ingredient> {
    return this.database.db.transaction(async (transaction) => {
      await transaction.execute(
        sql`select id from ${nutritionIngredients}
            where ${nutritionIngredients.id} = ${id} for update`
      );
      const root = await transaction.query.nutritionIngredients.findFirst({
        where: eq(nutritionIngredients.id, id)
      });
      if (
        !root ||
        !this.accessible(root.visibility, root.ownerPersonId, personId)
      ) {
        throw new NotFoundError("Ingredient was not found");
      }
      if (root.lockVersion !== input.expectedLockVersion) {
        throw new ConflictError("Ingredient lock version is stale");
      }
      const versions = await transaction
        .insert(nutritionIngredientVersions)
        .values({
          ingredientId: id,
          version: root.lockVersion + 1,
          name: input.name,
          category: input.category ?? null,
          referenceQuantity: input.referenceQuantity.toFixed(3),
          referenceUnit: input.referenceUnit,
          ...nutrientsToRow(input.nutrients)
        })
        .returning();
      const version = versions[0];
      if (!version) {
        throw new Error("IngredientVersion insert failed");
      }
      const updated = await transaction
        .update(nutritionIngredients)
        .set({
          currentVersionId: version.id,
          lockVersion: root.lockVersion + 1
        })
        .where(
          and(
            eq(nutritionIngredients.id, id),
            eq(
              nutritionIngredients.lockVersion,
              input.expectedLockVersion
            )
          )
        )
        .returning();
      if (!updated[0]) {
        throw new ConflictError("Ingredient lock version is stale");
      }
      return serializeIngredient(updated[0], version);
    });
  }

  public findIngredient(
    personId: string,
    id: string
  ): Promise<Ingredient | null> {
    return this.database.db.transaction((transaction) =>
      this.readIngredient(transaction, personId, id)
    );
  }

  private async assertFoodReferencesAccessible(
    transaction: DatabaseTransaction,
    personId: string,
    targetVisibility: "shared" | "private",
    input: CreateFood | CreateFoodVersion
  ): Promise<void> {
    if (input.brandVersionId) {
      const brandRows = await transaction
        .select({ brand: nutritionBrands })
        .from(nutritionBrandVersions)
        .innerJoin(
          nutritionBrands,
          eq(nutritionBrandVersions.brandId, nutritionBrands.id)
        )
        .where(eq(nutritionBrandVersions.id, input.brandVersionId))
        .limit(1);
      const brand = brandRows[0]?.brand;
      if (
        !brand ||
        !this.accessible(
          brand.visibility,
          brand.ownerPersonId,
          personId
        ) ||
        (targetVisibility === "shared" &&
          brand.visibility !== "shared")
      ) {
        throw new NotFoundError("BrandVersion was not found");
      }
    }
    const ids = input.composition.map(
      (item) => item.ingredientVersionId
    );
    if (ids.length === 0) {
      return;
    }
    const rows = await transaction
      .select({
        versionId: nutritionIngredientVersions.id,
        ingredient: nutritionIngredients
      })
      .from(nutritionIngredientVersions)
      .innerJoin(
        nutritionIngredients,
        eq(
          nutritionIngredientVersions.ingredientId,
          nutritionIngredients.id
        )
      )
      .where(inArray(nutritionIngredientVersions.id, ids));
    if (
      rows.length !== new Set(ids).size ||
      rows.some(
        ({ ingredient }) =>
          !this.accessible(
            ingredient.visibility,
            ingredient.ownerPersonId,
            personId
          ) ||
          (targetVisibility === "shared" &&
            ingredient.visibility !== "shared")
      )
    ) {
      throw new NotFoundError("IngredientVersion was not found");
    }
  }

  private async readFood(
    transaction: DatabaseTransaction,
    personId: string,
    id: string
  ): Promise<Food | null> {
    const rows = await transaction
      .select({
        food: nutritionFoods,
        version: nutritionFoodVersions
      })
      .from(nutritionFoods)
      .innerJoin(
        nutritionFoodVersions,
        eq(nutritionFoods.currentVersionId, nutritionFoodVersions.id)
      )
      .where(eq(nutritionFoods.id, id))
      .limit(1);
    const row = rows[0];
    if (
      !row ||
      !this.accessible(
        row.food.visibility,
        row.food.ownerPersonId,
        personId
      )
    ) {
      return null;
    }
    const composition =
      await transaction.query.nutritionFoodVersionIngredients.findMany({
        where: eq(
          nutritionFoodVersionIngredients.foodVersionId,
          row.version.id
        ),
        orderBy: [nutritionFoodVersionIngredients.position]
      });
    return serializeFood(row.food, row.version, composition);
  }

  private async insertFoodVersion(
    transaction: DatabaseTransaction,
    foodId: string,
    versionNumber: number,
    input: CreateFood | CreateFoodVersion
  ): Promise<NutritionFoodVersionRow> {
    const rows = await transaction
      .insert(nutritionFoodVersions)
      .values({
        foodId,
        version: versionNumber,
        name: input.name,
        type: input.type ?? null,
        category: input.category ?? null,
        referenceQuantity: input.referenceQuantity.toFixed(3),
        referenceUnit: input.referenceUnit,
        ...nutrientsToRow(input.nutrients),
        brandVersionId: input.brandVersionId ?? null
      })
      .returning();
    const version = rows[0];
    if (!version) {
      throw new Error("FoodVersion insert failed");
    }
    if (input.composition.length > 0) {
      await transaction.insert(nutritionFoodVersionIngredients).values(
        input.composition.map((item, index) => ({
          foodVersionId: version.id,
          position: index + 1,
          ingredientVersionId: item.ingredientVersionId,
          quantity: item.quantity.toFixed(3),
          unit: item.unit,
          preparation: item.preparation ?? null,
          required: item.required,
          note: item.note ?? null,
          confidence:
            item.confidence == null
              ? null
              : item.confidence.toFixed(3)
        }))
      );
    }
    return version;
  }

  public createFood(
    personId: string,
    input: CreateFood
  ): Promise<Food> {
    validateFoodComposition(input.composition);
    return this.database.db.transaction(async (transaction) => {
      await this.assertFoodReferencesAccessible(
        transaction,
        personId,
        input.visibility,
        input
      );
      const roots = await transaction
        .insert(nutritionFoods)
        .values({
          visibility: input.visibility,
          ownerPersonId: catalogOwner(personId, input.visibility)
        })
        .returning();
      const root = roots[0];
      if (!root) {
        throw new Error("Food insert failed");
      }
      const version = await this.insertFoodVersion(
        transaction,
        root.id,
        1,
        input
      );
      const updated = await transaction
        .update(nutritionFoods)
        .set({ currentVersionId: version.id, lockVersion: 1 })
        .where(eq(nutritionFoods.id, root.id))
        .returning();
      const composition =
        await transaction.query.nutritionFoodVersionIngredients.findMany({
          where: eq(
            nutritionFoodVersionIngredients.foodVersionId,
            version.id
          ),
          orderBy: [nutritionFoodVersionIngredients.position]
        });
      return serializeFood(updated[0] ?? root, version, composition);
    });
  }

  public appendFoodVersion(
    personId: string,
    id: string,
    input: CreateFoodVersion
  ): Promise<Food> {
    validateFoodComposition(input.composition);
    return this.database.db.transaction(async (transaction) => {
      await transaction.execute(
        sql`select id from ${nutritionFoods}
            where ${nutritionFoods.id} = ${id} for update`
      );
      const root = await transaction.query.nutritionFoods.findFirst({
        where: eq(nutritionFoods.id, id)
      });
      if (
        !root ||
        !this.accessible(root.visibility, root.ownerPersonId, personId)
      ) {
        throw new NotFoundError("Food was not found");
      }
      if (root.lockVersion !== input.expectedLockVersion) {
        throw new ConflictError("Food lock version is stale");
      }
      await this.assertFoodReferencesAccessible(
        transaction,
        personId,
        root.visibility,
        input
      );
      const version = await this.insertFoodVersion(
        transaction,
        id,
        root.lockVersion + 1,
        input
      );
      const updated = await transaction
        .update(nutritionFoods)
        .set({
          currentVersionId: version.id,
          lockVersion: root.lockVersion + 1
        })
        .where(
          and(
            eq(nutritionFoods.id, id),
            eq(nutritionFoods.lockVersion, input.expectedLockVersion)
          )
        )
        .returning();
      if (!updated[0]) {
        throw new ConflictError("Food lock version is stale");
      }
      const composition =
        await transaction.query.nutritionFoodVersionIngredients.findMany({
          where: eq(
            nutritionFoodVersionIngredients.foodVersionId,
            version.id
          ),
          orderBy: [nutritionFoodVersionIngredients.position]
        });
      return serializeFood(updated[0], version, composition);
    });
  }

  public findFood(
    personId: string,
    id: string
  ): Promise<Food | null> {
    return this.database.db.transaction((transaction) =>
      this.readFood(transaction, personId, id)
    );
  }

  public upsertFoodOverlay(
    personId: string,
    foodId: string,
    input: UpsertFoodOverlay
  ): Promise<FoodOverlay> {
    validateFoodOverlay(input);
    return this.database.db.transaction(async (transaction) => {
      const food = await this.readFood(transaction, personId, foodId);
      if (!food) {
        throw new NotFoundError("Food was not found");
      }
      const rows = await transaction
        .insert(nutritionFoodOverlays)
        .values({
          personId,
          foodId,
          alias: input.alias,
          favorite: input.favorite,
          hidden: input.hidden,
          preferredQuantity:
            input.preferredQuantity === null
              ? null
              : input.preferredQuantity.toFixed(3),
          preferredUnit: input.preferredUnit,
          updatedAt: new Date()
        })
        .onConflictDoUpdate({
          target: [
            nutritionFoodOverlays.personId,
            nutritionFoodOverlays.foodId
          ],
          set: {
            alias: input.alias,
            favorite: input.favorite,
            hidden: input.hidden,
            preferredQuantity:
              input.preferredQuantity === null
                ? null
                : input.preferredQuantity.toFixed(3),
            preferredUnit: input.preferredUnit,
            updatedAt: new Date()
          }
        })
        .returning();
      if (!rows[0]) {
        throw new Error("FoodOverlay upsert failed");
      }
      return serializeOverlay(rows[0]);
    });
  }

  private async assertMealFoodVersionsAccessible(
    transaction: DatabaseTransaction,
    personId: string,
    input: CreateMeal | CorrectMeal
  ): Promise<void> {
    const ids = input.items
      .map((item) => item.foodVersionId)
      .filter((id): id is string => id !== null);
    if (ids.length === 0) {
      return;
    }
    const rows = await transaction
      .select({
        versionId: nutritionFoodVersions.id,
        food: nutritionFoods
      })
      .from(nutritionFoodVersions)
      .innerJoin(
        nutritionFoods,
        eq(nutritionFoodVersions.foodId, nutritionFoods.id)
      )
      .where(inArray(nutritionFoodVersions.id, ids));
    if (
      rows.length !== new Set(ids).size ||
      rows.some(
        ({ food }) =>
          !this.accessible(
            food.visibility,
            food.ownerPersonId,
            personId
          )
      )
    ) {
      throw new NotFoundError("FoodVersion was not found");
    }
  }

  private async insertMeal(
    transaction: DatabaseTransaction,
    personId: string,
    sourceReferenceId: string,
    input: CreateMeal | CorrectMeal,
    correction?: { readonly id: string; readonly reason: string }
  ): Promise<MealRow | null> {
    const occurredAt = new Date(input.occurredAt);
    const rows = await transaction
      .insert(meals)
      .values({
        personId,
        occurredAt,
        localDate: deriveLocalDate(occurredAt, input.timezone),
        timezone: input.timezone,
        kind: input.kind,
        description: input.description ?? null,
        note: input.note ?? null,
        photoMediaId: input.photoMediaId ?? null,
        source: input.sourceReference.channel,
        sourceReferenceId,
        dedupeKey: input.dedupeKey,
        confidence:
          input.confidence == null
            ? null
            : input.confidence.toFixed(3),
        supersedesId: correction?.id ?? null,
        correctionReason: correction?.reason ?? null
      })
      .onConflictDoNothing()
      .returning();
    const meal = rows[0];
    if (!meal) {
      return null;
    }
    await transaction.insert(mealItems).values(
      input.items.map((item, index) => ({
        mealId: meal.id,
        position: index + 1,
        foodVersionId: item.foodVersionId,
        label: item.label,
        quantity: item.quantity.toFixed(3),
        unit: item.unit,
        ...nutrientsToRow(item.nutrients)
      }))
    );
    return meal;
  }

  private async serializeMealRow(
    transaction: DatabaseTransaction,
    meal: MealRow
  ): Promise<Meal> {
    const items = await transaction.query.mealItems.findMany({
      where: eq(mealItems.mealId, meal.id),
      orderBy: [mealItems.position]
    });
    const sourceReference =
      await transaction.query.sourceReferences.findFirst({
        where: eq(sourceReferences.id, meal.sourceReferenceId)
      });
    if (!sourceReference) {
      throw new Error("Meal SourceReference was not found");
    }
    return serializeMeal(meal, items, sourceReference);
  }

  private async existingMealByDedupe(
    transaction: DatabaseTransaction,
    personId: string,
    source: "manual" | "google_sheets" | "import",
    dedupeKey: string
  ): Promise<Meal> {
    const meal = await transaction.query.meals.findFirst({
      where: and(
        eq(meals.personId, personId),
        eq(meals.source, source),
        eq(meals.dedupeKey, dedupeKey)
      )
    });
    if (!meal) {
      throw new Error("Meal conflict did not resolve");
    }
    return this.serializeMealRow(transaction, meal);
  }

  public createMeal(
    personId: string,
    input: CreateMeal
  ): Promise<CreateMealResult> {
    return this.database.db.transaction(async (transaction) => {
      await this.assertMealFoodVersionsAccessible(
        transaction,
        personId,
        input
      );
      const sourceReference = await ensureSourceReference(
        transaction,
        personId,
        input.sourceReference
      );
      const meal = await this.insertMeal(
        transaction,
        personId,
        sourceReference.row.id,
        input
      );
      if (meal) {
        return {
          created: true,
          meal: await this.serializeMealRow(transaction, meal)
        };
      }
      await discardUnusedSourceReference(transaction, sourceReference);
      return {
        created: false,
        meal: await this.existingMealByDedupe(
          transaction,
          personId,
          input.sourceReference.channel,
          input.dedupeKey
        )
      };
    });
  }

  public correctMeal(
    personId: string,
    id: string,
    input: CorrectMeal
  ): Promise<CreateMealResult> {
    return this.database.db.transaction(async (transaction) => {
      await transaction.execute(
        sql`select id from ${meals}
            where ${meals.id} = ${id}
              and ${meals.personId} = ${personId}
            for update`
      );
      const original = await transaction.query.meals.findFirst({
        where: and(eq(meals.id, id), eq(meals.personId, personId))
      });
      if (!original) {
        throw new NotFoundError("Meal was not found");
      }
      const successor = await transaction.query.meals.findFirst({
        where: eq(meals.supersedesId, id)
      });
      if (successor) {
        if (
          successor.source === input.sourceReference.channel &&
          successor.dedupeKey === input.dedupeKey
        ) {
          return {
            created: false,
            meal: await this.serializeMealRow(transaction, successor)
          };
        }
        throw new ConflictError("Meal was already superseded");
      }
      await this.assertMealFoodVersionsAccessible(
        transaction,
        personId,
        input
      );
      const sourceReference = await ensureSourceReference(
        transaction,
        personId,
        input.sourceReference
      );
      const meal = await this.insertMeal(
        transaction,
        personId,
        sourceReference.row.id,
        input,
        { id, reason: input.reason }
      );
      if (meal) {
        return {
          created: true,
          meal: await this.serializeMealRow(transaction, meal)
        };
      }
      await discardUnusedSourceReference(transaction, sourceReference);
      const retry = await this.existingMealByDedupe(
        transaction,
        personId,
        input.sourceReference.channel,
        input.dedupeKey
      );
      if (retry.supersedesId !== id) {
        throw new ConflictError(
          "Meal dedupe key belongs to another fact"
        );
      }
      return { created: false, meal: retry };
    });
  }

  public findMeal(
    personId: string,
    id: string
  ): Promise<Meal | null> {
    return this.database.db.transaction(async (transaction) => {
      const meal = await transaction.query.meals.findFirst({
        where: and(eq(meals.id, id), eq(meals.personId, personId))
      });
      return meal
        ? this.serializeMealRow(transaction, meal)
        : null;
    });
  }

  public listMeals(
    personId: string,
    limit: number,
    cursor?: string,
    localDate?: string
  ): Promise<MealList> {
    const successor = alias(meals, "meal_successor");
    const decoded = cursor ? decodeMealCursor(cursor) : undefined;
    return this.database.db.transaction(async (transaction) => {
      const rows = await transaction
        .select()
        .from(meals)
        .where(
          and(
            eq(meals.personId, personId),
            localDate ? eq(meals.localDate, localDate) : undefined,
            notExists(
              transaction
                .select({ id: successor.id })
                .from(successor)
                .where(eq(successor.supersedesId, meals.id))
            ),
            decoded
              ? or(
                  lt(meals.localDate, decoded.localDate),
                  and(
                    eq(meals.localDate, decoded.localDate),
                    decoded.occurredAt === null
                      ? and(isNull(meals.occurredAt), lt(meals.id, decoded.id))
                      : or(
                          lt(meals.occurredAt, new Date(decoded.occurredAt)),
                          isNull(meals.occurredAt),
                          and(
                            eq(meals.occurredAt, new Date(decoded.occurredAt)),
                            lt(meals.id, decoded.id)
                          )
                        )
                  )
                )
              : undefined
          )
        )
        .orderBy(
          desc(meals.localDate),
          sql`${meals.occurredAt} desc nulls last`,
          desc(meals.id)
        )
        .limit(limit + 1);
      const page = rows.slice(0, limit);
      const items: Meal[] = [];
      for (const meal of page) {
        items.push(await this.serializeMealRow(transaction, meal));
      }
      const last = page.at(-1);
      return {
        items,
        nextCursor:
          rows.length > limit && last
            ? encodeMealCursor({
                version: 2,
                localDate: last.localDate,
                occurredAt: last.occurredAt?.toISOString() ?? null,
                id: last.id
              })
            : null
      };
    });
  }

  /** {@inheritDoc NutritionStore.listMealsForLocalDate} */
  public listMealsForLocalDate(personId: string, localDate: string): Promise<readonly Meal[]> {
    return this.database.db.transaction(async (transaction) => {
      const successor = alias(meals, "daily_meal_successor");
      const rows = await transaction.select().from(meals).where(and(
        eq(meals.personId, personId),
        eq(meals.localDate, localDate),
        notExists(transaction.select({ id: successor.id }).from(successor).where(eq(successor.supersedesId, meals.id)))
      )).orderBy(sql`${meals.occurredAt} desc nulls last`, desc(meals.id));
      return Promise.all(rows.map((row) => this.serializeMealRow(transaction, row)));
    });
  }

  /** {@inheritDoc NutritionStore.listMealsForLocalDateRange} */
  public listMealsForLocalDateRange(personId: string, from: string, to: string): Promise<readonly Meal[]> {
    return this.database.db.transaction(async (transaction) => {
      const successor = alias(meals, "range_meal_successor");
      const rows = await transaction.select().from(meals).where(and(
        eq(meals.personId, personId),
        gte(meals.localDate, from),
        lte(meals.localDate, to),
        notExists(transaction.select({ id: successor.id }).from(successor).where(eq(successor.supersedesId, meals.id)))
      )).orderBy(
        desc(meals.localDate),
        sql`${meals.occurredAt} desc nulls last`,
        desc(meals.id)
      );
      return Promise.all(rows.map((row) => this.serializeMealRow(transaction, row)));
    });
  }

  public mealHistory(
    personId: string,
    id: string
  ): Promise<MealHistory | null> {
    return this.database.db.transaction(async (transaction) => {
      const found = await transaction.query.meals.findFirst({
        where: and(eq(meals.id, id), eq(meals.personId, personId))
      });
      if (!found) {
        return null;
      }
      let selected: MealRow = found;
      while (selected.supersedesId) {
        const parent: MealRow | undefined =
          await transaction.query.meals.findFirst({
          where: and(
            eq(meals.id, selected.supersedesId),
            eq(meals.personId, personId)
          )
          });
        if (!parent) {
          throw new Error("Meal correction chain is broken");
        }
        selected = parent;
      }
      const chain: MealRow[] = [selected];
      while (true) {
        const current = chain.at(-1);
        const next = current
          ? await transaction.query.meals.findFirst({
              where: and(
                eq(meals.supersedesId, current.id),
                eq(meals.personId, personId)
              )
            })
          : undefined;
        if (!next) {
          break;
        }
        chain.push(next);
      }
      const items: Meal[] = [];
      for (const meal of chain) {
        items.push(await this.serializeMealRow(transaction, meal));
      }
      return {
        items
      };
    });
  }

  public dailyTotals(
    personId: string,
    localDate: string
  ): Promise<DailyNutritionTotals> {
    const successor = alias(meals, "daily_meal_successor");
    return this.database.db.transaction(async (transaction) => {
      const rows = await transaction
        .select({
          mealCount: sql<string>`count(distinct ${meals.id})::text`,
          caloriesKcal:
            sql<string>`coalesce(sum(${mealItems.caloriesKcal}), 0)::text`,
          proteinG:
            sql<string>`coalesce(sum(${mealItems.proteinG}), 0)::text`,
          fatG: sql<string>`coalesce(sum(${mealItems.fatG}), 0)::text`,
          carbsG:
            sql<string>`coalesce(sum(${mealItems.carbsG}), 0)::text`
        })
        .from(meals)
        .innerJoin(mealItems, eq(mealItems.mealId, meals.id))
        .where(
          and(
            eq(meals.personId, personId),
            eq(meals.localDate, localDate),
            notExists(
              transaction
                .select({ id: successor.id })
                .from(successor)
                .where(eq(successor.supersedesId, meals.id))
            )
          )
        );
      const row = rows[0];
      return {
        personId,
        localDate,
        mealCount: Number(row?.mealCount ?? 0),
        totals: {
          caloriesKcal: Number(row?.caloriesKcal ?? 0),
          proteinG: Number(row?.proteinG ?? 0),
          fatG: Number(row?.fatG ?? 0),
          carbsG: Number(row?.carbsG ?? 0)
        }
      };
    });
  }
}
