import { describe, expect, it } from "vitest";

import type { CounterfactualDailyAssessmentFacts } from "../src/domain/daily-assessment-counterfactual.js";
import { evaluateCounterfactualDailyAssessmentV1 } from "../src/domain/daily-assessment-counterfactual.js";

function facts(overrides: Partial<CounterfactualDailyAssessmentFacts["summary"]> = {}): CounterfactualDailyAssessmentFacts {
  return {
    recoveryObservationIds: [], recoveryAssessmentIds: [], workoutSessionIds: [],
    externalActivityIds: [], mealIds: [], weightMeasurementIds: [],
    coveragePolicyVersion: "profile-data-coverage-v1",
    coverageReadiness: {
      sleep: "good", hrv: "good", restingHeartRate: "good",
      bodyBattery: "good", training: "good", weight: "sparse", nutrition: "sparse"
    },
    summary: {
      recoveryRiskLevel: null, recoveryHardStop: false, sleepMinutes: 480,
      hrvMs: 60, hrvBaselineMs: 60, restingHeartRateBpm: 50,
      restingHeartRateBaselineBpm: 50, bodyBattery: 70,
      bodyBatteryMin: null, bodyBatteryMax: null, recentWorkoutCount: 0,
      recentExternalActivityCount: 0, recentTrainingLoad: null,
      nutritionCompleteness: "complete", mealCount: 0, caloriesKcal: null,
      proteinG: null, latestWeightKg: null, ...overrides
    }
  };
}

describe("daily-assessment-v1 counterfactual envelope", () => {
  it("exposes a recovery decision invariant across program states", () => {
    expect(evaluateCounterfactualDailyAssessmentV1(facts({
      sleepMinutes: 300, hrvMs: 40
    }))).toEqual({
      outcome: "comparable", status: "recovery_priority",
      action: "recovery_first", absoluteGuardrail: true
    });
  });

  it("does not guess when program state changes the action", () => {
    expect(evaluateCounterfactualDailyAssessmentV1(facts())).toEqual({
      outcome: "ambiguous_program_state"
    });
  });

  it("keeps insufficient-data decisions comparable", () => {
    expect(evaluateCounterfactualDailyAssessmentV1(facts({
      sleepMinutes: null, hrvMs: null, restingHeartRateBpm: null, bodyBattery: null
    }))).toMatchObject({
      outcome: "comparable", status: "insufficient_data",
      action: "record_recovery_check_in"
    });
  });
});
