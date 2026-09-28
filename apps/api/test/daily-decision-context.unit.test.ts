import { describe, expect, it, vi } from "vitest";
import { Ajv } from "ajv";
import addFormats from "ajv-formats";

import { DailyDecisionContextResultSchema } from "@shape-of-you/contracts";
import { DailyDecisionContextService } from "../src/coaching/daily-decision-context.service.js";
import { DailyAssessmentEvidenceChangedError } from "../src/domain/errors.js";

const localDate = "2026-09-28";
const timezone = "Europe/Belgrade";
const step = {
  state: "training_options",
  policyVersion: "training-next-step-v4",
  localDate,
  weeklyProgress: { strengthCompleted: 0, strengthTarget: 3, cardioCompleted: 0, cardioTarget: 2 },
  lastStrengthLocalDate: "2026-09-25",
  lastCardioThisWeekLocalDate: null,
  strength: {
    programVersionId: "00000000-0000-4000-8000-000000000101",
    workoutPosition: 2,
    workoutName: "Ahilej B",
    reason: "sequence_continues"
  },
  lightCardio: {
    durationSeconds: 2400, targetAverageHeartRateMin: 135,
    targetAverageHeartRateMax: 145, warmupSeconds: 300, workSeconds: 1800,
    cooldownSeconds: 300
  }
};
const assessment = {
  state: "available",
  policyVersion: "daily-assessment-v6",
  snapshotId: "00000000-0000-4000-8000-000000000110",
  evidenceChecksum: "a".repeat(64),
  localDate, timezone,
  status: "recovery_priority",
  recommendedAction: { type: "recovery_first", text: "Legacy decision" },
  usedFacts: {
    activeTrainingProgramVersionId: "00000000-0000-4000-8000-000000000101",
    trainingNextStep: step,
    coverageReadiness: {
      sleep: "partial", hrv: "sparse", restingHeartRate: "partial",
      bodyBattery: "sparse", training: "good", weight: "partial", nutrition: "partial"
    },
    trainingDensity: {
      from: "2026-09-23", to: "2026-09-27", completedDayCount: 1,
      qualifyingLocalDates: ["2026-09-25"]
    },
    wellbeingSignals: [{
      observationId: "00000000-0000-4000-8000-000000000111",
      signal: "injury_concern"
    }],
    summary: {
      recoveryRiskLevel: "blocked", recoveryHardStop: true,
      sleepMinutes: 390, hrvMs: null, hrvBaselineMs: null,
      restingHeartRateBpm: 61, restingHeartRateBaselineBpm: 58,
      bodyBattery: null, bodyBatteryMin: null, bodyBatteryMax: null,
      recentWorkoutCount: 1, recentExternalActivityCount: 0, recentTrainingLoad: 45,
      nutritionCompleteness: "partial", mealCount: 2, caloriesKcal: null,
      proteinG: null, latestWeightKg: 77.2
    }
  },
  personalBaseline: {
    policyKey: "balanced", policyVersion: "personal-baseline-v2", status: "partial",
    summary: "Limited history",
    comparisons: [
      "sleep_minutes", "hrv_rmssd", "resting_heart_rate", "body_battery",
      "body_battery_min", "body_battery_max", "training_load", "steps"
    ].map((metric) => ({
      metric, availability: "insufficient_history", position: null, severity: null,
      eligibleDayCount: 1, method: null
    }))
  },
  movement: { status: "unavailable", summary: null, current: null }
};
const recovery = {
  state: "available", policyVersion: "connected-recovery-freshness-v2",
  calculatedAt: "2026-09-28T08:00:00.000Z", localDate, timezone,
  syncState: "never_checked", targetDateDelivery: "unknown", checkedAt: null,
  metricDelivery: [
    "sleep", "sleep_score", "resting_heart_rate", "night_heart_rate", "hrv_rmssd",
    "oxygen_saturation", "respiration_rate", "body_battery_min", "body_battery_max", "steps"
  ].map((metric) => ({ metric, state: "unknown", periodState: null, asOf: null })),
  observations: { items: [{
    kind: "subjective", sourceChannel: "manual", observedFrom: null, observedUntil: null,
    temporalPrecision: "local_date", localDate, timezone, quality: "reliable",
    detail: { type: "subjective", signal: "injury_concern" }
  }] }
};
const training = {
  status: "active",
  program: { activeVersionId: "00000000-0000-4000-8000-000000000101" },
  nextStep: step
};

function fixture() {
  const summary = Object.fromEntries(Object.entries(assessment.usedFacts.summary).filter(
    ([key]) => key !== "recoveryRiskLevel" && key !== "recoveryHardStop"
  ));
  const daily = {
    read: vi.fn(),
    readDecisionFacts: vi.fn().mockResolvedValue({
      state: "available", localDate, timezone,
      evidenceChecksum: assessment.evidenceChecksum,
      activeTrainingProgramVersionId: assessment.usedFacts.activeTrainingProgramVersionId,
      trainingNextStep: step,
      facts: {
        summary,
        coverageReadiness: assessment.usedFacts.coverageReadiness,
        trainingDensity: assessment.usedFacts.trainingDensity,
        wellbeingSignals: assessment.usedFacts.wellbeingSignals,
        personalBaseline: assessment.personalBaseline,
        movement: assessment.movement
      }
    })
  };
  const currentRecovery = { read: vi.fn().mockResolvedValue(recovery) };
  const trainingService = { getTrainingContext: vi.fn().mockResolvedValue(training) };
  return {
    daily, currentRecovery, trainingService,
    service: new DailyDecisionContextService(daily as never, currentRecovery as never, trainingService as never)
  };
}

describe("daily decision context", () => {
  it("exposes explicit injury concern and exact B/cardio options without the legacy decision", async () => {
    const { service, trainingService, daily } = fixture();
    const result = await service.read();
    expect(result).toMatchObject({
      state: "available", policyVersion: "daily-decision-context-v1",
      facts: { wellbeingSignals: [{ signal: "injury_concern" }] },
      recovery: { observations: { items: [{ detail: { signal: "injury_concern" } }] } },
      training: { nextStep: { strength: { workoutName: "Ahilej B" }, lightCardio: expect.any(Object) } }
    });
    expect(result).not.toHaveProperty("status");
    expect(result).not.toHaveProperty("recommendedAction");
    expect(result).not.toHaveProperty("alternatives");
    if (result.state !== "available") throw new Error("Expected available context");
    expect(result.facts.summary).not.toHaveProperty("recoveryHardStop");
    expect(result.facts.summary).not.toHaveProperty("recoveryRiskLevel");
    expect(trainingService.getTrainingContext).toHaveBeenCalledWith({ localDate, historyLimit: 20 });
    expect(daily.read).not.toHaveBeenCalled();
  });

  it("preserves timezone absence without inventing a local day", async () => {
    const { service, daily, currentRecovery } = fixture();
    daily.readDecisionFacts.mockResolvedValue({ state: "timezone_required", timezone: null });
    expect(await service.read()).toEqual({ state: "timezone_required", timezone: null });
    expect(currentRecovery.read).not.toHaveBeenCalled();
  });

  it("fails closed after repeated date mismatch or changed owner evidence", async () => {
    const { service, daily, currentRecovery } = fixture();
    currentRecovery.read.mockResolvedValue({ ...recovery, localDate: "2026-09-27" });
    await expect(service.read()).rejects.toBeInstanceOf(DailyAssessmentEvidenceChangedError);
    expect(daily.readDecisionFacts).toHaveBeenCalledTimes(6);
  });

  it("rejects a changed active program version even when its next step is identical", async () => {
    const { service, daily, trainingService } = fixture();
    trainingService.getTrainingContext.mockResolvedValue({
      ...training,
      program: { activeVersionId: "00000000-0000-4000-8000-000000000102" }
    });
    await expect(service.read()).rejects.toBeInstanceOf(DailyAssessmentEvidenceChangedError);
    expect(daily.readDecisionFacts).toHaveBeenCalledTimes(6);
  });

  it("validates current facts and rejects prescription fields from the public contract", async () => {
    const ajv = new Ajv({ strict: false });
    (addFormats as unknown as (instance: Ajv) => Ajv)(ajv);
    const validate = ajv.compile(DailyDecisionContextResultSchema);
    expect(validate({ state: "timezone_required", timezone: null })).toBe(true);
    expect(validate({ state: "timezone_required", timezone: null, recommendedAction: {} })).toBe(false);
    const available = await fixture().service.read();
    expect(validate(available), JSON.stringify(validate.errors)).toBe(true);
    expect(validate({ ...available, recommendedAction: { type: "recovery_first" } })).toBe(false);
    expect(DailyDecisionContextResultSchema.oneOf[1].properties).not.toHaveProperty("status");
    expect(DailyDecisionContextResultSchema.oneOf[1].properties).not.toHaveProperty("recommendedAction");
  });
});
