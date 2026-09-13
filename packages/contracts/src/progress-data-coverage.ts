import type { FromSchema } from "json-schema-to-ts";

const localDate = { type: "string", format: "date" } as const;
const nullableLocalDate = { anyOf: [localDate, { type: "null" }] } as const;
const timezone = { type: "string", minLength: 1, maxLength: 64 } as const;

export const ProgressDataDirectionKeySchema = {
  type: "string",
  enum: ["sleep", "hrv", "resting_heart_rate", "body_battery", "training", "weight", "nutrition"]
} as const;

/** Stable provider-neutral direction reported by profile data coverage. */
export type ProgressDataDirectionKey = FromSchema<typeof ProgressDataDirectionKeySchema>;

export const ProgressDataReadinessStatusSchema = {
  type: "string",
  enum: ["sparse", "partial", "good"]
} as const;

/** Explainable data-sufficiency level; it is not a health score. */
export type ProgressDataReadinessStatus = FromSchema<typeof ProgressDataReadinessStatusSchema>;

export const ProgressDataReadinessReasonSchema = {
  type: "string",
  enum: [
    "no_data",
    "stale",
    "not_enough_recent_data",
    "significant_gaps",
    "partial_records",
    "limited_history"
  ]
} as const;

/** Machine-readable reason used to explain a direction's readiness. */
export type ProgressDataReadinessReason = FromSchema<typeof ProgressDataReadinessReasonSchema>;

export const ProgressDataCoverageQuerySchema = {
  $id: "ProgressDataCoverageQuery",
  type: "object",
  additionalProperties: false,
  required: ["localDate", "timezone"],
  properties: { localDate, timezone }
} as const;

/** Explicit Person-local context for one profile coverage read. */
export type ProgressDataCoverageQuery = FromSchema<typeof ProgressDataCoverageQuerySchema>;

export const ProgressDataCoverageWindowSchema = {
  type: "object",
  additionalProperties: false,
  required: ["windowDays", "from", "to", "recordedDays", "usableDays"],
  properties: {
    windowDays: { type: "integer", enum: [28, 90] },
    from: localDate,
    to: localDate,
    recordedDays: { type: "integer", minimum: 0 },
    usableDays: { type: "integer", minimum: 0 }
  }
} as const;

/** Completed-day coverage counts for a fixed recent window. */
export type ProgressDataCoverageWindow = FromSchema<typeof ProgressDataCoverageWindowSchema>;

export const ProgressDataGapSummarySchema = {
  type: "object",
  additionalProperties: false,
  required: ["significantGapCount", "longestGapDays"],
  properties: {
    significantGapCount: { type: "integer", minimum: 0 },
    longestGapDays: { type: "integer", minimum: 0, maximum: 90 }
  }
} as const;

/** Bounded summary of recent consecutive days without usable evidence. */
export type ProgressDataGapSummary = FromSchema<typeof ProgressDataGapSummarySchema>;

export const ProgressDataDirectionSchema = {
  type: "object",
  additionalProperties: false,
  required: [
    "key",
    "firstDataDate",
    "lastDataDate",
    "freshnessDays",
    "coverage28",
    "coverage90",
    "gaps",
    "status",
    "reasons"
  ],
  properties: {
    key: ProgressDataDirectionKeySchema,
    firstDataDate: nullableLocalDate,
    lastDataDate: nullableLocalDate,
    freshnessDays: { anyOf: [{ type: "integer", minimum: 0 }, { type: "null" }] },
    coverage28: ProgressDataCoverageWindowSchema,
    coverage90: ProgressDataCoverageWindowSchema,
    gaps: ProgressDataGapSummarySchema,
    status: ProgressDataReadinessStatusSchema,
    reasons: { type: "array", uniqueItems: true, items: ProgressDataReadinessReasonSchema }
  }
} as const;

/** Historical, recent, and readiness view for one data direction. */
export type ProgressDataDirection = FromSchema<typeof ProgressDataDirectionSchema>;

export const ProgressDataCoverageSchema = {
  $id: "ProgressDataCoverage",
  type: "object",
  additionalProperties: false,
  required: ["localDate", "completedThrough", "timezone", "policyVersion", "directions"],
  properties: {
    localDate,
    completedThrough: localDate,
    timezone,
    policyVersion: { type: "string", const: "profile-data-coverage-v1" },
    directions: {
      type: "array",
      minItems: 7,
      maxItems: 7,
      items: ProgressDataDirectionSchema
    }
  }
} as const;

/** Provider-neutral profile evidence and recommendation-context readiness. */
export type ProgressDataCoverage = FromSchema<typeof ProgressDataCoverageSchema>;
