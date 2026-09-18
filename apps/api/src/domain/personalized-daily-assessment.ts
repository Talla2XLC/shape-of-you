import type {
  DailyAssessmentPersonalBaseline,
  DailyAssessmentPersonalComparison,
  DailyAssessmentReason
} from "@shape-of-you/contracts";

import {
  activePersonalBaselinePolicy,
  activePersonalBaselineV2Policy,
  compareWithPersonalBaseline,
  isPersistentDeviation,
  personalBaselineCenter,
  personalBaselineMetricsForPolicy,
  type PersonalBaselineMetric,
  type PersonalBaselinePolicy,
  type PersonalBaselineSample
} from "./personal-baseline.js";
import { isDailyAssessmentAbsoluteMetricConcern } from "./daily-assessment.js";
import type { PersonalOverlaySignals } from "./daily-assessment-personal-overlay.js";

/** One owner-consolidated day used by the authoritative personal evaluator. */
export interface PersonalAssessmentEvidenceDay {
  readonly localDate: string;
  readonly values: Readonly<Partial<Record<PersonalBaselineMetric, number>>>;
  readonly baselineExcluded: boolean;
  readonly recoveryHardStop: boolean;
  readonly trainingLoadIncompatible: boolean;
  readonly trainingLoadSeriesKey: string | null;
  readonly recoveryObservationIds: readonly string[];
  readonly recoveryAssessmentIds: readonly string[];
  readonly externalActivityIds: readonly string[];
  readonly partialDayMetrics?: readonly PersonalBaselineMetric[];
}

/** Exact private calculation retained by the immutable v2 snapshot. */
export interface DailyAssessmentPersonalCalculation {
  readonly policy: PersonalBaselinePolicy;
  readonly targetLocalDate: string;
  readonly days: readonly PersonalAssessmentEvidenceDay[];
  readonly comparisons: readonly DailyAssessmentPersonalComparison[];
  readonly signals: PersonalOverlaySignals;
  readonly targetEligibility: PersonalBaselineTargetEligibility;
}

/** Exact target-day eligibility trace shared by live and retrospective evaluation. */
export interface PersonalBaselineTargetEligibility {
  readonly explicitlyExcluded: boolean;
  readonly hardStop: boolean;
  readonly recoveryBuffered: boolean;
  readonly unstable: boolean;
  readonly eligibleBeforeStability: boolean;
  readonly eligible: boolean;
}

/** Pure current-day output shared by live authority and tests. */
export interface PersonalizedDailyAssessment {
  readonly publicBaseline: DailyAssessmentPersonalBaseline;
  readonly calculation: DailyAssessmentPersonalCalculation;
  readonly signals: PersonalOverlaySignals;
  readonly reasons: readonly DailyAssessmentReason[];
}

/** Policy-labelled internal result used by retrospective candidate evaluation. */
export interface PersonalizedPolicyAssessment {
  readonly baseline: {
    readonly policyKey: PersonalBaselinePolicy["key"];
    readonly policyVersion: PersonalBaselinePolicy["policyVersion"];
    readonly status: DailyAssessmentPersonalBaseline["status"];
    readonly summary: string;
    readonly comparisons: readonly DailyAssessmentPersonalComparison[];
  };
  readonly calculation: DailyAssessmentPersonalCalculation;
  readonly signals: PersonalOverlaySignals;
  readonly reasons: readonly DailyAssessmentReason[];
}

function addDays(localDate: string, days: number): string {
  const date = new Date(`${localDate}T00:00:00.000Z`);
  date.setUTCDate(date.getUTCDate() + days);
  return date.toISOString().slice(0, 10);
}

function adverseDirection(metric: PersonalBaselineMetric): "below_usual" | "above_usual" {
  return metric === "resting_heart_rate" || metric === "training_load" || metric === "steps"
    ? "above_usual"
    : "below_usual";
}

function adverseCenter(
  metric: PersonalBaselineMetric,
  localDate: string,
  samples: readonly PersonalBaselineSample[],
  policy: PersonalBaselinePolicy
): boolean {
  const center = personalBaselineCenter(
    localDate,
    samples,
    policy,
    metric === "training_load"
      ? { minimumCalendarSpanDays: policy.minimumTrainingCalendarSpanDays }
      : undefined
  );
  if (center === null) return false;
  if (metric === "sleep_minutes") {
    return isDailyAssessmentAbsoluteMetricConcern("sleep_minutes", center);
  }
  if (metric === "body_battery" || metric === "body_battery_max") {
    return isDailyAssessmentAbsoluteMetricConcern("body_battery", center);
  }
  if (metric === "training_load") {
    return isDailyAssessmentAbsoluteMetricConcern("training_load", center);
  }
  if (metric === "steps") return false;
  return false;
}

function emptyComparison(
  metric: PersonalBaselineMetric,
  availability: "insufficient_history" | "incompatible"
): DailyAssessmentPersonalComparison {
  return {
    metric,
    availability,
    position: null,
    severity: null,
    eligibleDayCount: 0,
    method: null
  };
}

function summaryFor(comparisons: readonly DailyAssessmentPersonalComparison[]): string {
  const changed = comparisons.filter((item) =>
    item.availability === "available" && item.position !== "within_usual"
  );
  const phrases = changed.map((item) => {
    const below = item.position === "below_usual";
    if (item.metric === "sleep_minutes") return below ? "сон короче твоего обычного" : "сон дольше твоего обычного";
    if (item.metric === "hrv_rmssd") return below ? "HRV ниже твоего обычного уровня" : "HRV выше твоего обычного уровня";
    if (item.metric === "resting_heart_rate") return below ? "пульс покоя ниже обычного" : "пульс покоя выше обычного";
    if (item.metric.startsWith("body_battery")) return below ? "Body Battery ниже обычного" : "Body Battery выше обычного";
    if (item.metric === "steps") return below ? "шагов пока меньше обычного полного дня" : "ты уже прошёл больше своего обычного полного дня";
    return below ? "тренировочная нагрузка ниже твоего обычного уровня" : "тренировочная нагрузка выше твоего обычного уровня";
  });
  if (phrases.length > 0) {
    return `Относительно твоей личной нормы: ${[...new Set(phrases)].slice(0, 3).join(", ")}.`;
  }
  if (comparisons.some((item) => item.availability === "available")) {
    return "Доступные показатели находятся в пределах твоего недавнего обычного диапазона.";
  }
  return "Личная норма пока недоступна: оценка использует абсолютные правила безопасности и доступные факты.";
}

function reasonFor(metric: PersonalBaselineMetric): DailyAssessmentReason {
  if (metric === "sleep_minutes") return "sleep_below_usual";
  if (metric === "hrv_rmssd") return "hrv_below_usual";
  if (metric === "resting_heart_rate") return "resting_heart_rate_above_usual";
  if (metric === "training_load") return "training_load_above_usual";
  if (metric === "steps") return "steps_above_usual";
  return "body_battery_below_usual";
}

type PersonalSignalGroup = "sleep" | "hrv" | "resting_heart_rate" |
  "body_battery" | "training_load" | "steps";

function signalGroup(metric: PersonalBaselineMetric): PersonalSignalGroup {
  if (metric === "body_battery" || metric === "body_battery_min" ||
      metric === "body_battery_max") return "body_battery";
  if (metric === "sleep_minutes") return "sleep";
  if (metric === "hrv_rmssd") return "hrv";
  return metric;
}

/** Evaluates one explicit policy over bounded, owner-normalized history. */
export function evaluatePersonalizedDailyAssessmentWithPolicy(
  targetLocalDate: string,
  evidenceDays: readonly PersonalAssessmentEvidenceDay[],
  policy: PersonalBaselinePolicy
): PersonalizedPolicyAssessment {
  const days = [...evidenceDays]
    .filter((day) => day.localDate <= targetLocalDate)
    .sort((left, right) => left.localDate.localeCompare(right.localDate));
  const metrics = personalBaselineMetricsForPolicy(policy);
  const histories = Object.fromEntries(
    metrics.map((metric) => [metric, [] as PersonalBaselineSample[]])
  ) as Record<PersonalBaselineMetric, PersonalBaselineSample[]>;
  const adverseHistories = Object.fromEntries(
    metrics.map((metric) => [metric, [] as boolean[]])
  ) as Record<PersonalBaselineMetric, boolean[]>;
  const trainingHistories = new Map<string, PersonalBaselineSample[]>();
  const trainingAdverseHistories = new Map<string, boolean[]>();
  let recoveryBufferThrough: string | null = null;
  let targetComparisons: DailyAssessmentPersonalComparison[] = metrics.map(
    (metric) => emptyComparison(metric, "insufficient_history")
  );
  let targetSignals: PersonalOverlaySignals = {
    hardStop: false,
    eligibleBeforeStability: false,
    markedPersonalSignalCount: 0,
    adversePersonalSignalCount: 0,
    persistentPersonalSignalCount: 0,
    adverseCenterPresent: false,
    adverseNonMovementSignalCount: 0,
    markedNonMovementSignalCount: 0,
    movementAboveUsual: false,
    movementMarked: false
  };
  let targetEligibility: PersonalBaselineTargetEligibility = {
    explicitlyExcluded: false,
    hardStop: false,
    recoveryBuffered: false,
    unstable: false,
    eligibleBeforeStability: false,
    eligible: false
  };

  for (const day of days) {
    const hardStop = day.recoveryHardStop;
    const buffered = recoveryBufferThrough !== null && day.localDate <= recoveryBufferThrough;
    const eligibleBeforeStability = !day.baselineExcluded && !hardStop && !buffered;
    const comparisons: DailyAssessmentPersonalComparison[] = [];
    const adverseByMetric = new Map<PersonalBaselineMetric, boolean>();
    const markedSignalGroups = new Set<PersonalSignalGroup>();
    let adverseCenterPresent = false;

    for (const metric of metrics) {
      const current = day.values[metric];
      const seriesKey = day.trainingLoadSeriesKey;
      if (metric === "training_load" && (day.trainingLoadIncompatible || seriesKey === null)) {
        comparisons.push(emptyComparison(metric, "incompatible"));
        continue;
      }
      if (current === undefined || !Number.isFinite(current)) {
        comparisons.push(emptyComparison(metric, "insufficient_history"));
        continue;
      }
      const history = metric === "training_load"
        ? (trainingHistories.get(seriesKey!) ?? [])
        : histories[metric];
      const rawComparison = compareWithPersonalBaseline(
        day.localDate,
        current,
        history,
        policy,
        metric === "training_load"
          ? { minimumCalendarSpanDays: policy.minimumTrainingCalendarSpanDays }
          : undefined
      );
      const comparison = metric === "steps" && day.partialDayMetrics?.includes("steps") &&
        rawComparison.availability === "available" && rawComparison.position === "below_usual"
        ? { ...rawComparison, position: "within_usual" as const, severity: "usual" as const }
        : rawComparison;
      comparisons.push({ metric, ...comparison });
      if (comparison.availability === "available") {
        const adverse = comparison.position === adverseDirection(metric);
        adverseByMetric.set(metric, adverse);
        if (adverse && comparison.severity === "marked") {
          markedSignalGroups.add(signalGroup(metric));
        }
        if (adverseCenter(metric, day.localDate, history, policy)) adverseCenterPresent = true;
      }
    }

    const markedPersonalSignalCount = markedSignalGroups.size;
    const unstable = eligibleBeforeStability &&
      markedPersonalSignalCount >= policy.multiSignalFreezeThreshold;
    const eligible = eligibleBeforeStability && !unstable;
    const adverseSignalGroups = new Set<PersonalSignalGroup>();
    const persistentSignalGroups = new Set<PersonalSignalGroup>();
    if (eligible) {
      for (const [metric, adverse] of adverseByMetric) {
        const seriesKey = day.trainingLoadSeriesKey;
        const history = metric === "training_load"
          ? (trainingAdverseHistories.get(seriesKey!) ?? [])
          : adverseHistories[metric];
        history.push(adverse);
        if (metric === "training_load") trainingAdverseHistories.set(seriesKey!, history);
        if (adverse) adverseSignalGroups.add(signalGroup(metric));
        if (adverse && isPersistentDeviation(history, policy)) {
          persistentSignalGroups.add(signalGroup(metric));
        }
      }
    }

    if (day.localDate === targetLocalDate) {
      targetComparisons = comparisons;
      targetSignals = {
        hardStop,
        eligibleBeforeStability,
        markedPersonalSignalCount,
        adversePersonalSignalCount: adverseSignalGroups.size,
        persistentPersonalSignalCount: [...persistentSignalGroups]
          .filter((group) => group !== "steps").length,
        adverseCenterPresent,
        adverseNonMovementSignalCount: [...adverseSignalGroups].filter((group) => group !== "steps").length,
        markedNonMovementSignalCount: [...markedSignalGroups].filter((group) => group !== "steps").length,
        movementAboveUsual: adverseSignalGroups.has("steps"),
        movementMarked: markedSignalGroups.has("steps")
      };
      targetEligibility = {
        explicitlyExcluded: day.baselineExcluded,
        hardStop,
        recoveryBuffered: buffered,
        unstable,
        eligibleBeforeStability,
        eligible
      };
    }

    for (const metric of metrics) {
      const value = day.values[metric];
      if (
        !eligible || value === undefined || !Number.isFinite(value) ||
        day.partialDayMetrics?.includes(metric)
      ) continue;
      const sample = { localDate: day.localDate, value, eligible: true };
      if (metric === "training_load") {
        const seriesKey = day.trainingLoadSeriesKey;
        if (day.trainingLoadIncompatible || seriesKey === null) continue;
        trainingHistories.set(seriesKey, [...(trainingHistories.get(seriesKey) ?? []), sample]);
      } else histories[metric].push(sample);
    }
    if (hardStop) recoveryBufferThrough = addDays(day.localDate, policy.recoveryBufferDays);
  }

  const availableCount = targetComparisons.filter((item) => item.availability === "available").length;
  const unstable = targetSignals.eligibleBeforeStability &&
    targetSignals.markedPersonalSignalCount >= policy.multiSignalFreezeThreshold;
  const status = unstable
    ? "unstable"
    : availableCount === 0
      ? "unavailable"
      : availableCount === targetComparisons.length
        ? "available"
        : "partial";
  const reasons = targetComparisons
    .filter((item) => item.availability === "available" && item.position === adverseDirection(item.metric))
    .map((item) => reasonFor(item.metric));
  if (targetSignals.persistentPersonalSignalCount > 0) reasons.push("personal_trend_persistent");
  if (unstable) reasons.push("personal_baseline_unstable");
  const baseline: PersonalizedPolicyAssessment["baseline"] = {
    policyKey: policy.key,
    policyVersion: policy.policyVersion,
    status,
    summary: summaryFor(targetComparisons),
    comparisons: targetComparisons
  };
  return {
    baseline,
    signals: targetSignals,
    reasons: [...new Set(reasons)],
    calculation: {
      policy,
      targetLocalDate,
      days,
      comparisons: targetComparisons,
      signals: targetSignals,
      targetEligibility
    }
  };
}

/** Evaluates the active balanced policy over bounded, owner-normalized history. */
export function evaluatePersonalizedDailyAssessment(
  targetLocalDate: string,
  evidenceDays: readonly PersonalAssessmentEvidenceDay[]
): PersonalizedDailyAssessment {
  const evaluated = evaluatePersonalizedDailyAssessmentWithPolicy(
    targetLocalDate,
    evidenceDays,
    activePersonalBaselinePolicy
  );
  const { baseline, ...shared } = evaluated;
  return {
    ...shared,
    publicBaseline: {
      policyKey: "balanced",
      policyVersion: "personal-baseline-v1",
      status: baseline.status,
      summary: baseline.summary,
      comparisons: baseline.comparisons
    }
  };
}

/** Evaluates the active V3 baseline including optional completed-day steps. */
export function evaluatePersonalizedDailyAssessmentV3(
  targetLocalDate: string,
  evidenceDays: readonly PersonalAssessmentEvidenceDay[]
): Omit<PersonalizedDailyAssessment, "publicBaseline"> & {
  readonly publicBaseline: DailyAssessmentPersonalBaseline & {
    readonly policyVersion: "personal-baseline-v2";
  };
} {
  const evaluated = evaluatePersonalizedDailyAssessmentWithPolicy(
    targetLocalDate,
    evidenceDays,
    activePersonalBaselineV2Policy
  );
  const { baseline, ...shared } = evaluated;
  return {
    ...shared,
    publicBaseline: {
      policyKey: "balanced",
      policyVersion: "personal-baseline-v2",
      status: baseline.status,
      summary: baseline.summary,
      comparisons: baseline.comparisons
    }
  };
}
