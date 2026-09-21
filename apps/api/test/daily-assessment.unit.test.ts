import { describe, expect, it, vi } from "vitest";

import type { DailyAssessmentUsedFacts } from "@shape-of-you/contracts";

import {
  dailyAssessmentChecksum,
  dailyAssessmentV2Checksum,
  dailyAssessmentV3Checksum,
  evaluateDailyAssessment
} from "../src/domain/daily-assessment.js";
import {
  DailyAssessmentService,
  derivePersonLocalDate,
  withDailyAssessmentConsistency
} from "../src/coaching/daily-assessment.service.js";
import type { DailyAssessmentStore } from "../src/storage/daily-assessment-repository.js";
import { DailyAssessmentEvidenceChangedError } from "../src/domain/errors.js";

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

  it("keeps V1, V2 and V3 identities independent of operational sync metadata", () => {
    const evidence = facts();
    const calculation = { policy: "personal-baseline-v1", comparisons: [] };
    const movement = { status: "unavailable", current: null };
    const decision = { status: "ready", recommendedAction: { type: "follow_active_program" } };
    const identities = (delivery: { syncState: string; checkedAt: string }) => {
      void delivery;
      return {
        v1: dailyAssessmentChecksum("2026-09-14", "Europe/Moscow", evidence),
        v2: dailyAssessmentV2Checksum(
          "2026-09-14", "Europe/Moscow", evidence, calculation, decision
        ),
        v3: dailyAssessmentV3Checksum(
          "2026-09-14", "Europe/Moscow", evidence, calculation, movement, decision
        ),
        decision: evaluateDailyAssessment(evidence)
      };
    };

    expect(identities({
      syncState: "fresh_success",
      checkedAt: "2026-09-14T08:00:00.000Z"
    })).toEqual(identities({
      syncState: "failed",
      checkedAt: "2026-09-14T08:05:00.000Z"
    }));
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

  it("versions v2 when the selected result changes even with identical evidence", () => {
    const evidence = facts();
    const calculation = { policy: "personal-baseline-v1", comparisons: [] };
    const ready = { status: "ready", recommendedAction: { type: "follow_active_program" } };
    const caution = { status: "caution", recommendedAction: { type: "recovery_first" } };

    expect(dailyAssessmentV2Checksum(
      "2026-09-14", "Europe/Moscow", evidence, calculation, ready
    )).toBe(dailyAssessmentV2Checksum(
      "2026-09-14", "Europe/Moscow", evidence, calculation, ready
    ));
    expect(dailyAssessmentV2Checksum(
      "2026-09-14", "Europe/Moscow", evidence, calculation, ready
    )).not.toBe(dailyAssessmentV2Checksum(
      "2026-09-14", "Europe/Moscow", evidence, calculation, caution
    ));
  });

  it("retries evidence changes exactly three times and then fails closed", async () => {
    let attempts = 0;
    const operation = async () => {
      attempts += 1;
      throw new DailyAssessmentEvidenceChangedError();
    };

    await expect(withDailyAssessmentConsistency(operation)).rejects.toBeInstanceOf(
      DailyAssessmentEvidenceChangedError
    );
    expect(attempts).toBe(3);
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

  it("selects at most one previous recommendation from the immediately prior local date", async () => {
    const previous = {
      state: "available" as const,
      snapshotId: "00000000-0000-4000-8000-000000000122",
      localDate: "2026-09-20",
      timezone: "Europe/Belgrade",
      status: "insufficient_data" as const,
      usedFacts: {
        ...facts(),
        dailyContextNoteIds: []
      },
      missingImportantData: ["nutrition" as const],
      reasons: ["partial_nutrition" as const],
      recommendedAction: {
        type: "complete_nutrition_record" as const,
        text: "Record the next meal after eating.",
        trainingProgramVersionId: null,
        completion: {
          aggregation: "all_of" as const,
          criteria: [{
            id: "meal_recorded",
            type: "meal_recorded" as const,
            role: "required" as const,
            ownerDomain: "nutrition" as const,
            observationWindow: "after_recommendation_on_local_date" as const,
            targetValue: null,
            trainingProgramVersionId: null
          }]
        }
      },
      alternatives: [],
      limitations: ["not_medical_advice" as const],
      confidence: 0.6,
      policyVersion: "daily-assessment-v4" as const,
      personalBaseline: {
        policyKey: "balanced" as const,
        policyVersion: "personal-baseline-v2" as const,
        status: "unavailable" as const,
        summary: "Personal baseline is unavailable.",
        comparisons: []
      },
      movement: { status: "unavailable" as const, summary: "Movement is unavailable.", current: null },
      evidenceChecksum: "b".repeat(64),
      createdAt: "2026-09-20T08:00:00.000Z"
    };
    const store = {
      findLatestV4SnapshotForLocalDate: vi.fn().mockResolvedValue(previous)
    } as unknown as DailyAssessmentStore;
    const service = new DailyAssessmentService(
      store,
      { getPersonId: () => "00000000-0000-4000-8000-000000000001" } as never,
      {} as never,
      {} as never,
      {} as never,
      {} as never,
      {} as never
    );
    vi.spyOn(service, "read").mockResolvedValue({
      ...previous,
      snapshotId: "00000000-0000-4000-8000-000000000123",
      localDate: "2026-09-21",
      createdAt: "2026-09-21T08:00:00.000Z"
    });

    await expect(service.readCoachContext()).resolves.toEqual({
      assessment: expect.objectContaining({ localDate: "2026-09-21" }),
      previousRecommendation: {
        snapshotId: previous.snapshotId,
        localDate: previous.localDate,
        recommendedAction: previous.recommendedAction
      }
    });
    expect(store.findLatestV4SnapshotForLocalDate).toHaveBeenCalledWith(
      "00000000-0000-4000-8000-000000000001",
      "2026-09-20"
    );
  });

  it("does not look for a previous recommendation when timezone is required", async () => {
    const store = {
      findLatestV4SnapshotForLocalDate: vi.fn()
    } as unknown as DailyAssessmentStore;
    const service = new DailyAssessmentService(
      store,
      { getPersonId: () => "00000000-0000-4000-8000-000000000001" } as never,
      {} as never,
      {} as never,
      {} as never,
      {} as never,
      {} as never
    );
    vi.spyOn(service, "read").mockResolvedValue({ state: "timezone_required", timezone: null });

    await expect(service.readCoachContext()).resolves.toEqual({
      assessment: { state: "timezone_required", timezone: null },
      previousRecommendation: null
    });
    expect(store.findLatestV4SnapshotForLocalDate).not.toHaveBeenCalled();
  });
});
