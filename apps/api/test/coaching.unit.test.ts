import { describe, expect, it } from "vitest";

import {
  deriveCoachingRecommendationState,
  evaluateTrainingAdjustment,
  type CoachingPolicyParameters,
  type CoachingTrainingPrescription
} from "../src/domain/coaching.js";

const policy: CoachingPolicyParameters = {
  recommendationTtlMinutes: 120,
  minimumConfidence: 0.6,
  highRiskLoadFactor: 0.8,
  repetitionReduction: 2
};

const prescription: CoachingTrainingPrescription = {
  programId: "00000000-0000-4000-8000-000000000001",
  programVersionId: "00000000-0000-4000-8000-000000000002",
  workoutPosition: 1,
  prescriptionPosition: 1,
  exerciseId: "00000000-0000-4000-8000-000000000003",
  exerciseVersionId: "00000000-0000-4000-8000-000000000004",
  targetWeightKg: 100,
  targetRepsMin: 8,
  targetRepsMax: 12
};

describe("Coaching domain", () => {
  it("lets a hard stop dominate and recommends no parameter change", () => {
    const result = evaluateTrainingAdjustment(
      policy,
      { riskLevel: "blocked", confidence: 1, hardStop: true },
      prescription
    );

    expect(result.detail).toMatchObject({
      action: "hold",
      reasonCode: "hard_stop",
      suggestedTargetWeightKg: null,
      suggestedRepsMin: null,
      suggestedRepsMax: null
    });
  });

  it("holds when assessment confidence is below the policy threshold", () => {
    expect(evaluateTrainingAdjustment(
      policy,
      { riskLevel: "high", confidence: 0.5, hardStop: false },
      prescription
    ).detail).toMatchObject({ action: "hold", reasonCode: "low_confidence" });
  });

  it("changes only target weight for a high-risk weighted prescription", () => {
    const detail = evaluateTrainingAdjustment(
      policy,
      { riskLevel: "high", confidence: 0.9, hardStop: false },
      prescription
    ).detail;

    expect(detail).toMatchObject({
      action: "target_weight",
      currentTargetWeightKg: 100,
      suggestedTargetWeightKg: 80,
      suggestedRepsMin: null,
      suggestedRepsMax: null
    });
  });

  it("changes only repetition range for moderate risk", () => {
    const detail = evaluateTrainingAdjustment(
      policy,
      { riskLevel: "moderate", confidence: 0.9, hardStop: false },
      prescription
    ).detail;

    expect(detail).toMatchObject({
      action: "repetition_range",
      suggestedTargetWeightKg: null,
      suggestedRepsMin: 6,
      suggestedRepsMax: 10
    });
  });

  it("derives expiration only while no terminal decision exists", () => {
    const expiresAt = new Date("2026-07-31T12:00:00.000Z");
    expect(deriveCoachingRecommendationState(expiresAt, null, new Date("2026-07-31T11:59:59.000Z"))).toBe("proposed");
    expect(deriveCoachingRecommendationState(expiresAt, null, expiresAt)).toBe("expired");
    expect(deriveCoachingRecommendationState(expiresAt, { outcome: "accepted" }, new Date("2027-01-01T00:00:00.000Z"))).toBe("accepted");
  });
});
