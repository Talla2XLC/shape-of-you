import { createHash } from "node:crypto";

import type {
  DailyCompletionCriterion,
  DailyCompletionCriterionResult,
  DailyCompletionLimitation,
  DailyCompletionReason,
  DailyNextAction,
  DailyNextActionV4,
  DailyRecommendationCompletionState,
  DailyRecommendationEvidenceMode,
  DailyRecommendationFeedbackStatus
} from "@shape-of-you/contracts";

export const DAILY_COMPLETION_POLICY_VERSION = "daily-completion-v1" as const;

function criterion(
  id: string,
  type: DailyCompletionCriterion["type"],
  ownerDomain: DailyCompletionCriterion["ownerDomain"],
  options: Pick<DailyCompletionCriterion, "targetValue" | "trainingProgramVersionId"> = {
    targetValue: null,
    trainingProgramVersionId: null
  }
): DailyCompletionCriterion {
  return {
    id,
    type,
    role: "required",
    ownerDomain,
    observationWindow: "after_recommendation_on_local_date",
    ...options
  };
}

/** Attaches a closed, versioned completion contract to one policy-selected action. */
export function withDailyCompletionSpecification(action: DailyNextAction): DailyNextActionV4 {
  let completionCriterion: DailyCompletionCriterion;
  switch (action.type) {
    case "record_weight":
      completionCriterion = criterion("weight_recorded", "weight_recorded", "weight");
      break;
    case "complete_nutrition_record":
      completionCriterion = criterion("meal_recorded", "meal_recorded", "nutrition");
      break;
    case "follow_active_program":
      completionCriterion = criterion(
        "program_workout_completed",
        "program_workout_completed",
        "training",
        { targetValue: null, trainingProgramVersionId: action.trainingProgramVersionId }
      );
      break;
    case "record_recovery_check_in":
      completionCriterion = criterion(
        "recovery_check_in_recorded",
        "recovery_check_in_recorded",
        "recovery"
      );
      break;
    case "confirm_training_program":
      completionCriterion = criterion(
        "training_program_confirmed",
        "training_program_confirmed",
        "training"
      );
      break;
    case "recovery_first":
      completionCriterion = criterion(
        "manual_confirmation",
        "manual_confirmation",
        "coaching"
      );
      break;
  }
  const result = { ...action, completion: { aggregation: "all_of" as const, criteria: [completionCriterion] } };
  assertDailyCompletionSpecification(result);
  return result;
}

const compatibleCriterion: Record<DailyNextAction["type"], DailyCompletionCriterion["type"]> = {
  record_weight: "weight_recorded",
  complete_nutrition_record: "meal_recorded",
  follow_active_program: "program_workout_completed",
  record_recovery_check_in: "recovery_check_in_recorded",
  confirm_training_program: "training_program_confirmed",
  recovery_first: "manual_confirmation"
};

/** Rejects incompatible or ambiguous action/criterion contracts before persistence. */
export function assertDailyCompletionSpecification(action: DailyNextActionV4): void {
  const required = action.completion.criteria.filter((item) => item.role === "required");
  if (action.completion.aggregation !== "all_of" || required.length === 0) {
    throw new Error("Daily completion requires at least one required all_of criterion");
  }
  if (required.some((item) => item.type !== compatibleCriterion[action.type])) {
    throw new Error(`Completion criterion is incompatible with action ${action.type}`);
  }
  if (action.type === "follow_active_program" && (
    action.trainingProgramVersionId === null ||
    required.some((item) => item.trainingProgramVersionId !== action.trainingProgramVersionId)
  )) {
    throw new Error("Program completion criteria must reference the action program version");
  }
}

export interface DailyCompletionEvaluation {
  readonly completionState: DailyRecommendationCompletionState;
  readonly evidenceMode: DailyRecommendationEvidenceMode;
  readonly reasons: readonly DailyCompletionReason[];
  readonly limitations: readonly DailyCompletionLimitation[];
}

/**
 * Evaluates typed evidence without treating absence as failure. Automatic V1
 * deliberately never derives `not_completed`; only active manual `skipped` can.
 */
export function evaluateDailyRecommendationCompletion(
  criteria: readonly DailyCompletionCriterion[],
  results: readonly DailyCompletionCriterionResult[],
  activeDisposition: "completed" | "skipped" | null
): DailyCompletionEvaluation {
  const requiredCriteria = criteria.filter((item) => item.role === "required");
  const requiredIds = new Set(requiredCriteria.map((item) => item.id));
  const required = results.filter((item) => requiredIds.has(item.criterionId));
  const observedSatisfied = required.filter((item) =>
    item.status === "satisfied" && item.freshness === "fresh" && item.completeness === "complete"
  ).length;
  const hasObserved = required.some((item) => item.status !== "unknown");
  const limitations = [...new Set(results.flatMap((item) => item.limitations))];

  if (activeDisposition === "skipped") {
    const conflict = requiredCriteria.length > 0 && observedSatisfied === requiredCriteria.length;
    return {
      completionState: "not_completed",
      evidenceMode: "self_reported",
      reasons: ["manual_skipped"],
      limitations: conflict
        ? [...new Set([...limitations, "self_report_conflicts_with_observation" as const])]
        : limitations
    };
  }
  if (activeDisposition === "completed") {
    const conflict = hasObserved && observedSatisfied < required.length;
    return {
      completionState: "completed",
      evidenceMode: "self_reported",
      reasons: ["manual_completed"],
      limitations: conflict
        ? [...new Set([...limitations, "self_report_conflicts_with_observation" as const])]
        : limitations
    };
  }
  if (requiredCriteria.length > 0 && observedSatisfied === requiredCriteria.length) {
    return { completionState: "completed", evidenceMode: "observed", reasons: ["all_required_criteria_observed"], limitations };
  }
  if (hasObserved) {
    return { completionState: "partially_completed", evidenceMode: "partially_observed", reasons: ["some_required_criteria_observed"], limitations };
  }
  return {
    completionState: "unknown",
    evidenceMode: "unknown",
    reasons: ["insufficient_evidence"],
    limitations: [...new Set([...limitations, "source_unknown" as const])]
  };
}

/** Stable identity for one immutable assessment over exact criteria, evidence and feedback. */
export function dailyCompletionEvidenceChecksum(input: {
  readonly snapshotId: string;
  readonly criteria: readonly DailyCompletionCriterion[];
  readonly results: readonly DailyCompletionCriterionResult[];
  readonly activeFeedback: { readonly id: string; readonly status: DailyRecommendationFeedbackStatus } | null;
}): string {
  return createHash("sha256").update(JSON.stringify({
    completionPolicyVersion: DAILY_COMPLETION_POLICY_VERSION,
    ...input
  })).digest("hex");
}
