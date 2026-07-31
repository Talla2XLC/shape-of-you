import type {
  CreateRecoveryObservation,
  RecoveryAssessmentDataQuality,
  RecoveryObservationDetail,
  RecoveryObservationQuality,
  RecoveryRiskLevel
} from "@shape-of-you/contracts";

import { DomainValidationError } from "./errors.js";
import { deriveLocalDate } from "./weight-measurement.js";

/** Typed immutable parameters for one assessment policy revision. */
export interface RecoveryPolicyParameters {
  readonly analysisWindowDays: number;
  readonly minimumObservations: number;
  readonly sufficientObservations: number;
  readonly insufficientConfidenceCap: number;
  readonly poorQualityConfidenceCap: number;
  readonly targetSleepMinutes: number;
  readonly fatigueWeight: number;
  readonly sorenessWeight: number;
  readonly stressWeight: number;
  readonly lowEnergyWeight: number;
  readonly lowSleepQualityWeight: number;
  readonly sleepDeficitWeight: number;
  readonly externalSetWeight: number;
  readonly bodyweightSetWeight: number;
  readonly assistedSetWeight: number;
  readonly moderateRiskThreshold: number;
  readonly highRiskThreshold: number;
}

/** Current observation evidence accepted by the deterministic evaluator. */
export interface RecoveryObservationEvidence {
  readonly id: string;
  readonly quality: RecoveryObservationQuality;
  readonly detail: RecoveryObservationDetail;
}

/** Training evidence remains separated by incompatible load basis. */
export interface RecoveryTrainingEvidence {
  readonly sessionIds: readonly string[];
  readonly externalSetCount: number;
  readonly bodyweightSetCount: number;
  readonly assistedSetCount: number;
}

/** Pure calculation result persisted as an immutable assessment snapshot. */
export interface RecoveryEvaluation {
  readonly readinessScore: number;
  readonly riskLevel: RecoveryRiskLevel;
  readonly confidence: number;
  readonly dataQuality: RecoveryAssessmentDataQuality;
  readonly hardStop: boolean;
  readonly calculation: Record<string, unknown>;
}

/**
 * Validates cross-field observation invariants not expressible in JSON Schema.
 *
 * @throws DomainValidationError when time, source, kind or units disagree.
 */
export function validateRecoveryObservation(
  input: CreateRecoveryObservation
): { readonly from: Date; readonly until: Date; readonly localDate: string } {
  const from = new Date(input.observedFrom);
  const until = new Date(input.observedUntil);
  if (Number.isNaN(from.valueOf()) || Number.isNaN(until.valueOf())) {
    throw new DomainValidationError("Recovery observation interval is invalid");
  }
  if (until < from) {
    throw new DomainValidationError("observedUntil cannot precede observedFrom");
  }
  if (input.kind !== input.detail.type) {
    throw new DomainValidationError("Observation kind must match its typed detail");
  }
  const device = input.sourceReference.channel === "device";
  if (device !== (input.connectionId !== null && input.consentId !== null)) {
    throw new DomainValidationError(
      "Device observations require connectionId and consentId; other sources forbid them"
    );
  }
  if (
    input.detail.type === "metric" &&
    ((input.detail.metric === "hrv_rmssd" && input.detail.unit !== "ms") ||
      (input.detail.metric === "resting_heart_rate" && input.detail.unit !== "bpm"))
  ) {
    throw new DomainValidationError("Recovery metric unit is incompatible");
  }
  return {
    from,
    until,
    localDate: deriveLocalDate(until, input.timezone)
  };
}

const round = (value: number, digits = 3): number => {
  const factor = 10 ** digits;
  return Math.round(value * factor) / factor;
};

/**
 * Evaluates recovery evidence with no hidden defaults or domain mutation.
 *
 * The function is a product heuristic, not a medical diagnosis. Every weight
 * comes from the immutable policy revision supplied by the caller.
 */
export function evaluateRecovery(
  policy: RecoveryPolicyParameters,
  observations: readonly RecoveryObservationEvidence[],
  training: RecoveryTrainingEvidence
): RecoveryEvaluation {
  const subjective = [...observations]
    .reverse()
    .find((item) => item.detail.type === "subjective")?.detail;
  const sleep = [...observations]
    .reverse()
    .find((item) => item.detail.type === "sleep")?.detail;

  const subjectiveRisk =
    subjective?.type === "subjective"
      ? ((subjective.fatigue - 1) / 4) * policy.fatigueWeight +
        ((subjective.muscleSoreness - 1) / 4) * policy.sorenessWeight +
        ((subjective.stress - 1) / 4) * policy.stressWeight +
        ((5 - subjective.energy) / 4) * policy.lowEnergyWeight +
        ((5 - subjective.sleepQuality) / 4) * policy.lowSleepQualityWeight
      : 0;
  const sleepRisk =
    sleep?.type === "sleep"
      ? Math.max(
          0,
          (policy.targetSleepMinutes - sleep.totalSleepMinutes) /
            policy.targetSleepMinutes
        ) * policy.sleepDeficitWeight
      : 0;
  const trainingComponents = {
    external: training.externalSetCount * policy.externalSetWeight,
    bodyweight: training.bodyweightSetCount * policy.bodyweightSetWeight,
    assisted: training.assistedSetCount * policy.assistedSetWeight
  };
  const trainingRisk =
    trainingComponents.external +
    trainingComponents.bodyweight +
    trainingComponents.assisted;
  const hardStop =
    subjective?.type === "subjective" &&
    (subjective.acuteIllness || subjective.injuryConcern);
  const riskScore = Math.max(
    0,
    Math.min(100, subjectiveRisk + sleepRisk + trainingRisk)
  );
  const readinessScore = hardStop ? 0 : Math.max(0, 100 - riskScore);
  const riskLevel: RecoveryRiskLevel = hardStop
    ? "blocked"
    : riskScore >= policy.highRiskThreshold
      ? "high"
      : riskScore >= policy.moderateRiskThreshold
        ? "moderate"
        : "low";

  const count = observations.length;
  const hasPoor = observations.some((item) => item.quality === "poor");
  const dataQuality: RecoveryAssessmentDataQuality =
    count < policy.minimumObservations
      ? "insufficient"
      : count < policy.sufficientObservations || hasPoor
        ? "limited"
        : "sufficient";
  let confidence = Math.min(1, count / policy.sufficientObservations);
  if (dataQuality === "insufficient") {
    confidence = Math.min(confidence, policy.insufficientConfidenceCap);
  }
  if (hasPoor) {
    confidence = Math.min(confidence, policy.poorQualityConfidenceCap);
  }

  return {
    readinessScore: round(readinessScore),
    riskLevel,
    confidence: round(confidence),
    dataQuality,
    hardStop,
    calculation: {
      observationCount: count,
      subjectiveRisk: round(subjectiveRisk),
      sleepRisk: round(sleepRisk),
      trainingRisk: round(trainingRisk),
      trainingComponents,
      totalRisk: round(riskScore),
      hardStopReasons:
        subjective?.type === "subjective"
          ? [
              ...(subjective.acuteIllness ? ["acute_illness"] : []),
              ...(subjective.injuryConcern ? ["injury_concern"] : [])
            ]
          : []
    }
  };
}
