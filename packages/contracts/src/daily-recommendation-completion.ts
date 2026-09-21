const uuid = { type: "string", format: "uuid" } as const;
const dateTime = { type: "string", format: "date-time" } as const;
const nullableDateTime = { anyOf: [dateTime, { type: "null" }] } as const;
const nullableUuid = { anyOf: [uuid, { type: "null" }] } as const;
const nullableNumber = { anyOf: [{ type: "number" }, { type: "null" }] } as const;

/** Closed completion checks attached to a versioned daily action. */
export type DailyCompletionCriterionType =
  | "weight_recorded"
  | "meal_recorded"
  | "program_workout_completed"
  | "recovery_check_in_recorded"
  | "steps_threshold_reached"
  | "sleep_duration_reached"
  | "training_program_confirmed"
  | "manual_confirmation";

export type DailyCompletionOwnerDomain =
  | "weight"
  | "nutrition"
  | "training"
  | "recovery"
  | "coaching";

export interface DailyCompletionCriterion {
  readonly id: string;
  readonly type: DailyCompletionCriterionType;
  readonly role: "required" | "supporting";
  readonly ownerDomain: DailyCompletionOwnerDomain;
  readonly observationWindow: "after_recommendation_on_local_date";
  readonly targetValue: number | null;
  readonly trainingProgramVersionId: string | null;
}

export const DailyCompletionCriterionSchema = {
  type: "object",
  additionalProperties: false,
  required: [
    "id", "type", "role", "ownerDomain", "targetValue",
    "trainingProgramVersionId", "observationWindow"
  ],
  properties: {
    id: { type: "string", minLength: 1, maxLength: 64, pattern: "^[a-z0-9_]+$" },
    type: {
      enum: [
        "weight_recorded", "meal_recorded", "program_workout_completed",
        "recovery_check_in_recorded", "steps_threshold_reached",
        "sleep_duration_reached", "training_program_confirmed",
        "manual_confirmation"
      ]
    },
    role: { enum: ["required", "supporting"] },
    ownerDomain: {
      enum: ["weight", "nutrition", "training", "recovery", "coaching"]
    },
    observationWindow: { const: "after_recommendation_on_local_date" },
    targetValue: nullableNumber,
    trainingProgramVersionId: nullableUuid
  }
} as const;

/** Atomic-first completion specification for one primary action. */
export interface DailyCompletionSpecification {
  readonly aggregation: "all_of";
  readonly criteria: readonly DailyCompletionCriterion[];
}

export const DailyCompletionSpecificationSchema = {
  type: "object",
  additionalProperties: false,
  required: ["aggregation", "criteria"],
  properties: {
    aggregation: { const: "all_of" },
    criteria: {
      type: "array",
      minItems: 1,
      maxItems: 8,
      items: DailyCompletionCriterionSchema
    }
  }
} as const;

export type DailyRecommendationCompletionState =
  | "completed"
  | "partially_completed"
  | "not_completed"
  | "unknown";

export type DailyRecommendationEvidenceMode =
  | "observed"
  | "self_reported"
  | "partially_observed"
  | "unknown";

export type DailyCompletionReason =
  | "all_required_criteria_observed"
  | "some_required_criteria_observed"
  | "manual_completed"
  | "manual_skipped"
  | "insufficient_evidence";

export type DailyCompletionLimitation =
  | "source_partial"
  | "source_stale"
  | "source_unknown"
  | "action_requires_self_report"
  | "external_activity_not_program_linked"
  | "self_report_conflicts_with_observation";

export type DailyCompletionCriterionResultStatus =
  | "satisfied"
  | "partial"
  | "unknown";

export interface DailyCompletionCriterionResult {
  readonly criterionId: string;
  readonly status: DailyCompletionCriterionResultStatus;
  readonly freshness: "fresh" | "stale" | "unknown";
  readonly completeness: "complete" | "partial" | "unknown";
  readonly observedAt: string | null;
  readonly evidence: {
    readonly ownerDomain: DailyCompletionOwnerDomain;
    readonly factType:
      | "weight_measurement"
      | "meal"
      | "workout_session"
      | "external_activity"
      | "recovery_observation"
      | "training_program_version";
    readonly factId: string;
  } | null;
  readonly limitations: readonly DailyCompletionLimitation[];
}

export const DailyCompletionCriterionResultSchema = {
  type: "object",
  additionalProperties: false,
  required: [
    "criterionId", "status", "freshness", "completeness", "observedAt",
    "evidence", "limitations"
  ],
  properties: {
    criterionId: { type: "string", minLength: 1, maxLength: 64 },
    status: { enum: ["satisfied", "partial", "unknown"] },
    freshness: { enum: ["fresh", "stale", "unknown"] },
    completeness: { enum: ["complete", "partial", "unknown"] },
    observedAt: nullableDateTime,
    evidence: {
      anyOf: [
        {
          type: "object",
          additionalProperties: false,
          required: ["ownerDomain", "factType", "factId"],
          properties: {
            ownerDomain: DailyCompletionCriterionSchema.properties.ownerDomain,
            factType: {
              enum: [
                "weight_measurement", "meal", "workout_session",
                "external_activity", "recovery_observation",
                "training_program_version"
              ]
            },
            factId: uuid
          }
        },
        { type: "null" }
      ]
    },
    limitations: {
      type: "array",
      uniqueItems: true,
      items: {
        enum: [
          "source_partial", "source_stale", "source_unknown",
          "action_requires_self_report", "external_activity_not_program_linked",
          "self_report_conflicts_with_observation"
        ]
      }
    }
  }
} as const;

/** Immutable, explainable completion assessment for one daily snapshot. */
export interface DailyRecommendationCompletionAssessment {
  readonly id: string;
  readonly snapshotId: string;
  readonly completionPolicyVersion: "daily-completion-v1";
  readonly completionState: DailyRecommendationCompletionState;
  readonly evidenceMode: DailyRecommendationEvidenceMode;
  readonly criteria: readonly DailyCompletionCriterionResult[];
  readonly reasons: readonly DailyCompletionReason[];
  readonly limitations: readonly DailyCompletionLimitation[];
  readonly evaluatedAt: string;
  readonly evidenceChecksum: string;
}

export const DailyRecommendationCompletionAssessmentSchema = {
  $id: "DailyRecommendationCompletionAssessment",
  type: "object",
  additionalProperties: false,
  required: [
    "id", "snapshotId", "completionPolicyVersion", "completionState",
    "evidenceMode", "criteria", "reasons", "limitations", "evaluatedAt",
    "evidenceChecksum"
  ],
  properties: {
    id: uuid,
    snapshotId: uuid,
    completionPolicyVersion: { const: "daily-completion-v1" },
    completionState: {
      enum: ["completed", "partially_completed", "not_completed", "unknown"]
    },
    evidenceMode: {
      enum: ["observed", "self_reported", "partially_observed", "unknown"]
    },
    criteria: { type: "array", minItems: 1, maxItems: 8, items: DailyCompletionCriterionResultSchema },
    reasons: {
      type: "array",
      uniqueItems: true,
      items: {
        enum: [
          "all_required_criteria_observed", "some_required_criteria_observed",
          "manual_completed", "manual_skipped", "insufficient_evidence"
        ]
      }
    },
    limitations: DailyCompletionCriterionResultSchema.properties.limitations,
    evaluatedAt: dateTime,
    evidenceChecksum: { type: "string", minLength: 64, maxLength: 64 }
  }
} as const;

/** Route/tool input selecting one immutable daily recommendation snapshot. */
export interface ReadDailyRecommendationCompletion {
  readonly snapshotId: string;
}

export const ReadDailyRecommendationCompletionSchema = {
  $id: "ReadDailyRecommendationCompletion",
  type: "object",
  additionalProperties: false,
  required: ["snapshotId"],
  properties: { snapshotId: uuid }
} as const;
