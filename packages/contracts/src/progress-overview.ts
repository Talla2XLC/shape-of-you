import type { FromSchema } from "json-schema-to-ts";

const localDate = { type: "string", format: "date" } as const;
const timezone = { type: "string", minLength: 1, maxLength: 64 } as const;

export const ProgressMetricKeySchema = {
  type: "string",
  enum: [
    "weight_kg",
    "calories_kcal",
    "protein_g",
    "workout_session_count",
    "readiness_score"
  ]
} as const;

/** Stable identifier of a factual metric supported by progress overview v1. */
export type ProgressMetricKey = FromSchema<typeof ProgressMetricKeySchema>;

export const ProgressOverviewQuerySchema = {
  $id: "ProgressOverviewQuery",
  type: "object",
  additionalProperties: false,
  required: ["from", "to", "timezone"],
  properties: { from: localDate, to: localDate, timezone }
} as const;

/** Inclusive Person-local range used by the bounded progress read model. */
export type ProgressOverviewQuery = FromSchema<typeof ProgressOverviewQuerySchema>;

export const ProgressMetricPointSchema = {
  type: "object",
  additionalProperties: false,
  required: ["localDate", "value"],
  properties: { localDate, value: { type: "number" } }
} as const;

/** One factual metric value; absence of a point means a chart gap. */
export type ProgressMetricPoint = FromSchema<typeof ProgressMetricPointSchema>;

export const ProgressMetricSeriesSchema = {
  type: "object",
  additionalProperties: false,
  required: ["key", "label", "unit", "points"],
  properties: {
    key: ProgressMetricKeySchema,
    label: { type: "string", minLength: 1 },
    unit: { type: "string", minLength: 1 },
    points: { type: "array", items: ProgressMetricPointSchema }
  }
} as const;

/** Sparse factual series rendered by the progress client. */
export type ProgressMetricSeries = FromSchema<typeof ProgressMetricSeriesSchema>;

export const ProgressFactCountsSchema = {
  type: "object",
  additionalProperties: false,
  required: [
    "weightMeasurements",
    "bodyMeasurementSessions",
    "meals",
    "workoutSessions",
    "recoveryObservations",
    "recoveryAssessments",
    "coachingRecommendations"
  ],
  properties: {
    weightMeasurements: { type: "integer", minimum: 0 },
    bodyMeasurementSessions: { type: "integer", minimum: 0 },
    meals: { type: "integer", minimum: 0 },
    workoutSessions: { type: "integer", minimum: 0 },
    recoveryObservations: { type: "integer", minimum: 0 },
    recoveryAssessments: { type: "integer", minimum: 0 },
    coachingRecommendations: { type: "integer", minimum: 0 }
  }
} as const;

/** Bounded counts proving which current facts make a local date navigable. */
export type ProgressFactCounts = FromSchema<typeof ProgressFactCountsSchema>;

export const ProgressOverviewDaySchema = {
  type: "object",
  additionalProperties: false,
  required: ["localDate", "facts"],
  properties: { localDate, facts: ProgressFactCountsSchema }
} as const;

/** Newest-first factual day entry used for exact-date drill-down. */
export type ProgressOverviewDay = FromSchema<typeof ProgressOverviewDaySchema>;

export const ProgressOverviewSchema = {
  $id: "ProgressOverview",
  type: "object",
  additionalProperties: false,
  required: ["from", "to", "timezone", "metricSetVersion", "metrics", "days"],
  properties: {
    from: localDate,
    to: localDate,
    timezone,
    metricSetVersion: { type: "string", const: "progress-metrics-v1" },
    metrics: { type: "array", items: ProgressMetricSeriesSchema },
    days: { type: "array", items: ProgressOverviewDaySchema }
  }
} as const;

/** Bounded current-fact overview for one explicit Person-local range. */
export type ProgressOverview = FromSchema<typeof ProgressOverviewSchema>;
