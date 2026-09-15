import { Inject, Injectable } from "@nestjs/common";

import type { DailyAssessmentResult, DailyAssessmentUsedFacts, PersonPreferences, RecoveryObservation, UpdatePersonPreferences } from "@shape-of-you/contracts";

import type { PersonContext } from "../application/person-context.js";
import { DAILY_ASSESSMENT_STORE, PERSON_CONTEXT } from "../application/tokens.js";
import { assertIanaTimezone } from "../domain/date-context.js";
import { DAILY_ASSESSMENT_POLICY_VERSION, dailyAssessmentChecksum, evaluateDailyAssessment } from "../domain/daily-assessment.js";
import { buildCoverageDirection, shiftLocalDate } from "../progress-overview/progress-data-coverage.policy.js";
import { NutritionService } from "../nutrition/nutrition.service.js";
import { RecoveryService } from "../recovery/recovery.service.js";
import type { DailyAssessmentStore } from "../storage/daily-assessment-repository.js";
import { TrainingService } from "../training/training.service.js";
import { WeightMeasurementService } from "../weight-measurements/weight-measurement.service.js";

/** Derives the calendar date used by the daily policy in the Person-owned timezone. */
export function derivePersonLocalDate(timezone: string, now = new Date()): string {
  return new Intl.DateTimeFormat("en-CA", { timeZone: timezone, year: "numeric", month: "2-digit", day: "2-digit" }).format(now);
}

function median(values: readonly number[]): number | null {
  if (values.length < 7) return null;
  const sorted = [...values].sort((a, b) => a - b);
  const middle = Math.floor(sorted.length / 2);
  return sorted.length % 2 === 0 ? (sorted[middle - 1]! + sorted[middle]!) / 2 : sorted[middle]!;
}

function latestMetric(observations: readonly RecoveryObservation[], metric: string): number | null {
  const found = observations.find((item) => item.detail.type === "metric" && item.detail.metric === metric && item.quality !== "poor");
  return found?.detail.type === "metric" ? found.detail.value : null;
}

/** Composes and snapshots the API-owned daily Coaching decision. */
@Injectable()
export class DailyAssessmentService {
  public constructor(
    @Inject(DAILY_ASSESSMENT_STORE) private readonly store: DailyAssessmentStore,
    @Inject(PERSON_CONTEXT) private readonly personContext: PersonContext,
    @Inject(RecoveryService) private readonly recovery: RecoveryService,
    @Inject(TrainingService) private readonly training: TrainingService,
    @Inject(NutritionService) private readonly nutrition: NutritionService,
    @Inject(WeightMeasurementService) private readonly weights: WeightMeasurementService
  ) {}

  public preferences(): Promise<PersonPreferences> { return this.store.getPreferences(this.personContext.getPersonId()); }

  public updatePreferences(input: UpdatePersonPreferences): Promise<PersonPreferences> {
    assertIanaTimezone(input.timezone);
    return this.store.setTimezone(this.personContext.getPersonId(), input.timezone);
  }

  public async read(): Promise<DailyAssessmentResult> {
    const personId = this.personContext.getPersonId();
    const preferences = await this.store.getPreferences(personId);
    if (preferences.timezone === null) return { state: "timezone_required", timezone: null };
    assertIanaTimezone(preferences.timezone);
    const timezone = preferences.timezone;
    const localDate = derivePersonLocalDate(timezone);
    const from = shiftLocalDate(localDate, -28);
    const coverageFrom = shiftLocalDate(localDate, -90);
    const [observations, assessments, training, meals, totals, weights, recoveryCoverage, trainingCoverage, nutritionCoverage, weightCoverage] = await Promise.all([
      this.recovery.listObservationsForLocalDateRange(from, localDate),
      this.recovery.listAssessmentsForLocalDate(localDate),
      this.training.getTrainingContext({ historyLimit: 20 }),
      this.nutrition.listMealsForLocalDate(localDate),
      this.nutrition.dailyTotals(localDate),
      this.weights.listForLocalDateRange(from, localDate),
      this.recovery.getDataCoverage(coverageFrom, localDate, localDate),
      this.training.getDataCoverage(coverageFrom, localDate, localDate),
      this.nutrition.getDataCoverage(coverageFrom, localDate, localDate),
      this.weights.getDataCoverage(coverageFrom, localDate, localDate)
    ]);
    const sortedObservations = [...observations].sort((a, b) =>
      b.localDate.localeCompare(a.localDate) ||
      (b.observedFrom ?? "").localeCompare(a.observedFrom ?? "") ||
      b.createdAt.localeCompare(a.createdAt)
    );
    const currentRecovery = sortedObservations.filter((item) => item.localDate === localDate);
    const sleep = currentRecovery.find((item) => item.detail.type === "sleep" && item.quality !== "poor");
    const hrvValues = sortedObservations.filter((item) => item.detail.type === "metric" && item.detail.metric === "hrv_rmssd" && item.quality !== "poor").map((item) => item.detail.type === "metric" ? item.detail.value : 0);
    const rhrValues = sortedObservations.filter((item) => item.detail.type === "metric" && item.detail.metric === "resting_heart_rate" && item.quality !== "poor").map((item) => item.detail.type === "metric" ? item.detail.value : 0);
    const activeVersionId = training.status === "active" ? training.program.activeVersionId : null;
    const recentFrom = shiftLocalDate(localDate, -2);
    const recentSessions = training.recentSessions.items.filter((item) => item.localDate >= recentFrom && item.localDate <= localDate);
    const recentExternal = training.recentExternalActivities.filter((item) => item.localDate >= recentFrom && item.localDate <= localDate);
    const assessment = assessments[0] ?? null;
    const subjectiveHardStop = currentRecovery.some((item) => item.detail.type === "subjective" && (item.detail.acuteIllness || item.detail.injuryConcern));
    const facts: DailyAssessmentUsedFacts = {
      recoveryObservationIds: sortedObservations.map((item) => item.id).sort(),
      recoveryAssessmentIds: assessments.map((item) => item.id).sort(),
      workoutSessionIds: training.recentSessions.items.map((item) => item.id).sort(),
      externalActivityIds: training.recentExternalActivities.map((item) => item.id).sort(),
      mealIds: meals.map((item) => item.id).sort(),
      weightMeasurementIds: weights.map((item) => item.id).sort(),
      activeTrainingProgramVersionId: activeVersionId,
      coveragePolicyVersion: "profile-data-coverage-v1",
      coverageReadiness: {
        sleep: buildCoverageDirection("sleep", localDate, recoveryCoverage.sleep).status,
        hrv: buildCoverageDirection("hrv", localDate, recoveryCoverage.hrv).status,
        restingHeartRate: buildCoverageDirection("resting_heart_rate", localDate, recoveryCoverage.restingHeartRate).status,
        bodyBattery: buildCoverageDirection("body_battery", localDate, recoveryCoverage.bodyBattery).status,
        training: buildCoverageDirection("training", localDate, trainingCoverage).status,
        weight: buildCoverageDirection("weight", localDate, weightCoverage).status,
        nutrition: buildCoverageDirection("nutrition", localDate, nutritionCoverage).status
      },
      summary: {
        recoveryRiskLevel: assessment?.riskLevel ?? null,
        recoveryHardStop: assessment?.hardStop ?? subjectiveHardStop,
        sleepMinutes: sleep?.detail.type === "sleep" ? sleep.detail.totalSleepMinutes : null,
        hrvMs: latestMetric(currentRecovery, "hrv_rmssd"),
        hrvBaselineMs: median(hrvValues.slice(1)),
        restingHeartRateBpm: latestMetric(currentRecovery, "resting_heart_rate"),
        restingHeartRateBaselineBpm: median(rhrValues.slice(1)),
        bodyBattery: latestMetric(currentRecovery, "body_battery"),
        bodyBatteryMin: latestMetric(currentRecovery, "body_battery_min"),
        bodyBatteryMax: latestMetric(currentRecovery, "body_battery_max"),
        recentWorkoutCount: recentSessions.length,
        recentExternalActivityCount: recentExternal.length,
        recentTrainingLoad: recentExternal.some((item) => item.trainingLoad !== null) ? recentExternal.reduce((sum, item) => sum + (item.trainingLoad ?? 0), 0) : null,
        nutritionCompleteness: totals.nutritionCompleteness,
        mealCount: totals.mealCount,
        caloriesKcal: totals.totals.caloriesKcal,
        proteinG: totals.totals.proteinG,
        latestWeightKg: weights[0]?.weightKg ?? null
      }
    };
    const evaluation = evaluateDailyAssessment(facts);
    const evidenceChecksum = dailyAssessmentChecksum(localDate, timezone, facts);
    return this.store.createOrGet(personId, {
      localDate, timezone, ...evaluation, usedFacts: facts,
      policyVersion: DAILY_ASSESSMENT_POLICY_VERSION,
      evidenceChecksum
    });
  }
}
