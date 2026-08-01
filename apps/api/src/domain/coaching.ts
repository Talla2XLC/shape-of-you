import type {
  CoachingRecommendationState,
  TrainingAdjustmentRecommendationDetail
} from "@shape-of-you/contracts";

import { DomainValidationError } from "./errors.js";

/** Typed immutable parameters for one Coaching policy revision. */
export interface CoachingPolicyParameters {
  readonly recommendationTtlMinutes: number;
  readonly minimumConfidence: number;
  readonly highRiskLoadFactor: number;
  readonly repetitionReduction: number;
}

/** Exact Recovery assessment evidence consumed by Coaching. */
export interface CoachingRecoveryEvidence {
  readonly riskLevel: "low" | "moderate" | "high" | "blocked";
  readonly confidence: number;
  readonly hardStop: boolean;
}

/** Exact active Training prescription consumed by Coaching. */
export interface CoachingTrainingPrescription {
  readonly programId: string;
  readonly programVersionId: string;
  readonly workoutPosition: number;
  readonly prescriptionPosition: number;
  readonly exerciseId: string;
  readonly exerciseVersionId: string;
  readonly targetWeightKg: number | null;
  readonly targetRepsMin: number;
  readonly targetRepsMax: number;
}

/** Pure, typed recommendation result persisted without a generic payload. */
export interface TrainingAdjustmentEvaluation {
  readonly detail: TrainingAdjustmentRecommendationDetail;
  readonly explanation: string;
}

/** Validates policy invariants before an immutable revision is registered. */
export function validateCoachingPolicy(
  policy: CoachingPolicyParameters
): void {
  if (!Number.isInteger(policy.recommendationTtlMinutes) || policy.recommendationTtlMinutes <= 0) {
    throw new DomainValidationError("Recommendation TTL must be a positive whole number of minutes");
  }
  if (policy.minimumConfidence < 0 || policy.minimumConfidence > 1) {
    throw new DomainValidationError("Minimum confidence must be between 0 and 1");
  }
  if (policy.highRiskLoadFactor <= 0 || policy.highRiskLoadFactor >= 1) {
    throw new DomainValidationError("High-risk load factor must be greater than 0 and less than 1");
  }
  if (!Number.isInteger(policy.repetitionReduction) || policy.repetitionReduction <= 0) {
    throw new DomainValidationError("Repetition reduction must be a positive integer");
  }
}

const roundWeight = (value: number): number => Math.round(value * 1_000) / 1_000;

const baseDetail = (
  prescription: CoachingTrainingPrescription
): Omit<TrainingAdjustmentRecommendationDetail, "action" | "reasonCode" | "suggestedTargetWeightKg" | "suggestedRepsMin" | "suggestedRepsMax"> => ({
  programId: prescription.programId,
  programVersionId: prescription.programVersionId,
  workoutPosition: prescription.workoutPosition,
  prescriptionPosition: prescription.prescriptionPosition,
  exerciseId: prescription.exerciseId,
  exerciseVersionId: prescription.exerciseVersionId,
  currentTargetWeightKg: prescription.targetWeightKg,
  currentRepsMin: prescription.targetRepsMin,
  currentRepsMax: prescription.targetRepsMax
});

/**
 * Produces one explainable one-parameter adjustment without mutating Training.
 */
export function evaluateTrainingAdjustment(
  policy: CoachingPolicyParameters,
  recovery: CoachingRecoveryEvidence,
  prescription: CoachingTrainingPrescription
): TrainingAdjustmentEvaluation {
  validateCoachingPolicy(policy);
  const base = baseDetail(prescription);
  const hold = (
    reasonCode: "hard_stop" | "low_confidence" | "maintain",
    explanation: string
  ): TrainingAdjustmentEvaluation => ({
    detail: {
      ...base,
      action: "hold",
      reasonCode,
      suggestedTargetWeightKg: null,
      suggestedRepsMin: null,
      suggestedRepsMax: null
    },
    explanation
  });

  if (recovery.hardStop || recovery.riskLevel === "blocked") {
    return hold("hard_stop", "Сохранить назначение без изменений из-за блокирующего сигнала восстановления.");
  }
  if (recovery.confidence < policy.minimumConfidence) {
    return hold("low_confidence", "Сохранить назначение без изменений: уверенность оценки восстановления ниже порога политики.");
  }
  if (recovery.riskLevel === "high" && prescription.targetWeightKg !== null) {
    const suggested = roundWeight(prescription.targetWeightKg * policy.highRiskLoadFactor);
    if (suggested < prescription.targetWeightKg) {
      return {
        detail: {
          ...base,
          action: "target_weight",
          reasonCode: "high_risk",
          currentTargetWeightKg: prescription.targetWeightKg,
          suggestedTargetWeightKg: suggested,
          suggestedRepsMin: null,
          suggestedRepsMax: null
        },
        explanation: "Снизить целевой вес одного назначения из-за высокого риска восстановления."
      };
    }
  }
  if (recovery.riskLevel === "high" || recovery.riskLevel === "moderate") {
    const suggestedMin = Math.max(1, prescription.targetRepsMin - policy.repetitionReduction);
    const suggestedMax = Math.max(suggestedMin, prescription.targetRepsMax - policy.repetitionReduction);
    if (
      suggestedMin !== prescription.targetRepsMin ||
      suggestedMax !== prescription.targetRepsMax
    ) {
      return {
        detail: {
          ...base,
          action: "repetition_range",
          reasonCode: recovery.riskLevel === "high" ? "high_risk" : "moderate_risk",
          suggestedTargetWeightKg: null,
          suggestedRepsMin: suggestedMin,
          suggestedRepsMax: suggestedMax
        },
        explanation: recovery.riskLevel === "high"
          ? "Снизить диапазон повторений одного назначения из-за высокого риска восстановления."
          : "Снизить диапазон повторений одного назначения из-за умеренного риска восстановления."
      };
    }
  }
  return hold("maintain", "Сохранить текущее назначение: оценка восстановления не требует изменения.");
}

/** Projects lifecycle state from immutable facts and the observation time. */
export function deriveCoachingRecommendationState(
  expiresAt: Date,
  decision: { readonly outcome: "accepted" | "rejected" } | null,
  now: Date
): CoachingRecommendationState {
  if (decision) return decision.outcome;
  return now >= expiresAt ? "expired" : "proposed";
}
