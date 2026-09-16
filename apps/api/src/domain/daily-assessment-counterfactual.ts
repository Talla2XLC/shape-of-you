import type { DailyAssessmentUsedFacts, DailyNextActionType } from "@shape-of-you/contracts";

import { evaluateDailyAssessment } from "./daily-assessment.js";

const counterfactualProgramSentinel = "00000000-0000-4000-8000-000000000001";

export type CounterfactualDailyAssessmentFacts = Omit<
  DailyAssessmentUsedFacts,
  "activeTrainingProgramVersionId"
>;

export interface CounterfactualDailyAssessmentEnvelope {
  readonly outcome: "comparable" | "ambiguous_program_state";
  readonly status?: "ready" | "caution" | "recovery_priority" | "insufficient_data";
  readonly action?: DailyNextActionType;
  readonly absoluteGuardrail?: boolean;
}

/**
 * Replays the canonical v1 evaluator across both admissible historical
 * TrainingProgram states. It exposes a decision only when program uncertainty
 * cannot change status or action type.
 */
export function evaluateCounterfactualDailyAssessmentV1(
  facts: CounterfactualDailyAssessmentFacts
): CounterfactualDailyAssessmentEnvelope {
  const absent = evaluateDailyAssessment({
    ...facts,
    activeTrainingProgramVersionId: null
  });
  const present = evaluateDailyAssessment({
    ...facts,
    activeTrainingProgramVersionId: counterfactualProgramSentinel
  });
  if (
    absent.status !== present.status ||
    absent.recommendedAction.type !== present.recommendedAction.type
  ) {
    return { outcome: "ambiguous_program_state" };
  }
  const absoluteReasons = new Set([
    "recovery_hard_stop",
    "short_sleep",
    "low_body_battery",
    "recent_training_load"
  ]);
  return {
    outcome: "comparable",
    status: absent.status,
    action: absent.recommendedAction.type,
    absoluteGuardrail: absent.reasons.some((reason) => absoluteReasons.has(reason))
  };
}
