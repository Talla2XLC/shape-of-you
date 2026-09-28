import { describe, expect, it } from "vitest";

import type { DailyCompletionCriterion, DailyCompletionCriterionResult } from "@shape-of-you/contracts";
import {
  evaluateDailyRecommendationCompletion,
  withDailyCompletionSpecification
} from "../src/domain/daily-recommendation-completion.js";
import { evaluateCompletionCriterion } from "../src/coaching/daily-assessment.service.js";

const criterion: DailyCompletionCriterion = {
  id: "meal_recorded",
  type: "meal_recorded",
  role: "required",
  ownerDomain: "nutrition",
  observationWindow: "after_recommendation_on_local_date",
  targetValue: null,
  trainingProgramVersionId: null
};

function result(status: DailyCompletionCriterionResult["status"]): DailyCompletionCriterionResult {
  return {
    criterionId: criterion.id,
    status,
    freshness: status === "unknown" ? "unknown" : "fresh",
    completeness: status === "satisfied" ? "complete" : status === "partial" ? "partial" : "unknown",
    observedAt: status === "unknown" ? null : "2026-09-21T10:00:00.000Z",
    evidence: status === "unknown" ? null : {
      ownerDomain: "nutrition",
      factType: "meal",
      factId: "00000000-0000-4000-8000-000000000001"
    },
    limitations: status === "partial" ? ["source_partial"] : []
  };
}

describe("daily recommendation completion policy", () => {
  it("maps each current daily action to one atomic criterion", () => {
    expect(withDailyCompletionSpecification({
      type: "record_weight", text: "Record weight", trainingProgramVersionId: null
    }).completion.criteria).toEqual([expect.objectContaining({
      type: "weight_recorded", ownerDomain: "weight", role: "required"
    })]);
    expect(withDailyCompletionSpecification({
      type: "recovery_first", text: "Recover", trainingProgramVersionId: null
    }).completion.criteria[0]?.type).toBe("manual_confirmation");
  });

  it("requires confirmation for an unrecorded Coach choice and observes a sole permitted option", () => {
    const programVersionId = "00000000-0000-4000-8000-000000000201";
    const action = { type: "follow_active_program" as const, text: "Choose training", trainingProgramVersionId: programVersionId };
    const step = {
      state: "training_options" as const, policyVersion: "training-next-step-v4" as const,
      localDate: "2026-09-28",
      weeklyProgress: { strengthCompleted: 0, strengthTarget: 3, cardioCompleted: 0, cardioTarget: 2 },
      lastStrengthLocalDate: "2026-09-25", lastCardioThisWeekLocalDate: null,
      strength: { programVersionId, workoutPosition: 2, workoutName: "B", reason: "sequence_continues" as const },
      lightCardio: { durationSeconds: 2400, targetAverageHeartRateMin: 135,
        targetAverageHeartRateMax: 145, warmupSeconds: 300, workSeconds: 1800, cooldownSeconds: 300 }
    };
    expect(withDailyCompletionSpecification(action, step).completion.criteria[0]?.type)
      .toBe("manual_confirmation");
    expect(withDailyCompletionSpecification(action, { ...step, lightCardio: null }).completion.criteria[0]?.type)
      .toBe("program_workout_completed");
    expect(withDailyCompletionSpecification(action, { ...step, strength: null }).completion.criteria[0]?.type)
      .toBe("light_cardio_completed");
  });

  it("observes sole-cardio completion only from an uncovered qualifying activity", () => {
    const programVersionId = "00000000-0000-4000-8000-000000000201";
    const step = {
      state: "training_options" as const, policyVersion: "training-next-step-v4" as const,
      localDate: "2026-09-28",
      weeklyProgress: { strengthCompleted: 3, strengthTarget: 3, cardioCompleted: 1, cardioTarget: 2 },
      lastStrengthLocalDate: "2026-09-25", lastCardioThisWeekLocalDate: "2026-09-27",
      strength: null,
      lightCardio: { durationSeconds: 2400, targetAverageHeartRateMin: 135,
        targetAverageHeartRateMax: 145, warmupSeconds: 300, workSeconds: 1800, cooldownSeconds: 300 }
    };
    const criterion = withDailyCompletionSpecification({
      type: "follow_active_program", text: "Cardio", trainingProgramVersionId: programVersionId
    }, step).completion.criteria[0]!;
    const activity = {
      id: "00000000-0000-4000-8000-000000000202",
      occurredAt: "2026-09-28T07:00:00.000Z", localDate: "2026-09-28",
      durationSeconds: 2400, distanceMeters: 5000, averageHeartRate: 140,
      sessionCovered: false, classification: null
    };
    const input = { localDate: "2026-09-28", weights: [], meals: [], sessions: [], observations: [],
      training: { status: "absent" }, activities: [activity], trainingNextStep: step };
    const observed = evaluateCompletionCriterion(criterion, "2026-09-28T06:00:00.000Z", input as never);
    expect(observed).toMatchObject({ status: "satisfied", evidence: { factType: "external_activity", factId: activity.id } });
    expect(evaluateCompletionCriterion(criterion, "2026-09-28T06:00:00.000Z", {
      ...input, activities: [{ ...activity, sessionCovered: true }]
    } as never).status).toBe("unknown");
    expect(evaluateCompletionCriterion(criterion, "2026-09-28T06:00:00.000Z", {
      ...input, activities: [{ ...activity, classification: { classification: { kind: "program_workout" } } }]
    } as never).status).toBe("unknown");
    expect(evaluateCompletionCriterion(criterion, "2026-09-28T08:00:00.000Z", input as never).status)
      .toBe("unknown");
  });

  it("requires the exact eligible A/B position for sole-strength completion", () => {
    const programVersionId = "00000000-0000-4000-8000-000000000201";
    const step = {
      state: "training_options" as const, policyVersion: "training-next-step-v4" as const,
      localDate: "2026-09-28",
      weeklyProgress: { strengthCompleted: 0, strengthTarget: 3, cardioCompleted: 2, cardioTarget: 2 },
      lastStrengthLocalDate: "2026-09-25", lastCardioThisWeekLocalDate: "2026-09-27",
      strength: { programVersionId, workoutPosition: 2, workoutName: "B", reason: "sequence_continues" as const },
      lightCardio: null
    };
    const criterion = withDailyCompletionSpecification({
      type: "follow_active_program", text: "B", trainingProgramVersionId: programVersionId
    }, step).completion.criteria[0]!;
    const session = { id: "00000000-0000-4000-8000-000000000203",
      createdAt: "2026-09-28T07:00:00.000Z", occurredAt: "2026-09-28T06:00:00.000Z",
      programVersionId, programWorkoutPosition: 1 };
    const input = { localDate: "2026-09-28", weights: [], meals: [], sessions: [session],
      observations: [], training: { recentExternalActivities: [] }, activities: [], trainingNextStep: step };
    expect(evaluateCompletionCriterion(criterion, "2026-09-28T05:00:00.000Z", input as never).status)
      .toBe("unknown");
    expect(evaluateCompletionCriterion(criterion, "2026-09-28T05:00:00.000Z", {
      ...input, sessions: [{ ...session, programWorkoutPosition: 2 }]
    } as never).status).toBe("satisfied");
  });

  it("rejects action and criterion combinations outside the closed mapping", async () => {
    const { assertDailyCompletionSpecification } = await import("../src/domain/daily-recommendation-completion.js");
    expect(() => assertDailyCompletionSpecification({
      type: "record_weight",
      text: "Record weight",
      trainingProgramVersionId: null,
      completion: { aggregation: "all_of", criteria: [criterion] }
    })).toThrow("incompatible");
  });

  it("treats missing evidence as unknown rather than failure", () => {
    expect(evaluateDailyRecommendationCompletion([criterion], [result("unknown")], null)).toEqual({
      completionState: "unknown",
      evidenceMode: "unknown",
      reasons: ["insufficient_evidence"],
      limitations: ["source_unknown"]
    });
  });

  it("keeps completion state independent from evidence mode", () => {
    expect(evaluateDailyRecommendationCompletion([criterion], [result("satisfied")], null))
      .toMatchObject({ completionState: "completed", evidenceMode: "observed" });
    expect(evaluateDailyRecommendationCompletion([criterion], [result("unknown")], "completed"))
      .toMatchObject({ completionState: "completed", evidenceMode: "self_reported" });
  });

  it("only manual skipped produces not_completed in V1", () => {
    expect(evaluateDailyRecommendationCompletion([criterion], [result("partial")], null).completionState)
      .toBe("partially_completed");
    expect(evaluateDailyRecommendationCompletion([criterion], [result("unknown")], "skipped"))
      .toMatchObject({ completionState: "not_completed", evidenceMode: "self_reported" });
  });

  it("keeps a skipped report visibly in conflict with fully observed completion", () => {
    expect(evaluateDailyRecommendationCompletion([criterion], [result("satisfied")], "skipped"))
      .toMatchObject({
        completionState: "not_completed",
        evidenceMode: "self_reported",
        limitations: ["self_report_conflicts_with_observation"]
      });
  });

  it("does not promote incomplete positive evidence to fully observed", () => {
    const incomplete = { ...result("satisfied"), completeness: "partial" as const, limitations: ["source_partial" as const] };
    expect(evaluateDailyRecommendationCompletion([criterion], [incomplete], null)).toMatchObject({
      completionState: "partially_completed",
      evidenceMode: "partially_observed",
      limitations: ["source_partial"]
    });
  });
});
