const uuid = { type: "string", format: "uuid" } as const;
const dateTime = { type: "string", format: "date-time" } as const;
const nullableWeight = {
  anyOf: [
    { type: "number", minimum: 0, maximum: 100000, multipleOf: 0.001 },
    { type: "null" }
  ]
} as const;
const nullableRepetitions = {
  anyOf: [
    { type: "integer", minimum: 1, maximum: 10000 },
    { type: "null" }
  ]
} as const;

export type CoachingRecommendationState =
  | "proposed"
  | "accepted"
  | "rejected"
  | "expired";
export type CoachingDecisionOutcome = "accepted" | "rejected";
export type TrainingAdjustmentAction =
  | "hold"
  | "target_weight"
  | "repetition_range";

export const CoachingRecommendationStateSchema = {
  type: "string",
  enum: ["proposed", "accepted", "rejected", "expired"]
} as const;

export const CoachingDecisionOutcomeSchema = {
  type: "string",
  enum: ["accepted", "rejected"]
} as const;

export const TrainingAdjustmentActionSchema = {
  type: "string",
  enum: ["hold", "target_weight", "repetition_range"]
} as const;

/** Command evaluating one active Training prescription against exact evidence. */
export interface CreateTrainingAdjustmentRecommendation {
  readonly policyVersionId: string;
  readonly recoveryAssessmentId: string;
  readonly programVersionId: string;
  readonly workoutPosition: number;
  readonly prescriptionPosition: number;
  readonly asOf: string;
  readonly dedupeKey: string;
}

export const CreateTrainingAdjustmentRecommendationSchema = {
  $id: "CreateTrainingAdjustmentRecommendation",
  type: "object",
  additionalProperties: false,
  required: [
    "policyVersionId",
    "recoveryAssessmentId",
    "programVersionId",
    "workoutPosition",
    "prescriptionPosition",
    "asOf",
    "dedupeKey"
  ],
  properties: {
    policyVersionId: uuid,
    recoveryAssessmentId: uuid,
    programVersionId: uuid,
    workoutPosition: { type: "integer", minimum: 1 },
    prescriptionPosition: { type: "integer", minimum: 1 },
    asOf: dateTime,
    dedupeKey: { type: "string", minLength: 1, maxLength: 256 }
  }
} as const;

/** One explicit terminal decision about a recommendation. */
export interface CreateCoachingRecommendationDecision {
  readonly outcome: CoachingDecisionOutcome;
  readonly reason: string;
  readonly dedupeKey: string;
}

export const CreateCoachingRecommendationDecisionSchema = {
  $id: "CreateCoachingRecommendationDecision",
  type: "object",
  additionalProperties: false,
  required: ["outcome", "reason", "dedupeKey"],
  properties: {
    outcome: CoachingDecisionOutcomeSchema,
    reason: { type: "string", minLength: 1, maxLength: 512 },
    dedupeKey: { type: "string", minLength: 1, maxLength: 256 }
  }
} as const;

export interface CoachingRecommendationDecision {
  readonly id: string;
  readonly recommendationId: string;
  readonly personId: string;
  readonly actorPersonId: string;
  readonly outcome: CoachingDecisionOutcome;
  readonly reason: string;
  readonly dedupeKey: string;
  readonly decidedAt: string;
}

export const CoachingRecommendationDecisionSchema = {
  type: "object",
  additionalProperties: false,
  required: [
    "id",
    "recommendationId",
    "personId",
    "actorPersonId",
    "outcome",
    "reason",
    "dedupeKey",
    "decidedAt"
  ],
  properties: {
    id: uuid,
    recommendationId: uuid,
    personId: uuid,
    actorPersonId: uuid,
    outcome: CoachingDecisionOutcomeSchema,
    reason: { type: "string" },
    dedupeKey: { type: "string" },
    decidedAt: dateTime
  }
} as const;

interface TrainingAdjustmentDetailBase {
  readonly programId: string;
  readonly programVersionId: string;
  readonly workoutPosition: number;
  readonly prescriptionPosition: number;
  readonly exerciseId: string;
  readonly exerciseVersionId: string;
  readonly reasonCode:
    | "hard_stop"
    | "low_confidence"
    | "high_risk"
    | "moderate_risk"
    | "maintain";
}

export interface HoldTrainingAdjustment extends TrainingAdjustmentDetailBase {
  readonly action: "hold";
  readonly currentTargetWeightKg: number | null;
  readonly suggestedTargetWeightKg: null;
  readonly currentRepsMin: number;
  readonly currentRepsMax: number;
  readonly suggestedRepsMin: null;
  readonly suggestedRepsMax: null;
}

export interface TargetWeightTrainingAdjustment
  extends TrainingAdjustmentDetailBase {
  readonly action: "target_weight";
  readonly currentTargetWeightKg: number;
  readonly suggestedTargetWeightKg: number;
  readonly currentRepsMin: number;
  readonly currentRepsMax: number;
  readonly suggestedRepsMin: null;
  readonly suggestedRepsMax: null;
}

export interface RepetitionRangeTrainingAdjustment
  extends TrainingAdjustmentDetailBase {
  readonly action: "repetition_range";
  readonly currentTargetWeightKg: number | null;
  readonly suggestedTargetWeightKg: null;
  readonly currentRepsMin: number;
  readonly currentRepsMax: number;
  readonly suggestedRepsMin: number;
  readonly suggestedRepsMax: number;
}

export type TrainingAdjustmentRecommendationDetail =
  | HoldTrainingAdjustment
  | TargetWeightTrainingAdjustment
  | RepetitionRangeTrainingAdjustment;

const trainingAdjustmentCommonProperties = {
  programId: uuid,
  programVersionId: uuid,
  workoutPosition: { type: "integer", minimum: 1 },
  prescriptionPosition: { type: "integer", minimum: 1 },
  exerciseId: uuid,
  exerciseVersionId: uuid,
  reasonCode: {
    type: "string",
    enum: [
      "hard_stop",
      "low_confidence",
      "high_risk",
      "moderate_risk",
      "maintain"
    ]
  },
  currentTargetWeightKg: nullableWeight,
  currentRepsMin: { type: "integer", minimum: 1 },
  currentRepsMax: { type: "integer", minimum: 1 }
} as const;

const trainingAdjustmentRequired = [
  "action",
  "programId",
  "programVersionId",
  "workoutPosition",
  "prescriptionPosition",
  "exerciseId",
  "exerciseVersionId",
  "reasonCode",
  "currentTargetWeightKg",
  "suggestedTargetWeightKg",
  "currentRepsMin",
  "currentRepsMax",
  "suggestedRepsMin",
  "suggestedRepsMax"
] as const;

export const TrainingAdjustmentRecommendationDetailSchema = {
  oneOf: [
    {
      type: "object",
      additionalProperties: false,
      required: trainingAdjustmentRequired,
      properties: {
        ...trainingAdjustmentCommonProperties,
        action: { const: "hold" },
        suggestedTargetWeightKg: { type: "null" },
        suggestedRepsMin: { type: "null" },
        suggestedRepsMax: { type: "null" }
      }
    },
    {
      type: "object",
      additionalProperties: false,
      required: trainingAdjustmentRequired,
      properties: {
        ...trainingAdjustmentCommonProperties,
        action: { const: "target_weight" },
        currentTargetWeightKg: nullableWeight.anyOf[0],
        suggestedTargetWeightKg: nullableWeight.anyOf[0],
        suggestedRepsMin: { type: "null" },
        suggestedRepsMax: { type: "null" }
      }
    },
    {
      type: "object",
      additionalProperties: false,
      required: trainingAdjustmentRequired,
      properties: {
        ...trainingAdjustmentCommonProperties,
        action: { const: "repetition_range" },
        suggestedTargetWeightKg: { type: "null" },
        suggestedRepsMin: nullableRepetitions.anyOf[0],
        suggestedRepsMax: nullableRepetitions.anyOf[0]
      }
    }
  ]
} as const;

export interface CoachingRecommendationEvidence {
  readonly recoveryAssessmentId: string;
  readonly trainingProgramVersionId: string;
  readonly workoutSessionIds: readonly string[];
}

export const CoachingRecommendationEvidenceSchema = {
  type: "object",
  additionalProperties: false,
  required: [
    "recoveryAssessmentId",
    "trainingProgramVersionId",
    "workoutSessionIds"
  ],
  properties: {
    recoveryAssessmentId: uuid,
    trainingProgramVersionId: uuid,
    workoutSessionIds: { type: "array", items: uuid, uniqueItems: true }
  }
} as const;

/** Immutable recommendation projection with its derived lifecycle state. */
export interface CoachingRecommendation {
  readonly id: string;
  readonly personId: string;
  readonly kind: "training_adjustment";
  readonly policyVersionId: string;
  readonly state: CoachingRecommendationState;
  readonly asOf: string;
  readonly createdAt: string;
  readonly expiresAt: string;
  readonly evidenceChecksum: string;
  readonly explanation: string;
  readonly dedupeKey: string;
  readonly detail: TrainingAdjustmentRecommendationDetail;
  readonly evidence: CoachingRecommendationEvidence;
  readonly decision: CoachingRecommendationDecision | null;
}

export const CoachingRecommendationSchema = {
  $id: "CoachingRecommendation",
  type: "object",
  additionalProperties: false,
  required: [
    "id",
    "personId",
    "kind",
    "policyVersionId",
    "state",
    "asOf",
    "createdAt",
    "expiresAt",
    "evidenceChecksum",
    "explanation",
    "dedupeKey",
    "detail",
    "evidence",
    "decision"
  ],
  properties: {
    id: uuid,
    personId: uuid,
    kind: { const: "training_adjustment" },
    policyVersionId: uuid,
    state: CoachingRecommendationStateSchema,
    asOf: dateTime,
    createdAt: dateTime,
    expiresAt: dateTime,
    evidenceChecksum: { type: "string", minLength: 1, maxLength: 128 },
    explanation: { type: "string", minLength: 1, maxLength: 2048 },
    dedupeKey: { type: "string" },
    detail: TrainingAdjustmentRecommendationDetailSchema,
    evidence: CoachingRecommendationEvidenceSchema,
    decision: {
      anyOf: [CoachingRecommendationDecisionSchema, { type: "null" }]
    }
  }
} as const;

export interface CoachingRecommendationList {
  readonly items: readonly CoachingRecommendation[];
}

export interface ListCoachingRecommendationsQuery {
  readonly limit?: number;
  readonly state?: CoachingRecommendationState;
}

export const ListCoachingRecommendationsQuerySchema = {
  $id: "ListCoachingRecommendationsQuery",
  type: "object",
  additionalProperties: false,
  properties: {
    limit: { type: "integer", minimum: 1, maximum: 100, default: 50 },
    state: CoachingRecommendationStateSchema
  }
} as const;

export const CoachingRecommendationListSchema = {
  $id: "CoachingRecommendationList",
  type: "object",
  additionalProperties: false,
  required: ["items"],
  properties: { items: { type: "array", items: CoachingRecommendationSchema } }
} as const;

export interface CoachingRecommendationHistory {
  readonly recommendation: CoachingRecommendation;
  readonly decisions: readonly CoachingRecommendationDecision[];
}

export const CoachingRecommendationHistorySchema = {
  $id: "CoachingRecommendationHistory",
  type: "object",
  additionalProperties: false,
  required: ["recommendation", "decisions"],
  properties: {
    recommendation: CoachingRecommendationSchema,
    decisions: {
      type: "array",
      maxItems: 1,
      items: CoachingRecommendationDecisionSchema
    }
  }
} as const;

export const CoachingRecommendationIdParamsSchema = {
  type: "object",
  additionalProperties: false,
  required: ["id"],
  properties: { id: uuid }
} as const;

export interface CoachingRecommendationIdParams {
  readonly id: string;
}
