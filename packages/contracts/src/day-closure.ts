import type { FromSchema } from "json-schema-to-ts";

const uuid = { type: "string", format: "uuid" } as const;
const localDate = { type: "string", format: "date" } as const;
const timezone = { type: "string", minLength: 1, maxLength: 64 } as const;
const dateTime = { type: "string", format: "date-time" } as const;

const nutritionTotalsSummarySchema = {
  type: "object",
  additionalProperties: false,
  required: ["mealCount", "caloriesKcal", "proteinG", "fatG", "carbsG"],
  properties: {
    mealCount: { type: "integer", minimum: 0 },
    caloriesKcal: { type: "number" },
    proteinG: { type: "number" },
    fatG: { type: "number" },
    carbsG: { type: "number" }
  }
} as const;

export const DayClosureStatusSchema = {
  type: "string",
  enum: ["active", "superseded"]
} as const;

export type DayClosureStatus = FromSchema<typeof DayClosureStatusSchema>;

export const DayReferenceKindSchema = {
  type: "string",
  enum: [
    "weight_measurement",
    "body_measurement_session",
    "meal",
    "workout_session",
    "recovery_observation",
    "recovery_assessment",
    "coaching_recommendation"
  ]
} as const;

export type DayReferenceKind = FromSchema<typeof DayReferenceKindSchema>;

/** A typed immutable-fact reference included in one daily closure. */
export const DayClosureReferenceSchema = {
  type: "object",
  additionalProperties: false,
  required: ["kind", "id"],
  properties: { kind: DayReferenceKindSchema, id: uuid }
} as const;

export type DayClosureReference = FromSchema<typeof DayClosureReferenceSchema>;

/** Immutable, typed result of composing one Person-local daily view. */
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
            required: ["id", "measuredAt", "weightKg"],
            properties: { id: uuid, measuredAt: dateTime, weightKg: { type: "number" } }
          }
        },
        bodyMeasurementSessions: {
          type: "array",
          items: {
            type: "object",
            additionalProperties: false,
            required: ["id", "measuredAt", "values"],
            properties: {
              id: uuid,
              measuredAt: dateTime,
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
            required: ["id", "occurredAt", "kind"],
            properties: { id: uuid, occurredAt: dateTime, kind: { type: "string" } }
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
            required: ["id", "occurredAt", "workoutName"],
            properties: { id: uuid, occurredAt: dateTime, workoutName: { type: "string" } }
          }
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
            required: ["id", "kind", "observedUntil"],
            properties: { id: uuid, kind: { type: "string" }, observedUntil: dateTime }
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

export const DayClosureSchema = {
  $id: "DayClosure",
  type: "object",
  additionalProperties: false,
  required: [
    "id",
    "personId",
    "closedByPersonId",
    "source",
    "localDate",
    "timezone",
    "version",
    "status",
    "policyVersion",
    "snapshot",
    "references",
    "closedAt",
    "reopenedAt",
    "reopenReason",
    "supersedesId"
  ],
  properties: {
    id: uuid,
    personId: uuid,
    closedByPersonId: uuid,
    source: { type: "string", enum: ["manual", "google_sheets", "import", "device"] },
    localDate,
    timezone,
    version: { type: "integer", minimum: 1 },
    status: DayClosureStatusSchema,
    policyVersion: { type: "string", minLength: 1, maxLength: 128 },
    snapshot: DaySnapshotSchema,
    references: { type: "array", items: DayClosureReferenceSchema, uniqueItems: true },
    closedAt: dateTime,
    reopenedAt: { anyOf: [dateTime, { type: "null" }] },
    reopenReason: {
      anyOf: [{ type: "string", minLength: 1, maxLength: 512 }, { type: "null" }]
    },
    supersedesId: { anyOf: [uuid, { type: "null" }] }
  }
} as const;

export type DayClosure = FromSchema<typeof DayClosureSchema>;

export const DailyProjectionSchema = {
  $id: "DailyProjection",
  type: "object",
  additionalProperties: false,
  required: ["localDate", "timezone", "state", "closure", "snapshot", "isStale"],
  properties: {
    localDate,
    timezone,
    state: { type: "string", enum: ["open", "closed", "stale", "superseded"] },
    closure: { anyOf: [DayClosureSchema, { type: "null" }] },
    snapshot: DaySnapshotSchema,
    isStale: { type: "boolean" }
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

export const CloseDaySchema = {
  $id: "CloseDay",
  type: "object",
  additionalProperties: false,
  required: ["localDate", "timezone", "idempotencyKey"],
  properties: {
    localDate,
    timezone,
    idempotencyKey: { type: "string", minLength: 1, maxLength: 256 }
  }
} as const;

export type CloseDay = FromSchema<typeof CloseDaySchema>;

export const ReopenDaySchema = {
  $id: "ReopenDay",
  type: "object",
  additionalProperties: false,
  required: ["reason", "idempotencyKey"],
  properties: {
    reason: { type: "string", minLength: 1, maxLength: 512 },
    idempotencyKey: { type: "string", minLength: 1, maxLength: 256 }
  }
} as const;

export type ReopenDay = FromSchema<typeof ReopenDaySchema>;

export const DayClosureHistorySchema = {
  $id: "DayClosureHistory",
  type: "object",
  additionalProperties: false,
  required: ["items"],
  properties: { items: { type: "array", items: DayClosureSchema } }
} as const;

export type DayClosureHistory = FromSchema<typeof DayClosureHistorySchema>;
