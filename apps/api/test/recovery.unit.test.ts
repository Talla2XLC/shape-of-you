import { describe, expect, it } from "vitest";

import type { CreateRecoveryObservation } from "@shape-of-you/contracts";

import {
  evaluateRecovery,
  validateRecoveryObservation,
  type RecoveryPolicyParameters
} from "../src/domain/recovery.js";

const policy: RecoveryPolicyParameters = {
  analysisWindowDays: 7,
  minimumObservations: 2,
  sufficientObservations: 3,
  insufficientConfidenceCap: 0.25,
  poorQualityConfidenceCap: 0.4,
  targetSleepMinutes: 480,
  fatigueWeight: 20,
  sorenessWeight: 15,
  stressWeight: 10,
  lowEnergyWeight: 15,
  lowSleepQualityWeight: 10,
  sleepDeficitWeight: 20,
  externalSetWeight: 1,
  bodyweightSetWeight: 0.5,
  assistedSetWeight: 0.25,
  moderateRiskThreshold: 25,
  highRiskThreshold: 50
};

const manualMetric: CreateRecoveryObservation = {
  kind: "metric",
  observedFrom: "2026-10-25T00:30:00.000Z",
  observedUntil: "2026-10-25T01:30:00.000Z",
  timezone: "Europe/Berlin",
  quality: "reliable",
  connectionId: null,
  consentId: null,
  dedupeKey: "manual:hrv:1",
  sourceReference: {
    channel: "manual",
    externalSystem: null,
    externalRecordId: null,
    occurredAt: "2026-10-25T01:30:00.000Z"
  },
  detail: { type: "metric", metric: "hrv_rmssd", value: 48.2, unit: "ms" }
};

describe("Recovery domain", () => {
  it("derives the local date from the observation-time timezone across DST", () => {
    expect(validateRecoveryObservation(manualMetric).localDate).toBe("2026-10-25");
  });

  it("rejects mismatched detail, units and device ownership references", () => {
    expect(() => validateRecoveryObservation({
      ...manualMetric,
      detail: { type: "metric", metric: "hrv_rmssd", value: 48.2, unit: "bpm" }
    })).toThrow("unit is incompatible");
    expect(() => validateRecoveryObservation({
      ...manualMetric,
      sourceReference: { ...manualMetric.sourceReference, channel: "device" }
    })).toThrow("require connectionId and consentId");
    expect(() => validateRecoveryObservation({
      ...manualMetric,
      kind: "sleep"
    })).toThrow("kind must match");
  });

  it("keeps a wearable sleep score separate from subjective sleep quality", () => {
    expect(validateRecoveryObservation({
      ...manualMetric,
      dedupeKey: "manual:sleep-score:2026-10-25",
      detail: { type: "metric", metric: "sleep_score", value: 86, unit: "score" }
    })).toMatchObject({ localDate: "2026-10-25", temporalPrecision: "instant" });
    expect(() => validateRecoveryObservation({
      ...manualMetric,
      detail: { type: "metric", metric: "sleep_score", value: 86, unit: "bpm" }
    })).toThrow("unit is incompatible");
  });

  it("lets hard stops dominate readiness and caps confidence for poor evidence", () => {
    const result = evaluateRecovery(policy, [{
      id: "subjective-1",
      quality: "poor",
      detail: {
        type: "subjective",
        energy: 5,
        fatigue: 1,
        muscleSoreness: 1,
        stress: 1,
        sleepQuality: 5,
        acuteIllness: true,
        injuryConcern: false
      }
    }], { sessionIds: [], externalSetCount: 0, bodyweightSetCount: 0, assistedSetCount: 0 });

    expect(result).toMatchObject({
      readinessScore: 0,
      riskLevel: "blocked",
      hardStop: true,
      dataQuality: "insufficient",
      confidence: 0.25
    });
  });

  it("keeps incompatible training load bases separate in the snapshot", () => {
    const result = evaluateRecovery(policy, [], {
      sessionIds: ["session-1"],
      externalSetCount: 3,
      bodyweightSetCount: 4,
      assistedSetCount: 8
    });

    expect(result.calculation.trainingComponents).toEqual({
      external: 3,
      bodyweight: 2,
      assisted: 2
    });
    expect(result.calculation.trainingRisk).toBe(7);
  });
});
