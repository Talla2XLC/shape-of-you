const uuid = { type: "string", format: "uuid" } as const;
const localDate = { type: "string", format: "date" } as const;
const nullableNumber = { anyOf: [{ type: "number" }, { type: "null" }] } as const;

export const DailyAssessmentStatusSchema = {
  type: "string",
  enum: ["ready", "caution", "recovery_priority", "insufficient_data"]
} as const;

export const DailyAssessmentReasonSchema = {
  type: "string",
  enum: [
    "recovery_hard_stop", "short_sleep", "hrv_below_baseline",
    "resting_heart_rate_above_baseline", "low_body_battery",
    "recent_training_load", "active_training_program", "partial_nutrition",
    "sparse_recovery_data", "no_active_training_program",
    "sleep_below_usual", "hrv_below_usual",
    "resting_heart_rate_above_usual", "body_battery_below_usual",
    "training_load_above_usual", "personal_trend_persistent",
    "personal_baseline_unstable", "steps_above_usual"
  ]
} as const;

export const DailyAssessmentMissingDataSchema = {
  type: "string",
  enum: ["sleep", "hrv", "resting_heart_rate", "body_battery", "training", "training_program", "weight", "nutrition"]
} as const;

export const DailyNextActionTypeSchema = {
  type: "string",
  enum: ["recovery_first", "record_recovery_check_in", "follow_active_program", "complete_nutrition_record", "record_weight", "confirm_training_program"]
} as const;

export const DailyNextActionSchema = {
  type: "object",
  additionalProperties: false,
  required: ["type", "text", "trainingProgramVersionId"],
  properties: {
    type: DailyNextActionTypeSchema,
    text: { type: "string", minLength: 1, maxLength: 512 },
    trainingProgramVersionId: { anyOf: [uuid, { type: "null" }] }
  }
} as const;

export const DailyAssessmentFactSummarySchema = {
  type: "object",
  additionalProperties: false,
  required: ["recoveryRiskLevel", "recoveryHardStop", "sleepMinutes", "hrvMs", "hrvBaselineMs", "restingHeartRateBpm", "restingHeartRateBaselineBpm", "bodyBattery", "bodyBatteryMin", "bodyBatteryMax", "recentWorkoutCount", "recentExternalActivityCount", "recentTrainingLoad", "nutritionCompleteness", "mealCount", "caloriesKcal", "proteinG", "latestWeightKg"],
  properties: {
    recoveryRiskLevel: { anyOf: [{ enum: ["low", "moderate", "high", "blocked"] }, { type: "null" }] },
    recoveryHardStop: { type: "boolean" },
    sleepMinutes: nullableNumber,
    hrvMs: nullableNumber,
    hrvBaselineMs: nullableNumber,
    restingHeartRateBpm: nullableNumber,
    restingHeartRateBaselineBpm: nullableNumber,
    bodyBattery: nullableNumber,
    bodyBatteryMin: nullableNumber,
    bodyBatteryMax: nullableNumber,
    recentWorkoutCount: { type: "integer", minimum: 0 },
    recentExternalActivityCount: { type: "integer", minimum: 0 },
    recentTrainingLoad: nullableNumber,
    nutritionCompleteness: { enum: ["complete", "partial"] },
    mealCount: { type: "integer", minimum: 0 },
    caloriesKcal: nullableNumber,
    proteinG: nullableNumber,
    latestWeightKg: nullableNumber
  }
} as const;

export const DailyAssessmentUsedFactsSchema = {
  type: "object",
  additionalProperties: false,
  required: ["recoveryObservationIds", "recoveryAssessmentIds", "workoutSessionIds", "externalActivityIds", "mealIds", "weightMeasurementIds", "activeTrainingProgramVersionId", "coveragePolicyVersion", "coverageReadiness", "summary"],
  properties: {
    recoveryObservationIds: { type: "array", items: uuid, uniqueItems: true },
    recoveryAssessmentIds: { type: "array", items: uuid, uniqueItems: true },
    workoutSessionIds: { type: "array", items: uuid, uniqueItems: true },
    externalActivityIds: { type: "array", items: uuid, uniqueItems: true },
    mealIds: { type: "array", items: uuid, uniqueItems: true },
    weightMeasurementIds: { type: "array", items: uuid, uniqueItems: true },
    activeTrainingProgramVersionId: { anyOf: [uuid, { type: "null" }] },
    dailyContextNoteIds: { type: "array", items: uuid, uniqueItems: true },
    coveragePolicyVersion: { const: "profile-data-coverage-v1" },
    coverageReadiness: {
      type: "object",
      additionalProperties: false,
      required: ["sleep", "hrv", "restingHeartRate", "bodyBattery", "training", "weight", "nutrition"],
      properties: {
        sleep: { enum: ["good", "partial", "sparse"] },
        hrv: { enum: ["good", "partial", "sparse"] },
        restingHeartRate: { enum: ["good", "partial", "sparse"] },
        bodyBattery: { enum: ["good", "partial", "sparse"] },
        training: { enum: ["good", "partial", "sparse"] },
        weight: { enum: ["good", "partial", "sparse"] },
        nutrition: { enum: ["good", "partial", "sparse"] }
      }
    },
    summary: DailyAssessmentFactSummarySchema
  }
} as const;

export const DailyAssessmentV2UsedFactsSchema = {
  ...DailyAssessmentUsedFactsSchema,
  required: [
    ...DailyAssessmentUsedFactsSchema.required,
    "dailyContextNoteIds"
  ]
} as const;

export const DailyAssessmentPersonalComparisonSchema = {
  type: "object",
  additionalProperties: false,
  required: ["metric", "availability", "position", "severity", "eligibleDayCount", "method"],
  properties: {
    metric: {
      enum: [
        "sleep_minutes", "hrv_rmssd", "resting_heart_rate",
        "body_battery", "body_battery_min", "body_battery_max",
        "training_load"
      ]
    },
    availability: { enum: ["available", "insufficient_history", "unstable", "incompatible"] },
    position: {
      anyOf: [
        { enum: ["below_usual", "within_usual", "above_usual"] },
        { type: "null" }
      ]
    },
    severity: {
      anyOf: [{ enum: ["usual", "notable", "marked"] }, { type: "null" }]
    },
    eligibleDayCount: { type: "integer", minimum: 0 },
    method: {
      anyOf: [{ enum: ["median_mad", "median_percentiles"] }, { type: "null" }]
    }
  }
} as const;

export const DailyAssessmentV3PersonalComparisonSchema = {
  ...DailyAssessmentPersonalComparisonSchema,
  properties: {
    ...DailyAssessmentPersonalComparisonSchema.properties,
    metric: {
      enum: [
        "sleep_minutes", "hrv_rmssd", "resting_heart_rate",
        "body_battery", "body_battery_min", "body_battery_max",
        "training_load", "steps"
      ]
    }
  }
} as const;

export const DailyAssessmentPersonalBaselineSchema = {
  type: "object",
  additionalProperties: false,
  required: ["policyKey", "policyVersion", "status", "summary", "comparisons"],
  properties: {
    policyKey: { const: "balanced" },
    policyVersion: { const: "personal-baseline-v1" },
    status: { enum: ["available", "partial", "unavailable", "unstable"] },
    summary: { type: "string", minLength: 1, maxLength: 512 },
    comparisons: {
      type: "array",
      items: DailyAssessmentPersonalComparisonSchema,
      minItems: 7,
      maxItems: 7
    }
  }
} as const;

export const DailyAssessmentV3PersonalBaselineSchema = {
  ...DailyAssessmentPersonalBaselineSchema,
  properties: {
    ...DailyAssessmentPersonalBaselineSchema.properties,
    policyVersion: { const: "personal-baseline-v2" },
    comparisons: {
      type: "array",
      items: DailyAssessmentV3PersonalComparisonSchema,
      minItems: 8,
      maxItems: 8
    }
  }
} as const;

export const DailyAssessmentMovementSchema = {
  type: "object",
  additionalProperties: false,
  required: ["status", "summary", "current"],
  properties: {
    status: { enum: ["available", "unavailable"] },
    summary: { anyOf: [{ type: "string", minLength: 1, maxLength: 512 }, { type: "null" }] },
    current: {
      anyOf: [
        {
          type: "object",
          additionalProperties: false,
          required: ["role", "steps", "asOf", "position", "severity"],
          properties: {
            role: { const: "partial_day" },
            steps: { type: "integer", minimum: 0, maximum: 1000000 },
            asOf: { type: "string", format: "date-time" },
            position: { enum: ["baseline_unavailable", "within_or_below_full_day_usual", "above_full_day_usual"] },
            severity: { anyOf: [{ enum: ["usual", "notable", "marked"] }, { type: "null" }] }
          }
        },
        { type: "null" }
      ]
    }
  }
} as const;

const readyProperties = {
  snapshotId: uuid,
  localDate,
  timezone: { type: "string", minLength: 1, maxLength: 64 },
  status: DailyAssessmentStatusSchema,
  usedFacts: DailyAssessmentUsedFactsSchema,
  missingImportantData: { type: "array", uniqueItems: true, items: DailyAssessmentMissingDataSchema },
  reasons: { type: "array", uniqueItems: true, items: DailyAssessmentReasonSchema },
  recommendedAction: DailyNextActionSchema,
  alternatives: { type: "array", maxItems: 3, items: DailyNextActionSchema },
  limitations: { type: "array", uniqueItems: true, items: { type: "string", enum: ["not_medical_advice", "confidence_limited_by_missing_data", "body_battery_daily_range_not_current", "nutrition_records_may_be_incomplete", "training_schedule_not_inferred", "training_load_baseline_unavailable"] } },
  confidence: { type: "number", minimum: 0, maximum: 1 },
  evidenceChecksum: { type: "string", minLength: 64, maxLength: 64 },
  createdAt: { type: "string", format: "date-time" }
} as const;

export const DailyAssessmentResultSchema = {
  $id: "DailyAssessmentResult",
  oneOf: [
    {
      type: "object", additionalProperties: false,
      required: ["state", "timezone"],
      properties: { state: { const: "timezone_required" }, timezone: { type: "null" } }
    },
    {
      type: "object", additionalProperties: false,
      required: ["state", ...Object.keys(readyProperties), "policyVersion"],
      properties: {
        state: { const: "available" },
        ...readyProperties,
        policyVersion: { const: "daily-assessment-v1" }
      }
    },
    {
      type: "object", additionalProperties: false,
      required: [
        "state", ...Object.keys(readyProperties), "policyVersion", "personalBaseline"
      ],
      properties: {
        state: { const: "available" },
        ...readyProperties,
        usedFacts: DailyAssessmentV2UsedFactsSchema,
        policyVersion: { const: "daily-assessment-v2" },
        personalBaseline: DailyAssessmentPersonalBaselineSchema
      }
    },
    {
      type: "object", additionalProperties: false,
      required: [
        "state", ...Object.keys(readyProperties), "policyVersion",
        "personalBaseline", "movement"
      ],
      properties: {
        state: { const: "available" },
        ...readyProperties,
        usedFacts: DailyAssessmentV2UsedFactsSchema,
        policyVersion: { const: "daily-assessment-v3" },
        personalBaseline: DailyAssessmentV3PersonalBaselineSchema,
        movement: DailyAssessmentMovementSchema
      }
    }
  ]
} as const;

export type DailyAssessmentStatus = "ready" | "caution" | "recovery_priority" | "insufficient_data";
export type DailyAssessmentReason =
  | "recovery_hard_stop" | "short_sleep" | "hrv_below_baseline"
  | "resting_heart_rate_above_baseline" | "low_body_battery"
  | "recent_training_load" | "active_training_program" | "partial_nutrition"
  | "sparse_recovery_data" | "no_active_training_program"
  | "sleep_below_usual" | "hrv_below_usual"
  | "resting_heart_rate_above_usual" | "body_battery_below_usual"
  | "training_load_above_usual" | "personal_trend_persistent"
  | "personal_baseline_unstable" | "steps_above_usual";
export type DailyAssessmentMissingData =
  | "sleep" | "hrv" | "resting_heart_rate" | "body_battery"
  | "training" | "training_program" | "weight" | "nutrition";
export type DailyAssessmentLimitation =
  | "not_medical_advice" | "confidence_limited_by_missing_data"
  | "body_battery_daily_range_not_current" | "nutrition_records_may_be_incomplete"
  | "training_schedule_not_inferred" | "training_load_baseline_unavailable";
export type DailyNextActionType =
  | "recovery_first" | "record_recovery_check_in" | "follow_active_program"
  | "complete_nutrition_record" | "record_weight" | "confirm_training_program";

/** One policy-selected user action; program references prevent invented training. */
export interface DailyNextAction {
  readonly type: DailyNextActionType;
  readonly text: string;
  readonly trainingProgramVersionId: string | null;
}

/** Provider-neutral evidence envelope captured in an immutable daily snapshot. */
export interface DailyAssessmentUsedFacts {
  readonly recoveryObservationIds: readonly string[];
  readonly recoveryAssessmentIds: readonly string[];
  readonly workoutSessionIds: readonly string[];
  readonly externalActivityIds: readonly string[];
  readonly mealIds: readonly string[];
  readonly weightMeasurementIds: readonly string[];
  readonly activeTrainingProgramVersionId: string | null;
  readonly dailyContextNoteIds?: readonly string[];
  readonly coveragePolicyVersion: "profile-data-coverage-v1";
  readonly coverageReadiness: {
    readonly sleep: "good" | "partial" | "sparse";
    readonly hrv: "good" | "partial" | "sparse";
    readonly restingHeartRate: "good" | "partial" | "sparse";
    readonly bodyBattery: "good" | "partial" | "sparse";
    readonly training: "good" | "partial" | "sparse";
    readonly weight: "good" | "partial" | "sparse";
    readonly nutrition: "good" | "partial" | "sparse";
  };
  readonly summary: {
    readonly recoveryRiskLevel: "low" | "moderate" | "high" | "blocked" | null;
    readonly recoveryHardStop: boolean;
    readonly sleepMinutes: number | null;
    readonly hrvMs: number | null;
    readonly hrvBaselineMs: number | null;
    readonly restingHeartRateBpm: number | null;
    readonly restingHeartRateBaselineBpm: number | null;
    readonly bodyBattery: number | null;
    readonly bodyBatteryMin: number | null;
    readonly bodyBatteryMax: number | null;
    readonly recentWorkoutCount: number;
    readonly recentExternalActivityCount: number;
    readonly recentTrainingLoad: number | null;
    readonly nutritionCompleteness: "complete" | "partial";
    readonly mealCount: number;
    readonly caloriesKcal: number | null;
    readonly proteinG: number | null;
    readonly latestWeightKg: number | null;
  };
}

/** V2 evidence always identifies the typed context notes used for exclusions. */
export interface DailyAssessmentV2UsedFacts extends DailyAssessmentUsedFacts {
  readonly dailyContextNoteIds: readonly string[];
}

export type DailyAssessmentV2PersonalMetric =
  | "sleep_minutes" | "hrv_rmssd" | "resting_heart_rate"
  | "body_battery" | "body_battery_min" | "body_battery_max"
  | "training_load";

export type DailyAssessmentPersonalMetric = DailyAssessmentV2PersonalMetric | "steps";

/** One qualitative comparison with the Person's recent usual range. */
export interface DailyAssessmentPersonalComparison {
  readonly metric: DailyAssessmentPersonalMetric;
  readonly availability: "available" | "insufficient_history" | "unstable" | "incompatible";
  readonly position: "below_usual" | "within_usual" | "above_usual" | null;
  readonly severity: "usual" | "notable" | "marked" | null;
  readonly eligibleDayCount: number;
  readonly method: "median_mad" | "median_percentiles" | null;
}

/** Public non-medical explanation of the active personal-baseline policy. */
export interface DailyAssessmentPersonalBaseline {
  readonly policyKey: "balanced";
  readonly policyVersion: "personal-baseline-v1" | "personal-baseline-v2";
  readonly status: "available" | "partial" | "unavailable" | "unstable";
  readonly summary: string;
  readonly comparisons: readonly DailyAssessmentPersonalComparison[];
}

/** Optional current-day movement context retained by a V3 snapshot. */
export interface DailyAssessmentMovement {
  readonly status: "available" | "unavailable";
  readonly summary: string | null;
  readonly current: {
    readonly role: "partial_day";
    readonly steps: number;
    readonly asOf: string;
    readonly position: "baseline_unavailable" | "within_or_below_full_day_usual" | "above_full_day_usual";
    readonly severity: "usual" | "notable" | "marked" | null;
  } | null;
}

/** Stored deterministic decision for one Person-local date and evidence version. */
interface DailyAssessmentAvailableBase {
  readonly state: "available";
  readonly snapshotId: string;
  readonly localDate: string;
  readonly timezone: string;
  readonly status: DailyAssessmentStatus;
  readonly usedFacts: DailyAssessmentUsedFacts;
  readonly missingImportantData: readonly DailyAssessmentMissingData[];
  readonly reasons: readonly DailyAssessmentReason[];
  readonly recommendedAction: DailyNextAction;
  readonly alternatives: readonly DailyNextAction[];
  readonly limitations: readonly DailyAssessmentLimitation[];
  readonly confidence: number;
  readonly evidenceChecksum: string;
  readonly createdAt: string;
}

/** Legacy absolute-policy snapshot retained as an immutable readable result. */
export interface DailyAssessmentAvailableV1 extends DailyAssessmentAvailableBase {
  readonly policyVersion: "daily-assessment-v1";
}

/** Active hybrid snapshot with a required versioned personal explanation. */
export interface DailyAssessmentAvailableV2 extends Omit<DailyAssessmentAvailableBase, "usedFacts"> {
  readonly policyVersion: "daily-assessment-v2";
  readonly usedFacts: DailyAssessmentV2UsedFacts;
  readonly personalBaseline: DailyAssessmentPersonalBaseline;
}

/** Active V3 snapshot with optional typed partial-day movement context. */
export interface DailyAssessmentAvailableV3 extends Omit<DailyAssessmentAvailableBase, "usedFacts"> {
  readonly policyVersion: "daily-assessment-v3";
  readonly usedFacts: DailyAssessmentV2UsedFacts;
  readonly personalBaseline: DailyAssessmentPersonalBaseline & {
    readonly policyVersion: "personal-baseline-v2";
  };
  readonly movement: DailyAssessmentMovement;
}

export type DailyAssessmentAvailable =
  | DailyAssessmentAvailableV1
  | DailyAssessmentAvailableV2
  | DailyAssessmentAvailableV3;

/** Read result that fails explicitly when Person timezone has not been configured. */
export type DailyAssessmentResult =
  | { readonly state: "timezone_required"; readonly timezone: null }
  | DailyAssessmentAvailable;
