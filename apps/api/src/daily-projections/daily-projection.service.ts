import { Inject, Injectable } from "@nestjs/common";
import type {
  DailyProjection,
  DailyProjectionQuery,
  DaySnapshot
} from "@shape-of-you/contracts";

import { BodyMeasurementSessionService } from "../body-measurement-sessions/body-measurement-session.service.js";
import { CoachingService } from "../coaching/coaching.service.js";
import { DailyContextNoteService } from "../daily-context-notes/daily-context-note.service.js";
import { assertIanaTimezone, assertLocalDate } from "../domain/date-context.js";
import { NutritionService } from "../nutrition/nutrition.service.js";
import { RecoveryService } from "../recovery/recovery.service.js";
import { TrainingService } from "../training/training.service.js";
import { WeightMeasurementService } from "../weight-measurements/weight-measurement.service.js";

/** Composes an always-live daily view without owning or freezing domain facts. */
@Injectable()
export class DailyProjectionService {
  public constructor(
    @Inject(WeightMeasurementService) private readonly weights: WeightMeasurementService,
    @Inject(BodyMeasurementSessionService)
    private readonly bodyMeasurements: BodyMeasurementSessionService,
    @Inject(NutritionService) private readonly nutrition: NutritionService,
    @Inject(TrainingService) private readonly training: TrainingService,
    @Inject(RecoveryService) private readonly recovery: RecoveryService,
    @Inject(DailyContextNoteService)
    private readonly dailyContextNotes: DailyContextNoteService,
    @Inject(CoachingService) private readonly coaching: CoachingService
  ) {}

  /** Returns current owning-domain facts for one exact Person-local date. */
  public async projection(query: DailyProjectionQuery): Promise<DailyProjection> {
    assertLocalDate(query.localDate);
    assertIanaTimezone(query.timezone);
    return {
      localDate: query.localDate,
      timezone: query.timezone,
      asOf: new Date().toISOString(),
      snapshot: await this.compose(query.localDate, query.timezone)
    };
  }

  private async compose(localDate: string, timezone: string): Promise<DaySnapshot> {
    const [
      weights,
      bodySessions,
      dailyTotals,
      meals,
      workoutSessions,
      contextNotes,
      observations,
      assessments,
      recommendations
    ] = await Promise.all([
      this.weights.listForLocalDate(localDate),
      this.bodyMeasurements.listForLocalDate(localDate),
      this.nutrition.dailyTotals(localDate),
      this.nutrition.listMealsForLocalDate(localDate),
      this.training.listWorkoutSessionsForLocalDate(localDate),
      this.dailyContextNotes.listForLocalDate(localDate),
      this.recovery.listObservationsForLocalDate(localDate),
      this.recovery.listAssessmentsForLocalDate(localDate),
      this.coaching.listForLocalDate(localDate, timezone)
    ]);
    return {
      physical: {
        weightMeasurements: weights.map((item) => ({
          id: item.id,
          measuredAt: item.measuredAt,
          temporalPrecision: item.temporalPrecision,
          weightKg: item.weightKg
        })),
        bodyMeasurementSessions: bodySessions.map((item) => ({
          id: item.id,
          measuredAt: item.measuredAt,
          temporalPrecision: item.temporalPrecision,
          values: item.values.map((value) => ({
            metric: value.metric,
            value: value.value,
            unit: value.unit
          }))
        }))
      },
      nutrition: {
        totals: {
          mealCount: dailyTotals.mealCount,
          caloriesKcal: dailyTotals.totals.caloriesKcal,
          proteinG: dailyTotals.totals.proteinG,
          fatG: dailyTotals.totals.fatG,
          carbsG: dailyTotals.totals.carbsG,
          nutritionCompleteness: dailyTotals.nutritionCompleteness,
          incompleteMealCount: dailyTotals.incompleteMealCount
        },
        meals: meals.map((item) => ({
          id: item.id,
          occurredAt: item.occurredAt,
          temporalPrecision: item.temporalPrecision,
          kind: item.kind
        }))
      },
      training: {
        workoutSessions: workoutSessions.map((item) => ({
          id: item.id,
          occurredAt: item.occurredAt,
          temporalPrecision: item.temporalPrecision,
          workoutName: item.workoutName
        }))
      },
      ...(contextNotes.items.length > 0
        ? { contextNotes: contextNotes.items.map((item) => ({ id: item.id, text: item.text })) }
        : {}),
      recovery: {
        observations: observations.map((item) => ({
          id: item.id,
          kind: item.kind,
          observedUntil: item.observedUntil,
          temporalPrecision: item.temporalPrecision
        })),
        assessments: assessments.map((item) => ({
          id: item.id,
          readinessScore: item.readinessScore,
          riskLevel: item.riskLevel
        }))
      },
      coaching: {
        recommendations: recommendations.map((item) => ({
          id: item.id,
          asOf: item.asOf,
          state: item.state
        }))
      }
    };
  }
}
