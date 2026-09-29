import type { FromSchema } from "json-schema-to-ts";

const localDate = { type: "string", format: "date" } as const;
const uuid = { type: "string", format: "uuid" } as const;

export const PersonalInsightKindSchema = {
  type: "string",
  enum: ["weight_direction", "training_rhythm", "post_training_sleep_association"]
} as const;

/** The three versioned, non-prescriptive observations supported by the first policy. */
export type PersonalInsightKind = FromSchema<typeof PersonalInsightKindSchema>;

export const PersonalInsightsQuerySchema = {
  $id: "PersonalInsightsQuery",
  type: "object",
  additionalProperties: false,
  required: ["localDate", "timezone"],
  properties: {
    localDate,
    timezone: { type: "string", minLength: 1, maxLength: 64 }
  }
} as const;

/** Person-local request context; only completed days enter the calculation. */
export type PersonalInsightsQuery = FromSchema<typeof PersonalInsightsQuerySchema>;

export const PersonalInsightEvidenceSchema = {
  type: "object",
  additionalProperties: false,
  required: ["weightMeasurementIds", "workoutSessionIds", "externalActivityIds", "recoveryObservationIds"],
  properties: {
    weightMeasurementIds: { type: "array", items: uuid },
    workoutSessionIds: { type: "array", items: uuid },
    externalActivityIds: { type: "array", items: uuid },
    recoveryObservationIds: { type: "array", items: uuid }
  }
} as const;

export const PersonalInsightSchema = {
  type: "object",
  additionalProperties: false,
  required: ["kind", "from", "to", "statement", "uncertainty", "sampleDays", "comparisonDays", "limitation", "evidence"],
  properties: {
    kind: PersonalInsightKindSchema,
    from: localDate,
    to: localDate,
    statement: { type: "string", minLength: 1, maxLength: 300 },
    uncertainty: { type: "string", enum: ["moderate", "high"] },
    sampleDays: { type: "integer", minimum: 0, maximum: 56 },
    comparisonDays: { type: "integer", minimum: 0, maximum: 56 },
    limitation: { type: "string", minLength: 1, maxLength: 300 },
    evidence: PersonalInsightEvidenceSchema
  }
} as const;

/** One current observation with exact owner-fact provenance, never a medical or causal conclusion. */
export type PersonalInsight = FromSchema<typeof PersonalInsightSchema>;

export const PersonalInsightSuppressionSchema = {
  type: "object",
  additionalProperties: false,
  required: ["kind", "reason"],
  properties: {
    kind: PersonalInsightKindSchema,
    reason: { type: "string", enum: ["insufficient_data", "ambiguous_evidence", "no_meaningful_difference"] }
  }
} as const;

/** Why a candidate is absent; it is not a negative statement about the Person. */
export type PersonalInsightSuppression = FromSchema<typeof PersonalInsightSuppressionSchema>;

export const PersonalInsightsResultSchema = {
  $id: "PersonalInsightsResult",
  type: "object",
  additionalProperties: false,
  required: ["localDate", "completedThrough", "timezone", "policyVersion", "insights", "suppressed"],
  properties: {
    localDate,
    completedThrough: localDate,
    timezone: { type: "string", minLength: 1, maxLength: 64 },
    policyVersion: { const: "personal-insights-v1" },
    insights: { type: "array", items: PersonalInsightSchema, maxItems: 3 },
    suppressed: { type: "array", items: PersonalInsightSuppressionSchema, maxItems: 3 }
  }
} as const;

/** Read-only current projection shared by HTTP, Web, and MCP Coach. */
export type PersonalInsightsResult = FromSchema<typeof PersonalInsightsResultSchema>;
