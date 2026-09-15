import { describe, expect, it } from "vitest";

import type { DailyAssessmentUsedFacts } from "@shape-of-you/contracts";

import {
  dailyAssessmentChecksum,
  evaluateDailyAssessment
} from "../src/domain/daily-assessment.js";
import { derivePersonLocalDate } from "../src/coaching/daily-assessment.service.js";

const programVersionId = "00000000-0000-4000-8000-000000000101";

function facts(
  overrides: Partial<DailyAssessmentUsedFacts["summary"]> = {}
): DailyAssessmentUsedFacts {
  return {
    recoveryObservationIds: ["00000000-0000-4000-8000-000000000001"],
    recoveryAssessmentIds: [],
    workoutSessionIds: ["00000000-0000-4000-8000-000000000002"],
    externalActivityIds: [],
    mealIds: ["00000000-0000-4000-8000-000000000003"],
    weightMeasurementIds: ["00000000-0000-4000-8000-000000000004"],
    activeTrainingProgramVersionId: programVersionId,
    coveragePolicyVersion: "profile-data-coverage-v1",
    coverageReadiness: {
      sleep: "good", hrv: "good", restingHeartRate: "good", bodyBattery: "good",
      training: "good", weight: "good", nutrition: "good"
    },
    summary: {
      recoveryRiskLevel: "low",
      recoveryHardStop: false,
      sleepMinutes: 480,
      hrvMs: 55,
      hrvBaselineMs: 52,
      restingHeartRateBpm: 56,
      restingHeartRateBaselineBpm: 57,
      bodyBattery: 72,
      bodyBatteryMin: 24,
      bodyBatteryMax: 76,
      recentWorkoutCount: 1,
      recentExternalActivityCount: 0,
      recentTrainingLoad: 45,
      nutritionCompleteness: "complete",
      mealCount: 2,
      caloriesKcal: 1_350,
      proteinG: 92,
      latestWeightKg: 77.2,
      ...overrides
    }
  };
}

describe("daily assessment policy", () => {
  it("returns the same decision and checksum for the same typed evidence", () => {
    const evidence = facts();

    expect(evaluateDailyAssessment(evidence)).toEqual(evaluateDailyAssessment(evidence));
    expect(dailyAssessmentChecksum("2026-09-14", "Europe/Moscow", evidence))
      .toBe(dailyAssessmentChecksum("2026-09-14", "Europe/Moscow", evidence));
  });

  it("lets a Recovery hard stop dominate every training signal", () => {
    const result = evaluateDailyAssessment(facts({ recoveryRiskLevel: "blocked", recoveryHardStop: true }));

    expect(result.status).toBe("recovery_priority");
    expect(result.recommendedAction.type).toBe("recovery_first");
    expect(result.alternatives).not.toContainEqual(expect.objectContaining({ type: "follow_active_program" }));
  });

  it("reports sparse recovery evidence instead of inventing readiness", () => {
    const result = evaluateDailyAssessment(facts({
      recoveryRiskLevel: null,
      sleepMinutes: null,
      hrvMs: null,
      restingHeartRateBpm: null,
      bodyBattery: null,
      bodyBatteryMin: null,
      bodyBatteryMax: null
    }));

    expect(result.status).toBe("insufficient_data");
    expect(result.missingImportantData).toEqual(expect.arrayContaining([
      "sleep", "hrv", "resting_heart_rate", "body_battery"
    ]));
    expect(result.recommendedAction.type).toBe("record_recovery_check_in");
  });

  it("references the active immutable program when readiness permits training", () => {
    const result = evaluateDailyAssessment(facts());

    expect(result.status).toBe("ready");
    expect(result.recommendedAction).toMatchObject({
      type: "follow_active_program",
      trainingProgramVersionId: programVersionId
    });
  });

  it("changes the evidence version after a corrected fact", () => {
    expect(dailyAssessmentChecksum("2026-09-14", "Europe/Moscow", facts({ sleepMinutes: 480 })))
      .not.toBe(dailyAssessmentChecksum("2026-09-14", "Europe/Moscow", facts({ sleepMinutes: 330 })));
  });

  it.each([
    ["Recovery", (value: DailyAssessmentUsedFacts) => ({ ...value, recoveryObservationIds: [...value.recoveryObservationIds, "00000000-0000-4000-8000-000000000011"] })],
    ["Training session", (value: DailyAssessmentUsedFacts) => ({ ...value, workoutSessionIds: [...value.workoutSessionIds, "00000000-0000-4000-8000-000000000012"] })],
    ["external activity", (value: DailyAssessmentUsedFacts) => ({ ...value, externalActivityIds: ["00000000-0000-4000-8000-000000000013"] })],
    ["TrainingProgram version", (value: DailyAssessmentUsedFacts) => ({ ...value, activeTrainingProgramVersionId: "00000000-0000-4000-8000-000000000014" })],
    ["Nutrition", (value: DailyAssessmentUsedFacts) => ({ ...value, mealIds: [...value.mealIds, "00000000-0000-4000-8000-000000000015"] })],
    ["Weight", (value: DailyAssessmentUsedFacts) => ({ ...value, weightMeasurementIds: [...value.weightMeasurementIds, "00000000-0000-4000-8000-000000000016"] })]
  ] as const)("versions the snapshot after a late or corrected %s fact", (_label, mutate) => {
    const before = facts();
    const after = mutate(before);
    expect(dailyAssessmentChecksum("2026-09-14", "Europe/Moscow", after))
      .not.toBe(dailyAssessmentChecksum("2026-09-14", "Europe/Moscow", before));
  });

  it("returns to the original evidence identity after an A-B-A correction", () => {
    const versionA = facts({ sleepMinutes: 480 });
    const versionB = facts({ sleepMinutes: 330 });
    const restoredA = facts({ sleepMinutes: 480 });
    expect(dailyAssessmentChecksum("2026-09-14", "Europe/Moscow", versionB))
      .not.toBe(dailyAssessmentChecksum("2026-09-14", "Europe/Moscow", versionA));
    expect(dailyAssessmentChecksum("2026-09-14", "Europe/Moscow", restoredA))
      .toBe(dailyAssessmentChecksum("2026-09-14", "Europe/Moscow", versionA));
  });

  it("derives the Person-local day across DST without using the server timezone", () => {
    expect(derivePersonLocalDate("America/New_York", new Date("2026-03-08T04:30:00.000Z")))
      .toBe("2026-03-07");
    expect(derivePersonLocalDate("America/New_York", new Date("2026-03-08T07:30:00.000Z")))
      .toBe("2026-03-08");
  });

  it("rolls the assessment date at midnight in the Person timezone", () => {
    expect(derivePersonLocalDate("Europe/Moscow", new Date("2026-09-14T20:59:59.999Z")))
      .toBe("2026-09-14");
    expect(derivePersonLocalDate("Europe/Moscow", new Date("2026-09-14T21:00:00.000Z")))
      .toBe("2026-09-15");
  });
});
