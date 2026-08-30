import { Inject, Injectable } from "@nestjs/common";

import type {
  ProgressFactCounts,
  ProgressMetricKey,
  ProgressMetricPoint,
  ProgressOverview,
  ProgressOverviewQuery
} from "@shape-of-you/contracts";

import { BodyMeasurementSessionService } from "../body-measurement-sessions/body-measurement-session.service.js";
import { CoachingService } from "../coaching/coaching.service.js";
import { assertIanaTimezone, assertLocalDate } from "../domain/date-context.js";
import { DomainValidationError } from "../domain/errors.js";
import { deriveLocalDate } from "../domain/weight-measurement.js";
import { NutritionService } from "../nutrition/nutrition.service.js";
import { RecoveryService } from "../recovery/recovery.service.js";
import { TrainingService } from "../training/training.service.js";
import { WeightMeasurementService } from "../weight-measurements/weight-measurement.service.js";

const metricMetadata: Readonly<Record<ProgressMetricKey, { label: string; unit: string }>> = {
  weight_kg: { label: "Weight", unit: "kg" },
  calories_kcal: { label: "Calories", unit: "kcal" },
  protein_g: { label: "Protein", unit: "g" },
  workout_session_count: { label: "Workout sessions", unit: "sessions" },
  readiness_score: { label: "Readiness", unit: "score" }
};

const metricKeys = Object.keys(metricMetadata) as ProgressMetricKey[];

function dateOrdinal(value: string): number {
  return Date.parse(`${value}T00:00:00.000Z`) / 86_400_000;
}

function emptyCounts(): ProgressFactCounts {
  return {
    weightMeasurements: 0,
    bodyMeasurementSessions: 0,
    meals: 0,
    workoutSessions: 0,
    recoveryObservations: 0,
    recoveryAssessments: 0,
    coachingRecommendations: 0
  };
}

/** Coordinates bounded module-owned range reads into a sparse progress view. */
@Injectable()
export class ProgressOverviewService {
  public constructor(
    @Inject(WeightMeasurementService) private readonly weights: WeightMeasurementService,
    @Inject(BodyMeasurementSessionService) private readonly bodyMeasurements: BodyMeasurementSessionService,
    @Inject(NutritionService) private readonly nutrition: NutritionService,
    @Inject(TrainingService) private readonly training: TrainingService,
    @Inject(RecoveryService) private readonly recovery: RecoveryService,
    @Inject(CoachingService) private readonly coaching: CoachingService
  ) {}

  /** Reads one inclusive range of at most 366 Person-local calendar days. */
  public async read(query: ProgressOverviewQuery): Promise<ProgressOverview> {
    this.validate(query);
    const [weights, bodyMeasurements, meals, workouts, observations, assessments, coaching] = await Promise.all([
      this.weights.listForLocalDateRange(query.from, query.to),
      this.bodyMeasurements.listForLocalDateRange(query.from, query.to),
      this.nutrition.listMealsForLocalDateRange(query.from, query.to),
      this.training.listWorkoutSessionsForLocalDateRange(query.from, query.to),
      this.recovery.listObservationsForLocalDateRange(query.from, query.to),
      this.recovery.listAssessmentsForLocalDateRange(query.from, query.to),
      this.coaching.listForLocalDateRange(query.from, query.to, query.timezone)
    ]);

    const facts = new Map<string, ProgressFactCounts>();
    const count = (localDate: string, key: keyof ProgressFactCounts): void => {
      const current = facts.get(localDate) ?? emptyCounts();
      facts.set(localDate, { ...current, [key]: current[key] + 1 });
    };
    weights.forEach((item) => count(item.localDate, "weightMeasurements"));
    bodyMeasurements.forEach((item) => count(item.localDate, "bodyMeasurementSessions"));
    meals.forEach((item) => count(item.localDate, "meals"));
    workouts.forEach((item) => count(item.localDate, "workoutSessions"));
    observations.forEach((item) => count(item.localDate, "recoveryObservations"));
    assessments.forEach((item) => count(item.localDate, "recoveryAssessments"));
    coaching.forEach((item) => count(deriveLocalDate(new Date(item.asOf), query.timezone), "coachingRecommendations"));

    const points = new Map<ProgressMetricKey, Map<string, number>>(
      metricKeys.map((key) => [key, new Map<string, number>()])
    );
    for (const item of [...weights].sort((a, b) =>
      a.localDate.localeCompare(b.localDate) ||
      (a.measuredAt ?? "").localeCompare(b.measuredAt ?? "") ||
      a.id.localeCompare(b.id)
    )) {
      points.get("weight_kg")!.set(item.localDate, item.weightKg);
    }
    const incompleteNutritionDates = new Set<string>();
    for (const meal of meals) {
      if (meal.totals.caloriesKcal === null || meal.totals.proteinG === null) {
        incompleteNutritionDates.add(meal.localDate);
        continue;
      }
      points.get("calories_kcal")!.set(meal.localDate, (points.get("calories_kcal")!.get(meal.localDate) ?? 0) + meal.totals.caloriesKcal);
      points.get("protein_g")!.set(meal.localDate, (points.get("protein_g")!.get(meal.localDate) ?? 0) + meal.totals.proteinG);
    }
    for (const localDate of incompleteNutritionDates) {
      points.get("calories_kcal")!.delete(localDate);
      points.get("protein_g")!.delete(localDate);
    }
    for (const workout of workouts) {
      points.get("workout_session_count")!.set(workout.localDate, (points.get("workout_session_count")!.get(workout.localDate) ?? 0) + 1);
    }
    for (const item of [...assessments].sort((a, b) => a.asOf.localeCompare(b.asOf) || a.id.localeCompare(b.id))) {
      points.get("readiness_score")!.set(item.localDate, item.readinessScore);
    }

    return {
      from: query.from,
      to: query.to,
      timezone: query.timezone,
      metricSetVersion: "progress-metrics-v1",
      metrics: metricKeys.map((key) => ({
        key,
        ...metricMetadata[key],
        points: [...points.get(key)!.entries()]
          .sort(([left], [right]) => left.localeCompare(right))
          .map(([localDate, value]): ProgressMetricPoint => ({ localDate, value }))
      })),
      days: [...facts.entries()]
        .sort(([left], [right]) => right.localeCompare(left))
        .map(([localDate, dayFacts]) => ({ localDate, facts: dayFacts }))
    };
  }

  private validate(query: ProgressOverviewQuery): void {
    assertLocalDate(query.from);
    assertLocalDate(query.to);
    assertIanaTimezone(query.timezone);
    const span = dateOrdinal(query.to) - dateOrdinal(query.from) + 1;
    if (span < 1 || span > 366) {
      throw new DomainValidationError("progress overview range must contain between 1 and 366 inclusive days");
    }
  }
}
