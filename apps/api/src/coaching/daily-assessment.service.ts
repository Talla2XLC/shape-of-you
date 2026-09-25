import { Inject, Injectable } from "@nestjs/common";

import type {
  CreateDailyRecommendationFeedback,
  DailyCompletionCriterion,
  DailyCompletionCriterionResult,
  DailyAssessmentMovement,
  DailyAssessmentAvailableV4,
  DailyAssessmentResult,
  DailyAssessmentV2UsedFacts,
  DailyRecommendationFeedbackList,
  DailyRecommendationCompletionAssessment,
  PersonPreferences,
  RecoveryObservation,
  UpdatePersonPreferences
} from "@shape-of-you/contracts";

import type { PersonContext } from "../application/person-context.js";
import { DAILY_ASSESSMENT_STORE, PERSON_CONTEXT } from "../application/tokens.js";
import { assertIanaTimezone } from "../domain/date-context.js";
import {
  DAILY_ASSESSMENT_V4_POLICY_VERSION,
  dailyAssessmentV4Checksum,
  evaluateDailyAssessment
} from "../domain/daily-assessment.js";
import { withDailyCompletionSpecification } from "../domain/daily-recommendation-completion.js";
import {
  dailyCompletionEvidenceChecksum,
  evaluateDailyRecommendationCompletion
} from "../domain/daily-recommendation-completion.js";
import { applyConservativePersonalOverlay } from "../domain/daily-assessment-personal-overlay.js";
import {
  evaluatePersonalizedDailyAssessmentV3,
  type PersonalAssessmentEvidenceDay
} from "../domain/personalized-daily-assessment.js";
import { activePersonalBaselinePolicy } from "../domain/personal-baseline.js";
import { countUncoveredExternalActivities } from "../domain/training.js";
import { buildCoverageDirection, shiftLocalDate } from "../progress-overview/progress-data-coverage.policy.js";
import { NutritionService } from "../nutrition/nutrition.service.js";
import { RecoveryService } from "../recovery/recovery.service.js";
import type {
  CreatedDailyRecommendationFeedback,
  DailyAssessmentStore
} from "../storage/daily-assessment-repository.js";
import { TrainingService } from "../training/training.service.js";
import { WeightMeasurementService } from "../weight-measurements/weight-measurement.service.js";
import { DailyContextNoteService } from "../daily-context-notes/daily-context-note.service.js";
import { DailyAssessmentEvidenceChangedError } from "../domain/errors.js";

/** Retries a composition when its evidence revision changes, then fails closed. */
export async function withDailyAssessmentConsistency<T>(
  operation: () => Promise<T>,
  maximumAttempts = 3
): Promise<T> {
  for (let attempt = 1; attempt <= maximumAttempts; attempt += 1) {
    try {
      return await operation();
    } catch (error) {
      if (!(error instanceof DailyAssessmentEvidenceChangedError) || attempt === maximumAttempts) {
        throw error;
      }
    }
  }
  throw new DailyAssessmentEvidenceChangedError();
}

/** Derives the calendar date used by the daily policy in the Person-owned timezone. */
export function derivePersonLocalDate(timezone: string, now = new Date()): string {
  return new Intl.DateTimeFormat("en-CA", { timeZone: timezone, year: "numeric", month: "2-digit", day: "2-digit" }).format(now);
}

/** Exact immutable recommendation reference used only for Coach orchestration. */
export interface DailyRecommendationReference {
  readonly snapshotId: string;
  readonly localDate: string;
  readonly recommendedAction: DailyAssessmentAvailableV4["recommendedAction"];
}

/** DailyAssessment plus one bounded previous-day recommendation candidate. */
export interface DailyAssessmentCoachContext {
  readonly assessment: DailyAssessmentResult;
  readonly previousRecommendation: DailyRecommendationReference | null;
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
    @Inject(WeightMeasurementService) private readonly weights: WeightMeasurementService,
    @Inject(DailyContextNoteService) private readonly contextNotes: DailyContextNoteService
  ) {}

  public preferences(): Promise<PersonPreferences> { return this.store.getPreferences(this.personContext.getPersonId()); }

  public updatePreferences(input: UpdatePersonPreferences): Promise<PersonPreferences> {
    assertIanaTimezone(input.timezone);
    const personId = this.personContext.getPersonId();
    return input.ifTimezoneUnset === true
      ? this.store.setTimezone(personId, input.timezone, { ifUnset: true })
      : this.store.setTimezone(personId, input.timezone);
  }

  public read(): Promise<DailyAssessmentResult> {
    return withDailyAssessmentConsistency(() => this.readConsistent());
  }

  /** Composes fresh MCP guidance without changing the public assessment result. */
  public async readCoachContext(): Promise<DailyAssessmentCoachContext> {
    const assessment = await this.read();
    if (assessment.state !== "available") {
      return { assessment, previousRecommendation: null };
    }
    const previous = await this.store.findLatestV4SnapshotForLocalDate(
      this.personContext.getPersonId(),
      shiftLocalDate(assessment.localDate, -1)
    );
    return {
      assessment,
      previousRecommendation: previous === null
        ? null
        : {
            snapshotId: previous.snapshotId,
            localDate: previous.localDate,
            recommendedAction: previous.recommendedAction
          }
    };
  }

  /** Records one idempotent typed event about an exact daily snapshot. */
  public recordFeedback(
    input: CreateDailyRecommendationFeedback
  ): Promise<CreatedDailyRecommendationFeedback> {
    return this.store.recordFeedback(this.personContext.getPersonId(), input);
  }

  /** Reads the ordered feedback history for one exact daily snapshot. */
  public listFeedback(snapshotId: string): Promise<DailyRecommendationFeedbackList> {
    return this.store.listFeedback(this.personContext.getPersonId(), snapshotId);
  }

  /** Lazily materializes an immutable completion conclusion from current owner facts. */
  public async readCompletion(snapshotId: string): Promise<DailyRecommendationCompletionAssessment> {
    const personId = this.personContext.getPersonId();
    const snapshot = await this.store.getCompletionSnapshot(personId, snapshotId);
    const [weights, meals, sessions, observations, training, feedback] = await Promise.all([
      this.weights.listForLocalDate(snapshot.localDate),
      this.nutrition.listMealsForLocalDate(snapshot.localDate),
      this.training.listWorkoutSessionsForLocalDate(snapshot.localDate),
      this.recovery.listObservationsForLocalDate(snapshot.localDate),
      this.training.getTrainingContext({ historyLimit: 50, localDate: snapshot.localDate }),
      this.store.listFeedback(personId, snapshotId)
    ]);
    const asOf = snapshot.createdAt;
    const results = snapshot.recommendedAction.completion.criteria.map((criterion) =>
      evaluateCompletionCriterion(criterion, asOf, { localDate: snapshot.localDate, weights, meals, sessions, observations, training })
    );
    const superseded = new Set(feedback.items.map((item) => item.supersedesFeedbackId).filter(Boolean));
    const activeDisposition = [...feedback.items].reverse().find((item) =>
      !superseded.has(item.id) && (item.status === "completed" || item.status === "skipped")
    ) ?? null;
    const disposition = activeDisposition?.status === "completed" || activeDisposition?.status === "skipped"
      ? activeDisposition.status
      : null;
    const evaluation = evaluateDailyRecommendationCompletion(
      snapshot.recommendedAction.completion.criteria,
      results,
      disposition
    );
    const evidenceChecksum = dailyCompletionEvidenceChecksum({
      snapshotId,
      criteria: snapshot.recommendedAction.completion.criteria,
      results,
      activeFeedback: activeDisposition === null
        ? null
        : { id: activeDisposition.id, status: activeDisposition.status }
    });
    return this.store.createOrGetCompletion(personId, {
      snapshot,
      criteria: results,
      ...evaluation,
      evidenceChecksum
    });
  }

  private async readConsistent(): Promise<DailyAssessmentResult> {
    const personId = this.personContext.getPersonId();
    const preferences = await this.store.getPreferences(personId);
    if (preferences.timezone === null) return { state: "timezone_required", timezone: null };
    assertIanaTimezone(preferences.timezone);
    const timezone = preferences.timezone;
    const calculatedAt = new Date();
    const localDate = derivePersonLocalDate(timezone, calculatedAt);
    const from = shiftLocalDate(localDate, -28);
    const baselineFrom = shiftLocalDate(
      localDate,
      -activePersonalBaselinePolicy.maximumLookbackDays
    );
    const coverageFrom = shiftLocalDate(localDate, -90);
    const evidenceRevisionBefore = await this.store.getEvidenceRevision(
      personId,
      coverageFrom,
      localDate
    );
    const [
      observations,
      assessments,
      training,
      meals,
      totals,
      weights,
      recoveryCoverage,
      trainingCoverage,
      nutritionCoverage,
      weightCoverage,
      recoveryBaselineDays,
      trainingBaselineDays,
      contextNotes
    ] = await Promise.all([
      this.recovery.listObservationsForLocalDateRange(from, localDate),
      this.recovery.listAssessmentsForLocalDate(localDate),
      this.training.getTrainingContext({ historyLimit: 20, localDate }),
      this.nutrition.listMealsForLocalDate(localDate),
      this.nutrition.dailyTotals(localDate),
      this.weights.listForLocalDateRange(from, localDate),
      this.recovery.getDataCoverage(coverageFrom, localDate, localDate),
      this.training.getDataCoverage(coverageFrom, localDate, localDate),
      this.nutrition.getDataCoverage(coverageFrom, localDate, localDate),
      this.weights.getDataCoverage(coverageFrom, localDate, localDate),
      this.recovery.listPersonalBaselineDays(baselineFrom, localDate),
      this.training.listPersonalBaselineDays(baselineFrom, localDate),
      this.contextNotes.listForLocalDateRange(baselineFrom, localDate)
    ]);
    const evidenceRevisionAfter = await this.store.getEvidenceRevision(
      personId,
      coverageFrom,
      localDate
    );
    if (evidenceRevisionBefore !== evidenceRevisionAfter) {
      throw new DailyAssessmentEvidenceChangedError();
    }
    const sortedObservations = [...observations].sort((a, b) =>
      b.localDate.localeCompare(a.localDate) ||
      (b.observedFrom ?? "").localeCompare(a.observedFrom ?? "") ||
      b.createdAt.localeCompare(a.createdAt)
    );
    const currentRecovery = sortedObservations.filter((item) => item.localDate === localDate);
    const currentStepsObservation = currentRecovery
      .filter((item): item is RecoveryObservation & {
        readonly detail: { readonly type: "metric"; readonly metric: "steps"; readonly value: number };
        readonly sourceReference: RecoveryObservation["sourceReference"] & { readonly occurredAt: string };
      } => {
        if (
          item.detail.type !== "metric" || item.detail.metric !== "steps" ||
          item.quality === "poor" || item.sourceReference.occurredAt === null
        ) return false;
        const asOf = new Date(item.sourceReference.occurredAt);
        return !Number.isNaN(asOf.valueOf()) &&
          derivePersonLocalDate(timezone, asOf) === localDate &&
          asOf.valueOf() <= calculatedAt.valueOf() + 5 * 60_000;
      })
      .sort((left, right) =>
        right.detail.value - left.detail.value ||
        right.sourceReference.occurredAt.localeCompare(left.sourceReference.occurredAt)
      )[0];
    const currentStepsAsOf = currentStepsObservation?.sourceReference.occurredAt ?? null;
    const currentStepsEligible = currentStepsObservation !== undefined;
    const sleep = currentRecovery.find((item) => item.detail.type === "sleep" && item.quality !== "poor");
    const hrvValues = sortedObservations.filter((item) => item.detail.type === "metric" && item.detail.metric === "hrv_rmssd" && item.quality !== "poor").map((item) => item.detail.type === "metric" ? item.detail.value : 0);
    const rhrValues = sortedObservations.filter((item) => item.detail.type === "metric" && item.detail.metric === "resting_heart_rate" && item.quality !== "poor").map((item) => item.detail.type === "metric" ? item.detail.value : 0);
    const activeVersionId = training.status === "active" ? training.program.activeVersionId : null;
    const recentFrom = shiftLocalDate(localDate, -2);
    const recentSessions = training.recentSessions.items.filter((item) => item.localDate >= recentFrom && item.localDate <= localDate);
    const recentExternal = training.recentExternalActivities.filter((item) => item.localDate >= recentFrom && item.localDate <= localDate);
    const assessment = assessments[0] ?? null;
    const subjectiveHardStop = currentRecovery.some((item) => item.detail.type === "subjective" && (item.detail.acuteIllness || item.detail.injuryConcern));
    const baselineRecoveryObservationIds = recoveryBaselineDays.flatMap((day) => day.observationIds);
    const baselineRecoveryAssessmentIds = recoveryBaselineDays.flatMap((day) => day.assessmentIds);
    const baselineWorkoutSessionIds = trainingBaselineDays.flatMap((day) => day.workoutSessionIds);
    const baselineExternalActivityIds = trainingBaselineDays.flatMap((day) => day.externalActivityIds);
    const unique = (values: readonly string[]) => [...new Set(values)].sort();
    const facts: DailyAssessmentV2UsedFacts = {
      recoveryObservationIds: unique([
        ...sortedObservations.map((item) => item.id),
        ...baselineRecoveryObservationIds
      ]),
      recoveryAssessmentIds: unique([
        ...assessments.map((item) => item.id),
        ...baselineRecoveryAssessmentIds
      ]),
      workoutSessionIds: unique([
        ...training.recentSessions.items.map((item) => item.id),
        ...baselineWorkoutSessionIds
      ]),
      externalActivityIds: unique([
        ...training.recentExternalActivities.map((item) => item.id),
        ...baselineExternalActivityIds
      ]),
      mealIds: meals.map((item) => item.id).sort(),
      weightMeasurementIds: weights.map((item) => item.id).sort(),
      activeTrainingProgramVersionId: activeVersionId,
      trainingNextStep: training.nextStep,
      dailyContextNoteIds: unique(contextNotes.items.map((item) => item.id)),
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
        recentExternalActivityCount: countUncoveredExternalActivities(recentSessions, recentExternal),
        recentTrainingLoad: recentExternal.some((item) => item.trainingLoad !== null) ? recentExternal.reduce((sum, item) => sum + (item.trainingLoad ?? 0), 0) : null,
        nutritionCompleteness: totals.nutritionCompleteness,
        mealCount: totals.mealCount,
        caloriesKcal: totals.totals.caloriesKcal,
        proteinG: totals.totals.proteinG,
        latestWeightKg: weights[0]?.weightKg ?? null
      }
    };
    const baseEvaluation = evaluateDailyAssessment(facts);
    const recoveryByDate = new Map(recoveryBaselineDays.map((day) => [day.localDate, day]));
    const trainingByDate = new Map(trainingBaselineDays.map((day) => [day.localDate, day]));
    const excludedDates = new Set(
      contextNotes.items
        .filter((note) => note.baselineEligibility === "exclude")
        .map((note) => note.localDate)
    );
    const evidenceDates = new Set([
      ...recoveryBaselineDays.map((day) => day.localDate),
      ...trainingBaselineDays.map((day) => day.localDate),
      ...contextNotes.items.map((note) => note.localDate),
      localDate
    ]);
    const personalDays: PersonalAssessmentEvidenceDay[] = [...evidenceDates]
      .sort()
      .map((date) => {
        const recovery = recoveryByDate.get(date);
        const trainingDay = trainingByDate.get(date);
        const values: PersonalAssessmentEvidenceDay["values"] = {
          ...(recovery?.sleepMinutes == null ? {} : { sleep_minutes: recovery.sleepMinutes }),
          ...(recovery?.hrvRmssd == null ? {} : { hrv_rmssd: recovery.hrvRmssd }),
          ...(recovery?.restingHeartRate == null ? {} : { resting_heart_rate: recovery.restingHeartRate }),
          ...(recovery?.bodyBattery == null ? {} : { body_battery: recovery.bodyBattery }),
          ...(recovery?.bodyBatteryMin == null ? {} : { body_battery_min: recovery.bodyBatteryMin }),
          ...(recovery?.bodyBatteryMax == null ? {} : { body_battery_max: recovery.bodyBatteryMax }),
          ...(trainingDay?.trainingLoad == null ? {} : { training_load: trainingDay.trainingLoad }),
          ...(date === localDate
            ? currentStepsEligible && currentStepsObservation?.detail.type === "metric"
              ? { steps: currentStepsObservation.detail.value }
              : {}
            : recovery?.steps == null ? {} : { steps: recovery.steps })
        };
        return {
          localDate: date,
          values,
          baselineExcluded: excludedDates.has(date),
          recoveryHardStop: recovery?.hardStop === true ||
            recovery?.acuteIllness === true || recovery?.injuryConcern === true,
          trainingLoadIncompatible: trainingDay?.incompatibleLoadSources ?? false,
          trainingLoadSeriesKey: trainingDay?.loadSeriesKey ?? null,
          recoveryObservationIds: recovery?.observationIds ?? [],
          recoveryAssessmentIds: recovery?.assessmentIds ?? [],
          externalActivityIds: trainingDay?.externalActivityIds ?? [],
          partialDayMetrics: date === localDate && currentStepsEligible ? ["steps"] : []
        };
      });
    const personal = evaluatePersonalizedDailyAssessmentV3(localDate, personalDays);
    const overlay = applyConservativePersonalOverlay(
      baseEvaluation.status,
      baseEvaluation.recommendedAction,
      personal.signals
    );
    const limitations = [...baseEvaluation.limitations];
    if (
      personal.publicBaseline.comparisons.find((item) => item.metric === "training_load")
        ?.availability === "incompatible"
    ) limitations.push("training_load_baseline_unavailable");
    const evaluation = {
      ...baseEvaluation,
      status: overlay.status,
      recommendedAction: overlay.action,
      reasons: [...new Set([...baseEvaluation.reasons, ...personal.reasons])],
      limitations: [...new Set(limitations)]
    };
    const stepsComparison = personal.publicBaseline.comparisons.find((item) => item.metric === "steps");
    const movement: DailyAssessmentMovement = currentStepsEligible &&
      currentStepsObservation?.detail.type === "metric" && currentStepsAsOf !== null
      ? {
          status: "available",
          summary: stepsComparison?.availability === "available"
            ? stepsComparison.position === "above_usual"
              ? "Ты уже прошёл больше своего обычного полного дня."
              : "Текущие шаги ещё не превышают твой обычный полный день."
            : "Сегодняшние шаги доступны, но личная норма пока не накоплена.",
          current: {
            role: "partial_day",
            steps: currentStepsObservation.detail.value,
            asOf: currentStepsAsOf,
            position: stepsComparison?.availability !== "available"
              ? "baseline_unavailable"
              : stepsComparison.position === "above_usual"
                ? "above_full_day_usual"
                : "within_or_below_full_day_usual",
            severity: stepsComparison?.availability === "available"
              ? stepsComparison.severity
              : null
          }
        }
      : { status: "unavailable", summary: null, current: null };
    const v4Evaluation = {
      ...evaluation,
      recommendedAction: withDailyCompletionSpecification(evaluation.recommendedAction)
    };
    const evidenceChecksum = dailyAssessmentV4Checksum(
      localDate,
      timezone,
      facts,
      personal.calculation,
      movement,
      { ...v4Evaluation, personalBaseline: personal.publicBaseline }
    );
    return this.store.createOrGet(personId, {
      localDate, timezone, ...v4Evaluation, usedFacts: facts,
      policyVersion: DAILY_ASSESSMENT_V4_POLICY_VERSION,
      evidenceChecksum,
      personalBaseline: personal.publicBaseline,
      personalBaselineCalculation: personal.calculation,
      movement
    }, {
      expectedRevision: evidenceRevisionAfter,
      expectedTimezone: timezone,
      expectedPreferencesUpdatedAt: preferences.updatedAt,
      from: coverageFrom,
      to: localDate
    });
  }
}

type CompletionFacts = {
  readonly localDate: string;
  readonly weights: Awaited<ReturnType<WeightMeasurementService["listForLocalDate"]>>;
  readonly meals: Awaited<ReturnType<NutritionService["listMealsForLocalDate"]>>;
  readonly sessions: Awaited<ReturnType<TrainingService["listWorkoutSessionsForLocalDate"]>>;
  readonly observations: Awaited<ReturnType<RecoveryService["listObservationsForLocalDate"]>>;
  readonly training: Awaited<ReturnType<TrainingService["getTrainingContext"]>>;
};

function unknownCriterion(criterion: DailyCompletionCriterion, limitation: DailyCompletionCriterionResult["limitations"][number] = "source_unknown"): DailyCompletionCriterionResult {
  return {
    criterionId: criterion.id,
    status: "unknown",
    freshness: limitation === "source_stale" ? "stale" : "unknown",
    completeness: "unknown",
    observedAt: null,
    evidence: null,
    limitations: [limitation]
  };
}

function evaluateCompletionCriterion(
  criterion: DailyCompletionCriterion,
  asOf: string,
  facts: CompletionFacts
): DailyCompletionCriterionResult {
  const isFresh = (createdAt: string) => createdAt > asOf;
  const result = (
    status: DailyCompletionCriterionResult["status"],
    completeness: DailyCompletionCriterionResult["completeness"],
    observedAt: string,
    factType: NonNullable<DailyCompletionCriterionResult["evidence"]>["factType"],
    factId: string,
    limitations: DailyCompletionCriterionResult["limitations"] = []
  ): DailyCompletionCriterionResult => ({
    criterionId: criterion.id,
    status,
    freshness: "fresh",
    completeness,
    observedAt,
    evidence: { ownerDomain: criterion.ownerDomain, factType, factId },
    limitations
  });

  if (criterion.type === "weight_recorded") {
    const fact = facts.weights.find((item) => isFresh(item.createdAt));
    return fact ? result("satisfied", "complete", fact.measuredAt ?? fact.createdAt, "weight_measurement", fact.id)
      : facts.weights.length > 0 ? unknownCriterion(criterion, "source_stale") : unknownCriterion(criterion);
  }
  if (criterion.type === "meal_recorded") {
    const fact = facts.meals.find((item) => isFresh(item.createdAt));
    return fact ? result("satisfied", fact.nutritionCompleteness, fact.occurredAt ?? fact.createdAt, "meal", fact.id,
      fact.nutritionCompleteness === "partial" ? ["source_partial"] : [])
      : facts.meals.length > 0 ? unknownCriterion(criterion, "source_stale") : unknownCriterion(criterion);
  }
  if (criterion.type === "program_workout_completed") {
    const fact = facts.sessions.find((item) => isFresh(item.createdAt) && item.programVersionId === criterion.trainingProgramVersionId);
    if (fact) return result("satisfied", "complete", fact.occurredAt ?? fact.createdAt, "workout_session", fact.id);
    const external = facts.training.recentExternalActivities.find((item) =>
      item.localDate === facts.localDate && item.occurredAt > asOf
    );
    if (external) return result("partial", "partial", external.occurredAt, "external_activity", external.id, ["external_activity_not_program_linked"]);
    return unknownCriterion(criterion);
  }
  if (criterion.type === "recovery_check_in_recorded") {
    const fact = facts.observations.find((item) => isFresh(item.createdAt) && item.detail.type === "subjective");
    return fact ? result("satisfied", fact.quality === "reliable" ? "complete" : "partial", fact.observedUntil ?? fact.observedFrom ?? fact.createdAt, "recovery_observation", fact.id,
      fact.quality === "reliable" ? [] : ["source_partial"]) : unknownCriterion(criterion);
  }
  if (criterion.type === "steps_threshold_reached" || criterion.type === "sleep_duration_reached") {
    const fact = facts.observations.find((item) => isFresh(item.createdAt) && (
      criterion.type === "steps_threshold_reached"
        ? item.detail.type === "metric" && item.detail.metric === "steps"
        : item.detail.type === "sleep"
    ));
    if (!fact) return unknownCriterion(criterion);
    const value = fact.detail.type === "sleep" ? fact.detail.totalSleepMinutes
      : fact.detail.type === "metric" ? fact.detail.value : 0;
    return result(value >= (criterion.targetValue ?? Number.POSITIVE_INFINITY) ? "satisfied" : "partial",
      fact.quality === "reliable" ? "complete" : "partial",
      fact.observedUntil ?? fact.observedFrom ?? fact.createdAt,
      "recovery_observation", fact.id,
      fact.quality === "reliable" ? [] : ["source_partial"]);
  }
  if (criterion.type === "training_program_confirmed") {
    const version = facts.training.status === "active" ? facts.training.program.activeVersion : null;
    return version && isFresh(version.createdAt)
      ? result("satisfied", "complete", version.createdAt, "training_program_version", version.id)
      : unknownCriterion(criterion);
  }
  return unknownCriterion(criterion, "action_requires_self_report");
}
