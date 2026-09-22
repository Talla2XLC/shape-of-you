import { createHash } from "node:crypto";

import type {
  DailyAssessmentAvailable,
  DailyAssessmentUsedFacts,
  DailyNextAction
} from "@shape-of-you/contracts";

/** Canonical v1 absolute metric guardrails reused by conservative overlays. */
export function isDailyAssessmentAbsoluteMetricConcern(
  metric: "sleep_minutes" | "body_battery" | "training_load",
  value: number
): boolean {
  if (metric === "sleep_minutes") return value < 360;
  if (metric === "body_battery") return value <= 35;
  return value >= 100;
}

export const DAILY_ASSESSMENT_POLICY_VERSION = "daily-assessment-v1" as const;
export const DAILY_ASSESSMENT_V2_POLICY_VERSION = "daily-assessment-v2" as const;
export const DAILY_ASSESSMENT_V3_POLICY_VERSION = "daily-assessment-v3" as const;
export const DAILY_ASSESSMENT_V4_POLICY_VERSION = "daily-assessment-v4" as const;

export interface DailyAssessmentEvaluation {
  readonly status: DailyAssessmentAvailable["status"];
  readonly reasons: DailyAssessmentAvailable["reasons"];
  readonly missingImportantData: DailyAssessmentAvailable["missingImportantData"];
  readonly recommendedAction: DailyNextAction;
  readonly alternatives: readonly DailyNextAction[];
  readonly limitations: DailyAssessmentAvailable["limitations"];
  readonly confidence: number;
}

function action(type: DailyNextAction["type"], text: string, trainingProgramVersionId: string | null = null): DailyNextAction {
  return { type, text, trainingProgramVersionId };
}

function activeProgramAction(facts: DailyAssessmentUsedFacts): DailyNextAction {
  const step = facts.trainingNextStep;
  if (step?.state === "strength") {
    return action(
      "follow_active_program",
      `Выполни тренировку «${step.workoutName}» из активной программы без добавления упражнений или нагрузки вне неё.`,
      step.programVersionId
    );
  }
  if (step?.state === "light_cardio") {
    return action(
      "follow_active_program",
      `Выполни лёгкое кардио ${Math.round(step.prescription.durationSeconds / 60)} минут со средним пульсом ${step.prescription.targetAverageHeartRateMin}–${step.prescription.targetAverageHeartRateMax}.`,
      facts.activeTrainingProgramVersionId
    );
  }
  if (step?.state === "needs_classification") {
    return action("follow_active_program", step.question, facts.activeTrainingProgramVersionId);
  }
  if (step?.state === "complete_today") {
    return action("recovery_first", "Сегодняшняя тренировка уже выполнена; дополнительная тренировочная нагрузка не нужна.");
  }
  if (step?.state === "week_complete") {
    return action("recovery_first", "Недельные цели активной программы уже выполнены; следующая тренировка пока не нужна.");
  }
  return action(
    "follow_active_program",
    "Следуй активной программе без добавления упражнений или нагрузки вне неё.",
    facts.activeTrainingProgramVersionId
  );
}

/** Produces one conservative next action from an already-normalized typed fact set. */
export function evaluateDailyAssessment(facts: DailyAssessmentUsedFacts): DailyAssessmentEvaluation {
  const missing: Array<DailyAssessmentAvailable["missingImportantData"][number]> = [];
  const reasons: Array<DailyAssessmentAvailable["reasons"][number]> = [];
  const summary = facts.summary;
  if (summary.sleepMinutes === null) missing.push("sleep");
  if (summary.hrvMs === null) missing.push("hrv");
  if (summary.restingHeartRateBpm === null) missing.push("resting_heart_rate");
  if (summary.bodyBattery === null && (summary.bodyBatteryMin === null || summary.bodyBatteryMax === null)) missing.push("body_battery");
  if (summary.recentWorkoutCount + summary.recentExternalActivityCount === 0) missing.push("training");
  if (facts.activeTrainingProgramVersionId === null) missing.push("training_program");
  if (summary.latestWeightKg === null) missing.push("weight");
  if (summary.mealCount === 0) missing.push("nutrition");

  const recoverySignalCount = [
    summary.recoveryRiskLevel,
    summary.sleepMinutes,
    summary.hrvMs,
    summary.restingHeartRateBpm,
    summary.bodyBattery ?? summary.bodyBatteryMax
  ].filter((value) => value !== null).length;
  const recoveryAssessment = facts.recoveryAssessmentIds.length > 0 || recoverySignalCount >= 2;
  const hardStop = summary.recoveryHardStop || summary.recoveryRiskLevel === "blocked";
  const shortSleep = summary.sleepMinutes !== null &&
    isDailyAssessmentAbsoluteMetricConcern("sleep_minutes", summary.sleepMinutes);
  const lowHrv = summary.hrvMs !== null && summary.hrvBaselineMs !== null && summary.hrvMs < summary.hrvBaselineMs * 0.8;
  const highRhr = summary.restingHeartRateBpm !== null && summary.restingHeartRateBaselineBpm !== null && summary.restingHeartRateBpm > summary.restingHeartRateBaselineBpm * 1.1;
  const battery = summary.bodyBattery ?? summary.bodyBatteryMax;
  const lowBattery = battery !== null &&
    isDailyAssessmentAbsoluteMetricConcern("body_battery", battery);
  const highLoad = isDailyAssessmentAbsoluteMetricConcern(
    "training_load", summary.recentTrainingLoad ?? 0
  ) || summary.recentWorkoutCount >= 2;
  if (hardStop) reasons.push("recovery_hard_stop");
  if (shortSleep) reasons.push("short_sleep");
  if (lowHrv) reasons.push("hrv_below_baseline");
  if (highRhr) reasons.push("resting_heart_rate_above_baseline");
  if (lowBattery) reasons.push("low_body_battery");
  if (highLoad) reasons.push("recent_training_load");
  if (facts.activeTrainingProgramVersionId) reasons.push("active_training_program");
  else reasons.push("no_active_training_program");
  if (summary.nutritionCompleteness === "partial") reasons.push("partial_nutrition");
  const sparseCoverageCount = Object.values(facts.coverageReadiness).filter((status) => status === "sparse").length;
  const sparseRecoveryCoverage = [
    facts.coverageReadiness.sleep,
    facts.coverageReadiness.hrv,
    facts.coverageReadiness.restingHeartRate,
    facts.coverageReadiness.bodyBattery
  ].filter((status) => status === "sparse").length >= 3;
  if (!recoveryAssessment || sparseRecoveryCoverage || missing.filter((value) => ["sleep", "hrv", "resting_heart_rate", "body_battery"].includes(value)).length >= 3) reasons.push("sparse_recovery_data");

  const confidence = Math.round(Math.max(0.15, Math.min(0.95, 1 - missing.length * 0.1 - sparseCoverageCount * 0.03)) * 1000) / 1000;
  const limitations: Array<DailyAssessmentAvailable["limitations"][number]> = ["not_medical_advice"];
  if (missing.length > 0) limitations.push("confidence_limited_by_missing_data");
  if (summary.bodyBattery === null && summary.bodyBatteryMin !== null && summary.bodyBatteryMax !== null) limitations.push("body_battery_daily_range_not_current");
  if (summary.nutritionCompleteness === "partial") limitations.push("nutrition_records_may_be_incomplete");
  if (!facts.trainingNextStep || ["local_date_required", "schedule_unavailable"].includes(facts.trainingNextStep.state)) {
    limitations.push("training_schedule_not_inferred");
  }

  let status: DailyAssessmentAvailable["status"];
  let recommendedAction: DailyNextAction;
  if (hardStop || ((shortSleep || lowBattery) && (lowHrv || highRhr || highLoad))) {
    status = "recovery_priority";
    recommendedAction = action("recovery_first", "Сегодня не повышай тренировочную нагрузку и поставь восстановление первым действием.");
  } else if (!recoveryAssessment || missing.filter((value) => ["sleep", "hrv", "resting_heart_rate", "body_battery"].includes(value)).length >= 3) {
    status = "insufficient_data";
    recommendedAction = action("record_recovery_check_in", "Перед решением о тренировке запиши самочувствие, усталость и наличие боли.");
  } else if (shortSleep || lowHrv || highRhr || lowBattery || highLoad) {
    status = "caution";
    recommendedAction = action("recovery_first", "Сегодня сохрани консервативную нагрузку и не выполняй прогрессию.");
  } else if (facts.activeTrainingProgramVersionId) {
    status = "ready";
    recommendedAction = activeProgramAction(facts);
  } else if (summary.nutritionCompleteness === "partial" || summary.mealCount === 0) {
    status = "caution";
    recommendedAction = action("complete_nutrition_record", "Запиши следующий приём пищи с доступной оценкой порции и нутриентов.");
  } else {
    status = "caution";
    recommendedAction = action("confirm_training_program", "Подтверди активную тренировочную программу до получения тренировочной рекомендации.");
  }
  const alternatives = (status === "recovery_priority"
    ? [action("record_recovery_check_in", "Запиши короткий субъективный recovery check-in и отметь боль или признаки болезни.")]
    : [
        facts.activeTrainingProgramVersionId
          ? action("follow_active_program", "Если тренируешься, следуй только активной программе без прогрессии.", facts.activeTrainingProgramVersionId)
          : action("confirm_training_program", "Подтверди программу перед планированием тренировки."),
        action("record_recovery_check_in", "Запиши короткий субъективный recovery check-in.")
      ])
    .filter((candidate) => candidate.type !== recommendedAction.type)
    .slice(0, 2);
  return { status, reasons: [...new Set(reasons)], missingImportantData: missing, recommendedAction, alternatives, limitations: [...new Set(limitations)], confidence };
}

/** Stable checksum over policy, Person-local context, and sorted typed evidence. */
export function dailyAssessmentChecksum(localDate: string, timezone: string, facts: DailyAssessmentUsedFacts): string {
  return createHash("sha256").update(JSON.stringify({ policyVersion: DAILY_ASSESSMENT_POLICY_VERSION, localDate, timezone, facts })).digest("hex");
}

/** Stable checksum for v2 facts plus the exact private personal calculation. */
export function dailyAssessmentV2Checksum(
  localDate: string,
  timezone: string,
  facts: DailyAssessmentUsedFacts,
  personalCalculation: unknown,
  selectedDecision: unknown
): string {
  return createHash("sha256").update(JSON.stringify({
    policyVersion: DAILY_ASSESSMENT_V2_POLICY_VERSION,
    localDate,
    timezone,
    facts,
    personalCalculation,
    selectedDecision
  })).digest("hex");
}

/** Stable checksum for V3 facts, personal calculation and movement decision. */
export function dailyAssessmentV3Checksum(
  localDate: string,
  timezone: string,
  facts: DailyAssessmentUsedFacts,
  personalCalculation: unknown,
  movement: unknown,
  selectedDecision: unknown
): string {
  return createHash("sha256").update(JSON.stringify({
    policyVersion: DAILY_ASSESSMENT_V3_POLICY_VERSION,
    localDate,
    timezone,
    facts,
    personalCalculation,
    movement,
    selectedDecision
  })).digest("hex");
}

/** Stable checksum for V4, including its machine-verifiable action criteria. */
export function dailyAssessmentV4Checksum(
  localDate: string,
  timezone: string,
  facts: DailyAssessmentUsedFacts,
  personalCalculation: unknown,
  movement: unknown,
  selectedDecision: unknown
): string {
  return createHash("sha256").update(JSON.stringify({
    policyVersion: DAILY_ASSESSMENT_V4_POLICY_VERSION,
    localDate,
    timezone,
    facts,
    personalCalculation,
    movement,
    selectedDecision
  })).digest("hex");
}
