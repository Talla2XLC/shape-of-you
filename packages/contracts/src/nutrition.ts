import type { FromSchema } from "json-schema-to-ts";

import {
  SourceReferenceInputSchema,
  SourceReferenceSchema
} from "./source-reference.js";

const nullableUuidSchema = {
  anyOf: [
    { type: "string", format: "uuid" },
    { type: "null" }
  ]
} as const;

const nullableTextSchema = {
  anyOf: [
    { type: "string", minLength: 1, maxLength: 4096 },
    { type: "null" }
  ]
} as const;

const nullableShortTextSchema = {
  anyOf: [
    { type: "string", minLength: 1, maxLength: 256 },
    { type: "null" }
  ]
} as const;

const nullableConfidenceSchema = {
  anyOf: [
    { type: "number", minimum: 0, maximum: 1, multipleOf: 0.001 },
    { type: "null" }
  ]
} as const;

export const CatalogVisibilitySchema = {
  type: "string",
  enum: ["shared", "private"]
} as const;

export const NutritionUnitSchema = {
  type: "string",
  enum: ["g", "ml", "serving", "piece"]
} as const;

export const NutrientValuesSchema = {
  type: "object",
  additionalProperties: false,
  required: ["caloriesKcal", "proteinG", "fatG", "carbsG"],
  properties: {
    caloriesKcal: {
      type: "number",
      minimum: 0,
      maximum: 100000,
      multipleOf: 0.001
    },
    proteinG: {
      type: "number",
      minimum: 0,
      maximum: 10000,
      multipleOf: 0.001
    },
    fatG: {
      type: "number",
      minimum: 0,
      maximum: 10000,
      multipleOf: 0.001
    },
    carbsG: {
      type: "number",
      minimum: 0,
      maximum: 10000,
      multipleOf: 0.001
    }
  }
} as const;

/** Typed nutrition snapshot for one exact reference quantity or intake. */
export type NutrientValues = FromSchema<typeof NutrientValuesSchema>;

export const PartialNutrientValuesSchema = {
  type: "object",
  additionalProperties: false,
  required: ["caloriesKcal", "proteinG", "fatG", "carbsG"],
  properties: {
    caloriesKcal: { type: ["number", "null"], minimum: 0, maximum: 100000, multipleOf: 0.001 },
    proteinG: { type: ["number", "null"], minimum: 0, maximum: 10000, multipleOf: 0.001 },
    fatG: { type: ["number", "null"], minimum: 0, maximum: 10000, multipleOf: 0.001 },
    carbsG: { type: ["number", "null"], minimum: 0, maximum: 10000, multipleOf: 0.001 }
  }
} as const;

/** Nutrients read from historical evidence; null means unknown, never zero. */
export type PartialNutrientValues = FromSchema<typeof PartialNutrientValuesSchema>;

export const NutritionCompletenessSchema = {
  type: "string",
  enum: ["complete", "partial"]
} as const;

const catalogIdentityProperties = {
  id: { type: "string", format: "uuid" },
  visibility: CatalogVisibilitySchema,
  ownerPersonId: nullableUuidSchema,
  lockVersion: { type: "integer", minimum: 0 },
  createdAt: { type: "string", format: "date-time" }
} as const;

const createCatalogIdentityProperties = {
  visibility: CatalogVisibilitySchema
} as const;

export const BrandVersionSchema = {
  type: "object",
  additionalProperties: false,
  required: ["id", "version", "name", "type", "note", "createdAt"],
  properties: {
    id: { type: "string", format: "uuid" },
    version: { type: "integer", minimum: 1 },
    name: { type: "string", minLength: 1, maxLength: 256 },
    type: nullableShortTextSchema,
    note: nullableTextSchema,
    createdAt: { type: "string", format: "date-time" }
  }
} as const;

export const BrandSchema = {
  $id: "NutritionBrand",
  type: "object",
  additionalProperties: false,
  required: [
    "id",
    "visibility",
    "ownerPersonId",
    "lockVersion",
    "createdAt",
    "currentVersion"
  ],
  properties: {
    ...catalogIdentityProperties,
    currentVersion: BrandVersionSchema
  }
} as const;

/** Versioned shared or private nutrition brand. */
export type Brand = FromSchema<typeof BrandSchema>;

const brandVersionInputProperties = {
  name: { type: "string", minLength: 1, maxLength: 256 },
  type: nullableShortTextSchema,
  note: nullableTextSchema
} as const;

export const CreateBrandSchema = {
  $id: "CreateNutritionBrand",
  type: "object",
  additionalProperties: false,
  required: ["visibility", "name"],
  properties: {
    ...createCatalogIdentityProperties,
    ...brandVersionInputProperties
  }
} as const;

/** Command creating a Brand and its first immutable revision. */
export type CreateBrand = FromSchema<typeof CreateBrandSchema>;

export const CreateBrandVersionSchema = {
  $id: "CreateNutritionBrandVersion",
  type: "object",
  additionalProperties: false,
  required: ["expectedLockVersion", "name"],
  properties: {
    expectedLockVersion: { type: "integer", minimum: 0 },
    ...brandVersionInputProperties
  }
} as const;

/** Command appending and activating a Brand revision. */
export type CreateBrandVersion = FromSchema<
  typeof CreateBrandVersionSchema
>;

export const IngredientVersionSchema = {
  type: "object",
  additionalProperties: false,
  required: [
    "id",
    "version",
    "name",
    "category",
    "referenceQuantity",
    "referenceUnit",
    "nutrients",
    "createdAt"
  ],
  properties: {
    id: { type: "string", format: "uuid" },
    version: { type: "integer", minimum: 1 },
    name: { type: "string", minLength: 1, maxLength: 256 },
    category: nullableShortTextSchema,
    referenceQuantity: {
      type: "number",
      exclusiveMinimum: 0,
      maximum: 100000,
      multipleOf: 0.001
    },
    referenceUnit: NutritionUnitSchema,
    nutrients: NutrientValuesSchema,
    createdAt: { type: "string", format: "date-time" }
  }
} as const;

export const IngredientSchema = {
  $id: "NutritionIngredient",
  type: "object",
  additionalProperties: false,
  required: [
    "id",
    "visibility",
    "ownerPersonId",
    "lockVersion",
    "createdAt",
    "currentVersion"
  ],
  properties: {
    ...catalogIdentityProperties,
    currentVersion: IngredientVersionSchema
  }
} as const;

/** Versioned shared or private nutrition ingredient. */
export type Ingredient = FromSchema<typeof IngredientSchema>;

const ingredientVersionInputProperties = {
  name: { type: "string", minLength: 1, maxLength: 256 },
  category: nullableShortTextSchema,
  referenceQuantity: {
    type: "number",
    exclusiveMinimum: 0,
    maximum: 100000,
    multipleOf: 0.001
  },
  referenceUnit: NutritionUnitSchema,
  nutrients: NutrientValuesSchema
} as const;

export const CreateIngredientSchema = {
  $id: "CreateNutritionIngredient",
  type: "object",
  additionalProperties: false,
  required: [
    "visibility",
    "name",
    "referenceQuantity",
    "referenceUnit",
    "nutrients"
  ],
  properties: {
    ...createCatalogIdentityProperties,
    ...ingredientVersionInputProperties
  }
} as const;

/** Command creating an Ingredient and its first immutable revision. */
export type CreateIngredient = FromSchema<
  typeof CreateIngredientSchema
>;

export const CreateIngredientVersionSchema = {
  $id: "CreateNutritionIngredientVersion",
  type: "object",
  additionalProperties: false,
  required: [
    "expectedLockVersion",
    "name",
    "referenceQuantity",
    "referenceUnit",
    "nutrients"
  ],
  properties: {
    expectedLockVersion: { type: "integer", minimum: 0 },
    ...ingredientVersionInputProperties
  }
} as const;

/** Command appending and activating an Ingredient revision. */
export type CreateIngredientVersion = FromSchema<
  typeof CreateIngredientVersionSchema
>;

export const FoodCompositionInputSchema = {
  type: "object",
  additionalProperties: false,
  required: [
    "ingredientVersionId",
    "quantity",
    "unit",
    "required"
  ],
  properties: {
    ingredientVersionId: { type: "string", format: "uuid" },
    quantity: {
      type: "number",
      exclusiveMinimum: 0,
      maximum: 100000,
      multipleOf: 0.001
    },
    unit: NutritionUnitSchema,
    preparation: nullableShortTextSchema,
    required: { type: "boolean" },
    note: nullableTextSchema,
    confidence: nullableConfidenceSchema
  }
} as const;

export type FoodCompositionInput = FromSchema<
  typeof FoodCompositionInputSchema
>;

export const FoodVersionSchema = {
  type: "object",
  additionalProperties: false,
  required: [
    "id",
    "version",
    "name",
    "type",
    "category",
    "referenceQuantity",
    "referenceUnit",
    "nutrients",
    "brandVersionId",
    "composition",
    "createdAt"
  ],
  properties: {
    id: { type: "string", format: "uuid" },
    version: { type: "integer", minimum: 1 },
    name: { type: "string", minLength: 1, maxLength: 256 },
    type: nullableShortTextSchema,
    category: nullableShortTextSchema,
    referenceQuantity: {
      type: "number",
      exclusiveMinimum: 0,
      maximum: 100000,
      multipleOf: 0.001
    },
    referenceUnit: NutritionUnitSchema,
    nutrients: NutrientValuesSchema,
    brandVersionId: nullableUuidSchema,
    composition: {
      type: "array",
      maxItems: 100,
      items: FoodCompositionInputSchema
    },
    createdAt: { type: "string", format: "date-time" }
  }
} as const;

export const FoodSchema = {
  $id: "NutritionFood",
  type: "object",
  additionalProperties: false,
  required: [
    "id",
    "visibility",
    "ownerPersonId",
    "lockVersion",
    "createdAt",
    "currentVersion"
  ],
  properties: {
    ...catalogIdentityProperties,
    currentVersion: FoodVersionSchema
  }
} as const;

/** Stable food identity and its current immutable revision. */
export type Food = FromSchema<typeof FoodSchema>;

const foodVersionInputProperties = {
  name: { type: "string", minLength: 1, maxLength: 256 },
  type: nullableShortTextSchema,
  category: nullableShortTextSchema,
  referenceQuantity: {
    type: "number",
    exclusiveMinimum: 0,
    maximum: 100000,
    multipleOf: 0.001
  },
  referenceUnit: NutritionUnitSchema,
  nutrients: NutrientValuesSchema,
  brandVersionId: nullableUuidSchema,
  composition: {
    type: "array",
    maxItems: 100,
    items: FoodCompositionInputSchema
  }
} as const;

export const CreateFoodSchema = {
  $id: "CreateNutritionFood",
  type: "object",
  additionalProperties: false,
  required: [
    "visibility",
    "name",
    "referenceQuantity",
    "referenceUnit",
    "nutrients",
    "composition"
  ],
  properties: {
    ...createCatalogIdentityProperties,
    ...foodVersionInputProperties
  }
} as const;

/** Command creating a Food and its first immutable version. */
export type CreateFood = FromSchema<typeof CreateFoodSchema>;

export const CreateFoodVersionSchema = {
  $id: "CreateNutritionFoodVersion",
  type: "object",
  additionalProperties: false,
  required: [
    "expectedLockVersion",
    "name",
    "referenceQuantity",
    "referenceUnit",
    "nutrients",
    "composition"
  ],
  properties: {
    expectedLockVersion: { type: "integer", minimum: 0 },
    ...foodVersionInputProperties
  }
} as const;

/** Command appending and activating an immutable Food version. */
export type CreateFoodVersion = FromSchema<
  typeof CreateFoodVersionSchema
>;

export const CatalogIdParamsSchema = {
  $id: "NutritionCatalogIdParams",
  type: "object",
  additionalProperties: false,
  required: ["id"],
  properties: {
    id: { type: "string", format: "uuid" }
  }
} as const;

export type CatalogIdParams = FromSchema<typeof CatalogIdParamsSchema>;

export const UpsertFoodOverlaySchema = {
  $id: "UpsertNutritionFoodOverlay",
  type: "object",
  additionalProperties: false,
  required: ["alias", "favorite", "hidden", "preferredQuantity", "preferredUnit"],
  properties: {
    alias: nullableShortTextSchema,
    favorite: { type: "boolean" },
    hidden: { type: "boolean" },
    preferredQuantity: {
      anyOf: [
        {
          type: "number",
          exclusiveMinimum: 0,
          maximum: 100000,
          multipleOf: 0.001
        },
        { type: "null" }
      ]
    },
    preferredUnit: {
      anyOf: [NutritionUnitSchema, { type: "null" }]
    }
  }
} as const;

export type UpsertFoodOverlay = FromSchema<
  typeof UpsertFoodOverlaySchema
>;

export const FoodOverlaySchema = {
  $id: "NutritionFoodOverlay",
  type: "object",
  additionalProperties: false,
  required: [
    "personId",
    "foodId",
    "alias",
    "favorite",
    "hidden",
    "preferredQuantity",
    "preferredUnit",
    "updatedAt"
  ],
  properties: {
    personId: { type: "string", format: "uuid" },
    foodId: { type: "string", format: "uuid" },
    ...UpsertFoodOverlaySchema.properties,
    updatedAt: { type: "string", format: "date-time" }
  }
} as const;

export type FoodOverlay = FromSchema<typeof FoodOverlaySchema>;

export const MealKindSchema = {
  type: "string",
  enum: ["breakfast", "lunch", "dinner", "snack", "other"]
} as const;

export const MealTemporalPrecisionSchema = {
  type: "string",
  enum: ["instant", "local_date"]
} as const;

export const MealItemInputSchema = {
  type: "object",
  additionalProperties: false,
  required: [
    "foodVersionId",
    "label",
    "quantity",
    "unit",
    "nutrients"
  ],
  properties: {
    foodVersionId: nullableUuidSchema,
    label: { type: "string", minLength: 1, maxLength: 256 },
    quantity: {
      type: "number",
      exclusiveMinimum: 0,
      maximum: 100000,
      multipleOf: 0.001
    },
    unit: NutritionUnitSchema,
    nutrients: NutrientValuesSchema
  }
} as const;

export type MealItemInput = FromSchema<typeof MealItemInputSchema>;

export const MealItemSchema = {
  type: "object",
  additionalProperties: false,
  required: ["position", "foodVersionId", "label", "quantity", "unit", "nutrients"],
  properties: {
    position: { type: "integer", minimum: 1 },
    foodVersionId: nullableUuidSchema,
    label: { type: "string", minLength: 1, maxLength: 256 },
    quantity: MealItemInputSchema.properties.quantity,
    unit: NutritionUnitSchema,
    nutrients: PartialNutrientValuesSchema
  }
} as const;

export type MealItem = FromSchema<typeof MealItemSchema>;

export const MealSchema = {
  $id: "NutritionMeal",
  type: "object",
  additionalProperties: false,
  required: [
    "id",
    "personId",
    "occurredAt",
    "temporalPrecision",
    "localDate",
    "timezone",
    "kind",
    "description",
    "note",
    "photoMediaId",
    "items",
    "totals",
    "nutritionCompleteness",
    "sourceReference",
    "dedupeKey",
    "confidence",
    "supersedesId",
    "correctionReason",
    "createdAt"
  ],
  properties: {
    id: { type: "string", format: "uuid" },
    personId: { type: "string", format: "uuid" },
    occurredAt: {
      anyOf: [
        { type: "string", format: "date-time" },
        { type: "null" }
      ]
    },
    temporalPrecision: MealTemporalPrecisionSchema,
    localDate: { type: "string", format: "date" },
    timezone: { type: "string", minLength: 1, maxLength: 64 },
    kind: MealKindSchema,
    description: nullableTextSchema,
    note: nullableTextSchema,
    photoMediaId: nullableUuidSchema,
    items: {
      type: "array",
      minItems: 1,
      maxItems: 100,
      items: MealItemSchema
    },
    totals: PartialNutrientValuesSchema,
    nutritionCompleteness: NutritionCompletenessSchema,
    sourceReference: SourceReferenceSchema,
    dedupeKey: { type: "string", minLength: 1, maxLength: 256 },
    confidence: nullableConfidenceSchema,
    supersedesId: nullableUuidSchema,
    correctionReason: {
      anyOf: [
        { type: "string", minLength: 1, maxLength: 512 },
        { type: "null" }
      ]
    },
    createdAt: { type: "string", format: "date-time" }
  }
} as const;

/** Immutable person-owned meal snapshot. */
export type Meal = FromSchema<typeof MealSchema>;

const mealInputProperties = {
  occurredAt: { type: "string", format: "date-time" },
  timezone: { type: "string", minLength: 1, maxLength: 64 },
  kind: MealKindSchema,
  description: nullableTextSchema,
  note: nullableTextSchema,
  photoMediaId: nullableUuidSchema,
  items: {
    type: "array",
    minItems: 1,
    maxItems: 100,
    items: MealItemInputSchema
  },
  sourceReference: SourceReferenceInputSchema,
  dedupeKey: { type: "string", minLength: 1, maxLength: 256 },
  confidence: nullableConfidenceSchema
} as const;

export const CreateMealSchema = {
  $id: "CreateNutritionMeal",
  type: "object",
  additionalProperties: false,
  required: [
    "occurredAt",
    "timezone",
    "kind",
    "items",
    "sourceReference",
    "dedupeKey"
  ],
  properties: mealInputProperties
} as const;

/** Command creating one idempotent Meal fact. */
export type CreateMeal = FromSchema<typeof CreateMealSchema>;

export const CorrectMealSchema = {
  $id: "CorrectNutritionMeal",
  type: "object",
  additionalProperties: false,
  required: [
    "occurredAt",
    "timezone",
    "kind",
    "items",
    "sourceReference",
    "dedupeKey",
    "reason"
  ],
  properties: {
    ...mealInputProperties,
    reason: { type: "string", minLength: 1, maxLength: 512 }
  }
} as const;

/** Full replacement command for append-only Meal correction. */
export type CorrectMeal = FromSchema<typeof CorrectMealSchema>;

export const MealIdParamsSchema = {
  ...CatalogIdParamsSchema,
  $id: "NutritionMealIdParams"
} as const;

export type MealIdParams = FromSchema<typeof MealIdParamsSchema>;

export const ListMealsQuerySchema = {
  $id: "ListNutritionMealsQuery",
  type: "object",
  additionalProperties: false,
  properties: {
    limit: { type: "integer", minimum: 1, maximum: 100, default: 50 },
    cursor: { type: "string", minLength: 1, maxLength: 1024 },
    localDate: { type: "string", format: "date" }
  }
} as const;

export type ListMealsQuery = FromSchema<typeof ListMealsQuerySchema>;

export const MealListSchema = {
  $id: "NutritionMealList",
  type: "object",
  additionalProperties: false,
  required: ["items", "nextCursor"],
  properties: {
    items: { type: "array", items: MealSchema },
    nextCursor: {
      anyOf: [
        { type: "string", minLength: 1 },
        { type: "null" }
      ]
    }
  }
} as const;

export type MealList = FromSchema<typeof MealListSchema>;

export const MealHistorySchema = {
  $id: "NutritionMealHistory",
  type: "object",
  additionalProperties: false,
  required: ["items"],
  properties: {
    items: { type: "array", minItems: 1, items: MealSchema }
  }
} as const;

export type MealHistory = FromSchema<typeof MealHistorySchema>;

export const DailyNutritionTotalsQuerySchema = {
  $id: "DailyNutritionTotalsQuery",
  type: "object",
  additionalProperties: false,
  required: ["localDate"],
  properties: {
    localDate: { type: "string", format: "date" }
  }
} as const;

export type DailyNutritionTotalsQuery = FromSchema<
  typeof DailyNutritionTotalsQuerySchema
>;

export const DailyNutritionTotalsSchema = {
  $id: "DailyNutritionTotals",
  type: "object",
  additionalProperties: false,
  required: ["personId", "localDate", "mealCount", "totals", "nutritionCompleteness", "incompleteMealCount"],
  properties: {
    personId: { type: "string", format: "uuid" },
    localDate: { type: "string", format: "date" },
    mealCount: { type: "integer", minimum: 0 },
    totals: PartialNutrientValuesSchema,
    nutritionCompleteness: NutritionCompletenessSchema,
    incompleteMealCount: { type: "integer", minimum: 0 }
  }
} as const;

/** Current factual nutrition totals for one Person-local date. */
export type DailyNutritionTotals = FromSchema<
  typeof DailyNutritionTotalsSchema
>;
