import { describe, expect, it } from "vitest";

import type { DailyCompletionCriterion, DailyCompletionCriterionResult } from "@shape-of-you/contracts";
import {
  evaluateDailyRecommendationCompletion,
  withDailyCompletionSpecification
} from "../src/domain/daily-recommendation-completion.js";

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

  it("does not promote incomplete positive evidence to fully observed", () => {
    const incomplete = { ...result("satisfied"), completeness: "partial" as const, limitations: ["source_partial" as const] };
    expect(evaluateDailyRecommendationCompletion([criterion], [incomplete], null)).toMatchObject({
      completionState: "partially_completed",
      evidenceMode: "partially_observed",
      limitations: ["source_partial"]
    });
  });
});
