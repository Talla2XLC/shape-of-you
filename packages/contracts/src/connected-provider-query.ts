import type { FromSchema } from "json-schema-to-ts";

/** Exact provider Nutrition day; its totals are separate from the Meal ledger. */
export const ConnectedNutritionDayQuerySchema = {
  $id: "ConnectedNutritionDayQuery", type: "object", additionalProperties: false,
  required: ["localDate"],
  properties: { localDate: { type: "string", format: "date" } }
} as const;

/** Exact provider Nutrition day query, scoped by the authenticated Person. */
export type ConnectedNutritionDayQuery = FromSchema<typeof ConnectedNutritionDayQuerySchema>;
