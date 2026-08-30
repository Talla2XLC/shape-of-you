import type { FromSchema } from "json-schema-to-ts";

const uuid = { type: "string", format: "uuid" } as const;
const localDate = { type: "string", format: "date" } as const;
const timezone = { type: "string", minLength: 1, maxLength: 64 } as const;
const dateTime = { type: "string", format: "date-time" } as const;

const nutritionTotalsSummarySchema = {
  type: "object",
  additionalProperties: false,
  required: ["mealCount", "caloriesKcal", "proteinG", "fatG", "carbsG", "nutritionCompleteness", "incompleteMealCount"],
  properties: {
    mealCount: { type: "integer", minimum: 0 },
    caloriesKcal: { anyOf: [{ type: "number" }, { type: "null" }] },
    proteinG: { anyOf: [{ type: "number" }, { type: "null" }] },
    fatG: { anyOf: [{ type: "number" }, { type: "null" }] },
    carbsG: { anyOf: [{ type: "number" }, { type: "null" }] },
    nutritionCompleteness: { enum: ["complete", "partial"] },
    incompleteMealCount: { type: "integer", minimum: 0 }
  }
} as const;

/** Typed current-fact composition for one Person-local date. */
export const DaySnapshotSchema = {
  type: "object",
  additionalProperties: false,
  required: [
    "physical",
    "nutrition",
    "training",
    "recovery",
    "coaching"
  ],
  properties: {
    physical: {
      type: "object",
      additionalProperties: false,
      required: ["weightMeasurements", "bodyMeasurementSessions"],
      properties: {
        weightMeasurements: {
          type: "array",
          items: {
            type: "object",
            additionalProperties: false,
            required: ["id", "measuredAt", "temporalPrecision", "weightKg"],
            properties: {
              id: uuid,
              measuredAt: { anyOf: [dateTime, { type: "null" }] },
              temporalPrecision: { enum: ["instant", "local_date"] },
              weightKg: { type: "number" }
            }
          }
        },
        bodyMeasurementSessions: {
          type: "array",
          items: {
            type: "object",
            additionalProperties: false,
            required: ["id", "measuredAt", "temporalPrecision", "values"],
            properties: {
              id: uuid,
              measuredAt: { anyOf: [dateTime, { type: "null" }] },
              temporalPrecision: { enum: ["instant", "local_date"] },
              values: {
                type: "array",
                items: {
                  type: "object",
                  additionalProperties: false,
                  required: ["metric", "value", "unit"],
                  properties: {
                    metric: { type: "string" },
                    value: { type: "number" },
                    unit: { type: "string" }
                  }
                }
              }
            }
          }
        }
      }
    },
    nutrition: {
      type: "object",
      additionalProperties: false,
      required: ["totals", "meals"],
      properties: {
        totals: nutritionTotalsSummarySchema,
        meals: {
          type: "array",
          items: {
            type: "object",
            additionalProperties: false,
            required: ["id", "occurredAt", "temporalPrecision", "kind"],
            properties: {
              id: uuid,
              occurredAt: { anyOf: [dateTime, { type: "null" }] },
              temporalPrecision: { enum: ["instant", "local_date"] },
              kind: { type: "string" }
            }
          }
        }
      }
    },
    training: {
      type: "object",
      additionalProperties: false,
      required: ["workoutSessions"],
      properties: {
        workoutSessions: {
          type: "array",
          items: {
            type: "object",
            additionalProperties: false,
            required: ["id", "occurredAt", "temporalPrecision", "workoutName"],
            properties: {
              id: uuid,
              occurredAt: { anyOf: [dateTime, { type: "null" }] },
              temporalPrecision: { enum: ["instant", "local_date"] },
              workoutName: { type: "string" }
            }
          }
        }
      }
    },
    contextNotes: {
      type: "array",
      items: {
        type: "object",
        additionalProperties: false,
        required: ["id", "text"],
        properties: {
          id: uuid,
          text: { type: "string", minLength: 1, maxLength: 4_000 }
        }
      }
    },
    recovery: {
      type: "object",
      additionalProperties: false,
      required: ["observations", "assessments"],
      properties: {
        observations: {
          type: "array",
          items: {
            type: "object",
            additionalProperties: false,
            required: ["id", "kind", "observedUntil", "temporalPrecision"],
            properties: {
              id: uuid,
              kind: { type: "string" },
              observedUntil: { anyOf: [dateTime, { type: "null" }] },
              temporalPrecision: { enum: ["instant", "local_date"] }
            }
          }
        },
        assessments: {
          type: "array",
          items: {
            type: "object",
            additionalProperties: false,
            required: ["id", "readinessScore", "riskLevel"],
            properties: { id: uuid, readinessScore: { type: "number" }, riskLevel: { type: "string" } }
          }
        }
      }
    },
    coaching: {
      type: "object",
      additionalProperties: false,
      required: ["recommendations"],
      properties: {
        recommendations: {
          type: "array",
          items: {
            type: "object",
            additionalProperties: false,
            required: ["id", "asOf", "state"],
            properties: { id: uuid, asOf: dateTime, state: { type: "string" } }
          }
        }
      }
    }
  }
} as const;

export type DaySnapshot = FromSchema<typeof DaySnapshotSchema>;

export const DailyProjectionSchema = {
  $id: "DailyProjection",
  type: "object",
  additionalProperties: false,
  required: ["localDate", "timezone", "asOf", "snapshot"],
  properties: {
    localDate,
    timezone,
    asOf: dateTime,
    snapshot: DaySnapshotSchema
  }
} as const;

export type DailyProjection = FromSchema<typeof DailyProjectionSchema>;

export const DailyProjectionQuerySchema = {
  $id: "DailyProjectionQuery",
  type: "object",
  additionalProperties: false,
  required: ["localDate", "timezone"],
  properties: { localDate, timezone }
} as const;

export type DailyProjectionQuery = FromSchema<typeof DailyProjectionQuerySchema>;
