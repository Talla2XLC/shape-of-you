import {
  activePersonalBaselinePolicy,
  activePersonalBaselineV2Policy,
  personalBaselineCandidates,
  personalBaselineMetrics,
  type PersonalBaselineMetric,
  type PersonalBaselinePolicy
} from "../domain/personal-baseline.js";
import { applyConservativePersonalOverlay } from "../domain/daily-assessment-personal-overlay.js";
import {
  evaluatePersonalizedDailyAssessmentWithPolicy,
  type PersonalAssessmentEvidenceDay
} from "../domain/personalized-daily-assessment.js";

/** Provider-neutral evidence for one Person-local day in a shadow evaluation. */
export interface RetrospectiveDailyEvidence {
  readonly localDate: string;
  readonly values: Readonly<Partial<Record<PersonalBaselineMetric, number>>>;
  readonly acuteIllness: boolean;
  readonly injuryConcern: boolean;
  readonly recoveryAssessmentPresent: boolean;
  readonly recoveryHardStop: boolean;
  readonly baselineExcluded: boolean;
  readonly trainingLoadIncompatible: boolean;
  readonly trainingLoadSeriesKey: string | null;
  readonly workoutSessionCount: number;
  readonly externalActivityCount?: number;
  readonly recoveryRiskLevel?: "low" | "moderate" | "high" | "blocked" | null;
  readonly v1Status?: "ready" | "caution" | "recovery_priority" | "insufficient_data";
  readonly v1Action?: "recovery_first" | "record_recovery_check_in" |
    "follow_active_program" | "complete_nutrition_record" | "record_weight" |
    "confirm_training_program";
  readonly v1AbsoluteGuardrail?: boolean;
  readonly counterfactualV1?: {
    readonly outcome: "comparable" | "ambiguous_program_state";
    readonly status?: "ready" | "caution" | "recovery_priority" | "insufficient_data";
    readonly action?: ShadowAction;
    readonly absoluteGuardrail?: boolean;
  };
  readonly contextEligibilityAvailable?: boolean;
}

type ShadowStatus = "ready" | "caution" | "recovery_priority" | "insufficient_data";
type ShadowAction = NonNullable<RetrospectiveDailyEvidence["v1Action"]>;
type V1Status = NonNullable<RetrospectiveDailyEvidence["v1Status"]>;
type V1Transition = `${V1Status}->${ShadowStatus}`;

/** Aggregate-only result for one candidate; no dates or raw facts are exposed. */
export interface RetrospectiveCandidateReport {
  readonly candidate: PersonalBaselinePolicy["key"];
  readonly evaluatedDayCount: number;
  readonly baselineAvailableDayCounts: Readonly<Record<PersonalBaselineMetric, number>>;
  readonly insufficientHistoryDayCounts: Readonly<Record<PersonalBaselineMetric, number>>;
  readonly belowUsualCounts: Readonly<Record<PersonalBaselineMetric, number>>;
  readonly aboveUsualCounts: Readonly<Record<PersonalBaselineMetric, number>>;
  readonly markedDeviationCount: number;
  readonly severeSingleDayJumpCount: number;
  readonly statusCounts: Readonly<Record<ShadowStatus, number>>;
  readonly actionCounts: Readonly<Record<ShadowAction, number>>;
  readonly v1ComparableDayCount: number;
  readonly storedV1ComparableDayCount: number;
  readonly counterfactualComparableDayCount: number;
  readonly counterfactualAmbiguousProgramStateDayCount: number;
  readonly counterfactualUnavailableDayCount: number;
  readonly missingV1SnapshotDayCount: number;
  readonly v1ToHybridTransitionCounts: Readonly<Record<V1Transition, number>>;
  readonly statusTransitionCount: number;
  readonly abruptReversalCount: number;
  readonly absoluteGuardrailDayCount: number;
  readonly persistentTrendDecisionCount: number;
  readonly excludedBaselineDayCount: number;
  readonly unstableBaselineDayCount: number;
  readonly chronicAdverseBaselineWarningCount: number;
  readonly missingCurrentValueCounts: Readonly<Record<PersonalBaselineMetric, number>>;
  readonly exclusionReasonCounts: {
    readonly explicit_context: number;
    readonly recovery_hard_stop: number;
    readonly recovery_buffer: number;
    readonly unstable_multi_signal_shift: number;
    readonly incompatible_training_load: number;
    readonly training_source_series_change: number;
    readonly context_eligibility_unavailable: number;
  };
  readonly invariantViolationCounts: {
    readonly readyBehindAbsoluteGuardrail: number;
    readonly recoveryWithoutSupportingSignal: number;
  };
  readonly counterfactualStatusCounts: Readonly<Record<ShadowStatus, number>>;
  readonly counterfactualActionCounts: Readonly<Record<ShadowAction, number>>;
  readonly counterfactualV1ToHybridTransitionCounts: Readonly<Record<V1Transition, number>>;
  readonly counterfactualStatusTransitionCount: number;
  readonly counterfactualAbruptReversalCount: number;
  readonly counterfactualAbsoluteGuardrailDayCount: number;
  readonly counterfactualPersistentTrendDecisionCount: number;
  readonly counterfactualInvariantViolationCounts: {
    readonly readyBehindAbsoluteGuardrail: number;
    readonly recoveryWithoutSupportingSignal: number;
  };
}

/** Privacy-preserving report emitted by the retrospective shadow evaluator. */
export interface DailyAssessmentRetrospectiveReport {
  readonly reportVersion: 3;
  readonly mode: "read_only_shadow";
  readonly policyVersion: "personal-baseline-shadow-v1";
  readonly comparisonModes: readonly ["stored_v1", "counterfactual_current_facts_v1"];
  readonly evaluatedDayCount: number;
  readonly candidates: readonly RetrospectiveCandidateReport[];
  readonly sensitivityRankingMode: "stored_v1" | "counterfactual_current_facts_v1" | "insufficient_evidence";
  readonly sensitivityRanking: readonly PersonalBaselinePolicy["key"][];
  readonly v2V3Comparison: {
    readonly mode: "completed_day_counterfactual";
    readonly comparableDayCount: number;
    readonly movementCoverageDayCount: number;
    readonly movementBaselineAvailableDayCount: number;
    readonly statusDifferenceCount: number;
    readonly actionDifferenceCount: number;
    readonly stricterStatusCount: number;
    readonly v3StatusTransitionCount: number;
    readonly v3AbruptReversalCount: number;
    readonly suspiciousRecoveryFromMovementOnlyCount: number;
    readonly noMovementBehaviorMismatchCount: number;
  };
  readonly privacy: {
    readonly containsDates: false;
    readonly containsRawValues: false;
    readonly containsFactIdentifiers: false;
  };
  readonly effects: {
    readonly recommendationsChanged: false;
    readonly writesPerformed: false;
  };
}

function baseDecision(day: RetrospectiveDailyEvidence): {
  status: ShadowStatus;
  action: ShadowAction;
} | null {
  if (
    day.counterfactualV1?.outcome === "comparable" &&
    day.counterfactualV1.status !== undefined &&
    day.counterfactualV1.action !== undefined
  ) {
    return {
      status: day.counterfactualV1.status,
      action: day.counterfactualV1.action
    };
  }
  if (day.v1Status !== undefined && day.v1Action !== undefined) {
    return { status: day.v1Status, action: day.v1Action };
  }
  return null;
}

function statusRank(status: ShadowStatus): number {
  if (status === "recovery_priority") return 2;
  if (status === "caution") return 1;
  return 0;
}

function compareV2AndV3(
  days: readonly RetrospectiveDailyEvidence[],
  reportFrom: string
): DailyAssessmentRetrospectiveReport["v2V3Comparison"] {
  const evidenceDays: readonly PersonalAssessmentEvidenceDay[] = days.map((day) => ({
    localDate: day.localDate,
    values: day.values,
    baselineExcluded: day.baselineExcluded,
    recoveryHardStop: day.acuteIllness || day.injuryConcern || day.recoveryHardStop,
    trainingLoadIncompatible: day.trainingLoadIncompatible,
    trainingLoadSeriesKey: day.trainingLoadSeriesKey,
    recoveryObservationIds: [],
    recoveryAssessmentIds: [],
    externalActivityIds: []
  }));
  let comparableDayCount = 0;
  let movementCoverageDayCount = 0;
  let movementBaselineAvailableDayCount = 0;
  let statusDifferenceCount = 0;
  let actionDifferenceCount = 0;
  let stricterStatusCount = 0;
  let v3StatusTransitionCount = 0;
  let v3AbruptReversalCount = 0;
  let suspiciousRecoveryFromMovementOnlyCount = 0;
  let noMovementBehaviorMismatchCount = 0;
  let previousV3Status: ShadowStatus | null = null;
  let previousPreviousV3Status: ShadowStatus | null = null;

  for (const [dayIndex, day] of days.entries()) {
    if (day.localDate < reportFrom) continue;
    const base = baseDecision(day);
    if (base === null) {
      previousV3Status = null;
      previousPreviousV3Status = null;
      continue;
    }
    const history = evidenceDays.slice(0, dayIndex + 1);
    const v2 = evaluatePersonalizedDailyAssessmentWithPolicy(
      day.localDate,
      history,
      activePersonalBaselinePolicy
    );
    const v3 = evaluatePersonalizedDailyAssessmentWithPolicy(
      day.localDate,
      history,
      activePersonalBaselineV2Policy
    );
    const v2Overlay = applyConservativePersonalOverlay(base.status, {
      type: base.action,
      text: "shadow",
      trainingProgramVersionId: null
    }, v2.signals);
    const v3Overlay = applyConservativePersonalOverlay(base.status, {
      type: base.action,
      text: "shadow",
      trainingProgramVersionId: null
    }, v3.signals);
    const hasMovement = day.values.steps !== undefined && Number.isFinite(day.values.steps);
    comparableDayCount += 1;
    if (hasMovement) movementCoverageDayCount += 1;
    if (v3.baseline.comparisons.some((comparison) =>
      comparison.metric === "steps" && comparison.availability === "available"
    )) movementBaselineAvailableDayCount += 1;
    if (v2Overlay.status !== v3Overlay.status) statusDifferenceCount += 1;
    if (v2Overlay.action.type !== v3Overlay.action.type) actionDifferenceCount += 1;
    if (statusRank(v3Overlay.status) > statusRank(v2Overlay.status)) stricterStatusCount += 1;
    if (!hasMovement && v2Overlay.status !== v3Overlay.status) {
      noMovementBehaviorMismatchCount += 1;
    }
    if (
      v3Overlay.status === "recovery_priority" &&
      v2Overlay.status !== "recovery_priority" &&
      v3.signals.markedNonMovementSignalCount === 0
    ) suspiciousRecoveryFromMovementOnlyCount += 1;
    if (previousV3Status !== null && previousV3Status !== v3Overlay.status) {
      v3StatusTransitionCount += 1;
    }
    if (
      previousPreviousV3Status !== null &&
      previousPreviousV3Status === v3Overlay.status &&
      previousV3Status !== v3Overlay.status
    ) v3AbruptReversalCount += 1;
    previousPreviousV3Status = previousV3Status;
    previousV3Status = v3Overlay.status;
  }

  return {
    mode: "completed_day_counterfactual",
    comparableDayCount,
    movementCoverageDayCount,
    movementBaselineAvailableDayCount,
    statusDifferenceCount,
    actionDifferenceCount,
    stricterStatusCount,
    v3StatusTransitionCount,
    v3AbruptReversalCount,
    suspiciousRecoveryFromMovementOnlyCount,
    noMovementBehaviorMismatchCount
  };
}

function zeroMetrics(): Record<PersonalBaselineMetric, number> {
  return Object.fromEntries(
    personalBaselineMetrics.map((metric) => [metric, 0])
  ) as Record<PersonalBaselineMetric, number>;
}

function zeroStatuses(): Record<ShadowStatus, number> {
  return { ready: 0, caution: 0, recovery_priority: 0, insufficient_data: 0 };
}

function zeroActions(): Record<ShadowAction, number> {
  return {
    recovery_first: 0,
    record_recovery_check_in: 0,
    follow_active_program: 0,
    complete_nutrition_record: 0,
    record_weight: 0,
    confirm_training_program: 0
  };
}

function zeroInvariantViolations(): {
  readyBehindAbsoluteGuardrail: number;
  recoveryWithoutSupportingSignal: number;
} {
  return { readyBehindAbsoluteGuardrail: 0, recoveryWithoutSupportingSignal: 0 };
}

function zeroV1Transitions(): Record<V1Transition, number> {
  const result = {} as Record<V1Transition, number>;
  for (const from of ["ready", "caution", "recovery_priority", "insufficient_data"] as const) {
    for (const to of ["ready", "caution", "recovery_priority", "insufficient_data"] as const) {
      result[`${from}->${to}`] = 0;
    }
  }
  return result;
}

function evaluateCandidate(
  days: readonly RetrospectiveDailyEvidence[],
  policy: PersonalBaselinePolicy,
  reportFrom: string
): RetrospectiveCandidateReport {
  const baselineAvailableDayCounts = zeroMetrics();
  const insufficientHistoryDayCounts = zeroMetrics();
  const belowUsualCounts = zeroMetrics();
  const aboveUsualCounts = zeroMetrics();
  const policyEvidenceDays: readonly PersonalAssessmentEvidenceDay[] = days.map((day) => ({
    localDate: day.localDate,
    values: day.values,
    baselineExcluded: day.baselineExcluded,
    recoveryHardStop: day.acuteIllness || day.injuryConcern || day.recoveryHardStop,
    trainingLoadIncompatible: day.trainingLoadIncompatible,
    trainingLoadSeriesKey: day.trainingLoadSeriesKey,
    recoveryObservationIds: [],
    recoveryAssessmentIds: [],
    externalActivityIds: []
  }));
  const statusCounts = zeroStatuses();
  const actionCounts = zeroActions();
  const v1ToHybridTransitionCounts = zeroV1Transitions();
  const counterfactualStatusCounts = zeroStatuses();
  const counterfactualActionCounts = zeroActions();
  const counterfactualV1ToHybridTransitionCounts = zeroV1Transitions();
  let v1ComparableDayCount = 0;
  let storedV1ComparableDayCount = 0;
  let counterfactualComparableDayCount = 0;
  let counterfactualAmbiguousProgramStateDayCount = 0;
  let counterfactualUnavailableDayCount = 0;
  let missingV1SnapshotDayCount = 0;
  let markedDeviationCount = 0;
  let severeSingleDayJumpCount = 0;
  let statusTransitionCount = 0;
  let abruptReversalCount = 0;
  let chronicAdverseBaselineWarningCount = 0;
  let absoluteGuardrailDayCount = 0;
  let persistentTrendDecisionCount = 0;
  let counterfactualStatusTransitionCount = 0;
  let counterfactualAbruptReversalCount = 0;
  let counterfactualAbsoluteGuardrailDayCount = 0;
  let counterfactualPersistentTrendDecisionCount = 0;
  let excludedBaselineDayCount = 0;
  let unstableBaselineDayCount = 0;
  const missingCurrentValueCounts = zeroMetrics();
  const exclusionReasonCounts = {
    explicit_context: 0,
    recovery_hard_stop: 0,
    recovery_buffer: 0,
    unstable_multi_signal_shift: 0,
    incompatible_training_load: 0,
    training_source_series_change: 0,
    context_eligibility_unavailable: 0
  };
  const invariantViolationCounts = zeroInvariantViolations();
  const counterfactualInvariantViolationCounts = zeroInvariantViolations();
  let previousStatus: ShadowStatus | null = null;
  let previousPreviousStatus: ShadowStatus | null = null;
  let previousCounterfactualStatus: ShadowStatus | null = null;
  let previousPreviousCounterfactualStatus: ShadowStatus | null = null;
  let previousTrainingSeriesKey: string | null = null;

  for (const [dayIndex, day] of days.entries()) {
    const inReport = day.localDate >= reportFrom;
    const personal = evaluatePersonalizedDailyAssessmentWithPolicy(
      day.localDate,
      policyEvidenceDays.slice(0, dayIndex + 1),
      policy
    );
    const {
      hardStop,
      recoveryBuffered: buffered,
      unstable,
      eligibleBeforeStability,
      eligible
    } = personal.calculation.targetEligibility;
    const {
      markedPersonalSignalCount,
      persistentPersonalSignalCount,
      adverseCenterPresent
    } = personal.signals;
    if (inReport) {
      for (const comparison of personal.baseline.comparisons) {
        const currentValue = day.values[comparison.metric];
        if (currentValue == null || !Number.isFinite(currentValue)) {
          missingCurrentValueCounts[comparison.metric] += 1;
        } else if (comparison.availability === "available") {
          baselineAvailableDayCounts[comparison.metric] += 1;
          if (comparison.position === "below_usual") {
            belowUsualCounts[comparison.metric] += 1;
          }
          if (comparison.position === "above_usual") {
            aboveUsualCounts[comparison.metric] += 1;
          }
        } else {
          insufficientHistoryDayCounts[comparison.metric] += 1;
        }
      }
      if (adverseCenterPresent) chronicAdverseBaselineWarningCount += 1;
    }
    if (inReport && eligibleBeforeStability) {
      markedDeviationCount += markedPersonalSignalCount;
      if (markedPersonalSignalCount > 0) severeSingleDayJumpCount += 1;
    }
    const overlayStatus = (baseStatus: ShadowStatus): ShadowStatus =>
      applyConservativePersonalOverlay(
        baseStatus,
        { type: "record_recovery_check_in", text: "shadow", trainingProgramVersionId: null },
        personal.signals
      ).status;

    const hasStoredV1 = day.v1Status !== undefined && day.v1Action !== undefined;
    if (inReport && hasStoredV1) {
      const baseStatus = day.v1Status!;
      const status = overlayStatus(baseStatus);
      const absoluteGuardrail = day.v1AbsoluteGuardrail === true;
      v1ComparableDayCount += 1;
      storedV1ComparableDayCount += 1;
      statusCounts[status] += 1;
      actionCounts[status === baseStatus ? day.v1Action! : "recovery_first"] += 1;
      v1ToHybridTransitionCounts[`${baseStatus}->${status}`] += 1;
      if (hardStop || absoluteGuardrail) absoluteGuardrailDayCount += 1;
      if (persistentPersonalSignalCount > 0 && baseStatus === "ready") {
        persistentTrendDecisionCount += 1;
      }
      if (status === "ready" && (hardStop || absoluteGuardrail)) {
        invariantViolationCounts.readyBehindAbsoluteGuardrail += 1;
      }
      if (
        status === "recovery_priority" && status !== baseStatus &&
        !hardStop && (!eligibleBeforeStability || markedPersonalSignalCount < 2)
      ) invariantViolationCounts.recoveryWithoutSupportingSignal += 1;
      if (previousStatus !== null && previousStatus !== status) statusTransitionCount += 1;
      if (
        previousPreviousStatus !== null && previousPreviousStatus === status &&
        previousStatus !== status
      ) abruptReversalCount += 1;
      previousPreviousStatus = previousStatus;
      previousStatus = status;
    } else if (inReport) {
      missingV1SnapshotDayCount += 1;
      previousStatus = null;
      previousPreviousStatus = null;
    }

    const counterfactual = day.counterfactualV1;
    const hasCounterfactualV1 = counterfactual?.outcome === "comparable" &&
      counterfactual.status !== undefined && counterfactual.action !== undefined;
    if (inReport && hasCounterfactualV1) {
      const baseStatus = counterfactual.status!;
      const status = overlayStatus(baseStatus);
      const absoluteGuardrail = counterfactual.absoluteGuardrail === true;
      counterfactualComparableDayCount += 1;
      counterfactualStatusCounts[status] += 1;
      counterfactualActionCounts[
        status === baseStatus ? counterfactual.action! : "recovery_first"
      ] += 1;
      counterfactualV1ToHybridTransitionCounts[`${baseStatus}->${status}`] += 1;
      if (hardStop || absoluteGuardrail) counterfactualAbsoluteGuardrailDayCount += 1;
      if (persistentPersonalSignalCount > 0 && baseStatus === "ready") {
        counterfactualPersistentTrendDecisionCount += 1;
      }
      if (status === "ready" && (hardStop || absoluteGuardrail)) {
        counterfactualInvariantViolationCounts.readyBehindAbsoluteGuardrail += 1;
      }
      if (
        status === "recovery_priority" && status !== baseStatus &&
        !hardStop && (!eligibleBeforeStability || markedPersonalSignalCount < 2)
      ) counterfactualInvariantViolationCounts.recoveryWithoutSupportingSignal += 1;
      if (
        previousCounterfactualStatus !== null &&
        previousCounterfactualStatus !== status
      ) counterfactualStatusTransitionCount += 1;
      if (
        previousPreviousCounterfactualStatus !== null &&
        previousPreviousCounterfactualStatus === status &&
        previousCounterfactualStatus !== status
      ) counterfactualAbruptReversalCount += 1;
      previousPreviousCounterfactualStatus = previousCounterfactualStatus;
      previousCounterfactualStatus = status;
    } else if (inReport) {
      if (counterfactual?.outcome === "ambiguous_program_state") {
        counterfactualAmbiguousProgramStateDayCount += 1;
      } else counterfactualUnavailableDayCount += 1;
      previousCounterfactualStatus = null;
      previousPreviousCounterfactualStatus = null;
    }

    if (inReport && unstable) unstableBaselineDayCount += 1;
    if (inReport && day.baselineExcluded) exclusionReasonCounts.explicit_context += 1;
    if (inReport && hardStop) exclusionReasonCounts.recovery_hard_stop += 1;
    if (inReport && buffered) exclusionReasonCounts.recovery_buffer += 1;
    if (inReport && unstable) exclusionReasonCounts.unstable_multi_signal_shift += 1;
    if (inReport && day.trainingLoadIncompatible) {
      exclusionReasonCounts.incompatible_training_load += 1;
    }
    if (inReport && day.contextEligibilityAvailable === false) {
      exclusionReasonCounts.context_eligibility_unavailable += 1;
    }
    if (inReport &&
      day.trainingLoadSeriesKey !== null &&
      previousTrainingSeriesKey !== null &&
      day.trainingLoadSeriesKey !== previousTrainingSeriesKey
    ) {
      exclusionReasonCounts.training_source_series_change += 1;
    }
    if (day.trainingLoadSeriesKey !== null) {
      previousTrainingSeriesKey = day.trainingLoadSeriesKey;
    }
    if (inReport && !eligible) excludedBaselineDayCount += 1;
  }

  return {
    candidate: policy.key,
    evaluatedDayCount: days.filter((day) => day.localDate >= reportFrom).length,
    baselineAvailableDayCounts,
    insufficientHistoryDayCounts,
    belowUsualCounts,
    aboveUsualCounts,
    markedDeviationCount,
    severeSingleDayJumpCount,
    statusCounts,
    actionCounts,
    v1ComparableDayCount,
    storedV1ComparableDayCount,
    counterfactualComparableDayCount,
    counterfactualAmbiguousProgramStateDayCount,
    counterfactualUnavailableDayCount,
    missingV1SnapshotDayCount,
    v1ToHybridTransitionCounts,
    statusTransitionCount,
    abruptReversalCount,
    absoluteGuardrailDayCount,
    persistentTrendDecisionCount,
    excludedBaselineDayCount,
    unstableBaselineDayCount,
    chronicAdverseBaselineWarningCount,
    missingCurrentValueCounts,
    exclusionReasonCounts,
    invariantViolationCounts,
    counterfactualStatusCounts,
    counterfactualActionCounts,
    counterfactualV1ToHybridTransitionCounts,
    counterfactualStatusTransitionCount,
    counterfactualAbruptReversalCount,
    counterfactualAbsoluteGuardrailDayCount,
    counterfactualPersistentTrendDecisionCount,
    counterfactualInvariantViolationCounts
  };
}

/**
 * Runs candidate policies over normalized history and returns aggregates only.
 * It neither mutates source facts nor creates Coaching recommendations.
 */
export function runDailyAssessmentRetrospective(
  inputDays: readonly RetrospectiveDailyEvidence[],
  reportFrom?: string
): DailyAssessmentRetrospectiveReport {
  const days = [...inputDays].sort((left, right) =>
    left.localDate.localeCompare(right.localDate)
  );
  const effectiveReportFrom = reportFrom ?? days[0]?.localDate ?? "9999-12-31";
  const candidates = personalBaselineCandidates.map((policy) =>
    evaluateCandidate(days, policy, effectiveReportFrom)
  );
  const firstCandidate = candidates[0];
  const sensitivityRankingMode = (firstCandidate?.storedV1ComparableDayCount ?? 0) >= 30
    ? "stored_v1" as const
    : (firstCandidate?.counterfactualComparableDayCount ?? 0) >= 30
      ? "counterfactual_current_facts_v1" as const
      : "insufficient_evidence" as const;
  const ranking = sensitivityRankingMode === "insufficient_evidence" ? [] : [...candidates]
    .sort((left, right) => {
      const counterfactual = sensitivityRankingMode === "counterfactual_current_facts_v1";
      const leftReversals = counterfactual
        ? left.counterfactualAbruptReversalCount : left.abruptReversalCount;
      const rightReversals = counterfactual
        ? right.counterfactualAbruptReversalCount : right.abruptReversalCount;
      const leftTransitions = counterfactual
        ? left.counterfactualStatusTransitionCount : left.statusTransitionCount;
      const rightTransitions = counterfactual
        ? right.counterfactualStatusTransitionCount : right.statusTransitionCount;
      const leftPersistent = counterfactual
        ? left.counterfactualPersistentTrendDecisionCount : left.persistentTrendDecisionCount;
      const rightPersistent = counterfactual
        ? right.counterfactualPersistentTrendDecisionCount : right.persistentTrendDecisionCount;
      return leftReversals - rightReversals || leftTransitions - rightTransitions ||
        rightPersistent - leftPersistent || left.candidate.localeCompare(right.candidate);
    })
    .map((candidate) => candidate.candidate);
  return {
    reportVersion: 3,
    mode: "read_only_shadow",
    policyVersion: "personal-baseline-shadow-v1",
    comparisonModes: ["stored_v1", "counterfactual_current_facts_v1"],
    evaluatedDayCount: days.filter((day) => day.localDate >= effectiveReportFrom).length,
    candidates,
    sensitivityRankingMode,
    sensitivityRanking: ranking,
    v2V3Comparison: compareV2AndV3(days, effectiveReportFrom),
    privacy: {
      containsDates: false,
      containsRawValues: false,
      containsFactIdentifiers: false
    },
    effects: {
      recommendationsChanged: false,
      writesPerformed: false
    }
  };
}

const safeStringValues = new Set([
  "read_only_shadow",
  "personal-baseline-shadow-v1",
  "stored_v1",
  "counterfactual_current_facts_v1",
  "insufficient_evidence",
  "responsive",
  "balanced",
  "stable",
  "completed_day_counterfactual"
]);
const safeKeys = new Set([
  "reportVersion", "mode", "policyVersion", "evaluatedDayCount", "candidates",
  "comparisonModes",
  "sensitivityRankingMode",
  "sensitivityRanking", "privacy", "containsDates", "containsRawValues",
  "v2V3Comparison", "comparableDayCount", "movementCoverageDayCount",
  "movementBaselineAvailableDayCount", "statusDifferenceCount", "actionDifferenceCount",
  "stricterStatusCount", "v3StatusTransitionCount", "v3AbruptReversalCount",
  "suspiciousRecoveryFromMovementOnlyCount", "noMovementBehaviorMismatchCount",
  "containsFactIdentifiers", "effects", "recommendationsChanged", "writesPerformed",
  "candidate", "baselineAvailableDayCounts", "insufficientHistoryDayCounts",
  "belowUsualCounts", "aboveUsualCounts", "markedDeviationCount",
  "severeSingleDayJumpCount", "statusCounts", "actionCounts",
  "v1ComparableDayCount", "missingV1SnapshotDayCount", "v1ToHybridTransitionCounts",
  "storedV1ComparableDayCount", "counterfactualComparableDayCount",
  "counterfactualAmbiguousProgramStateDayCount", "counterfactualUnavailableDayCount",
  "statusTransitionCount", "abruptReversalCount", "absoluteGuardrailDayCount",
  "persistentTrendDecisionCount", "excludedBaselineDayCount", "unstableBaselineDayCount",
  "chronicAdverseBaselineWarningCount", "missingCurrentValueCounts",
  "exclusionReasonCounts", "invariantViolationCounts", "explicit_context",
  "recovery_hard_stop", "recovery_buffer", "unstable_multi_signal_shift",
  "incompatible_training_load", "training_source_series_change",
  "context_eligibility_unavailable",
  "counterfactualStatusCounts", "counterfactualActionCounts",
  "counterfactualV1ToHybridTransitionCounts", "counterfactualStatusTransitionCount",
  "counterfactualAbruptReversalCount", "counterfactualAbsoluteGuardrailDayCount",
  "counterfactualPersistentTrendDecisionCount", "counterfactualInvariantViolationCounts",
  "readyBehindAbsoluteGuardrail", "recoveryWithoutSupportingSignal",
  "ready", "caution", "recovery_priority", "insufficient_data",
  "recovery_first", "record_recovery_check_in", "follow_active_program",
  "complete_nutrition_record", "record_weight", "confirm_training_program",
  ...personalBaselineMetrics
]);
for (const from of ["ready", "caution", "recovery_priority", "insufficient_data"]) {
  for (const to of ["ready", "caution", "recovery_priority", "insufficient_data"]) {
    safeKeys.add(`${from}->${to}`);
  }
}

function assertAggregateSafe(value: unknown): void {
  if (typeof value === "number") {
    if (!Number.isSafeInteger(value) || value < 0) throw new Error("Unsafe report number");
    return;
  }
  if (typeof value === "boolean") {
    if (value) throw new Error("Unsafe report flag");
    return;
  }
  if (typeof value === "string") {
    if (!safeStringValues.has(value)) throw new Error("Unsafe report string");
    return;
  }
  if (Array.isArray(value)) {
    for (const item of value) assertAggregateSafe(item);
    return;
  }
  if (value !== null && typeof value === "object") {
    for (const [key, nested] of Object.entries(value)) {
      if (!safeKeys.has(key)) throw new Error("Unsafe report field");
      assertAggregateSafe(nested);
    }
    return;
  }
  throw new Error("Unsafe report value");
}

/** Serializes only the fixed aggregate report vocabulary and fails closed. */
export function serializeDailyAssessmentRetrospectiveReport(
  report: DailyAssessmentRetrospectiveReport
): string {
  assertAggregateSafe(report);
  return JSON.stringify(report, null, 2);
}
