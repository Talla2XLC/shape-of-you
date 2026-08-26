import { Inject, Injectable } from "@nestjs/common";

import type {
  CloseDay,
  DailyProjection,
  DailyProjectionQuery,
  DayClosure,
  DayClosureHistory,
  DaySnapshot,
  ReopenDay
} from "@shape-of-you/contracts";

import { DAY_CLOSURE_STORE, PERSON_CONTEXT } from "../application/tokens.js";
import type { PersonContext } from "../application/person-context.js";
import {
  assertIanaTimezone,
  assertLocalDate,
  DAY_CLOSURE_POLICY_VERSION,
  fingerprint,
  snapshotReferences
} from "../domain/day-closure.js";
import { ConflictError } from "../domain/errors.js";
import type { DayClosureStore } from "../storage/day-closure-repository.js";
import { BodyMeasurementSessionService } from "../body-measurement-sessions/body-measurement-session.service.js";
import { CoachingService } from "../coaching/coaching.service.js";
import { NutritionService } from "../nutrition/nutrition.service.js";
import { RecoveryService } from "../recovery/recovery.service.js";
import { TrainingService } from "../training/training.service.js";
import { WeightMeasurementService } from "../weight-measurements/weight-measurement.service.js";

/** Coordinates daily views while domain modules remain owners of their facts. */
@Injectable()
export class DayClosureService {
  public constructor(
    @Inject(DAY_CLOSURE_STORE) private readonly store: DayClosureStore,
    @Inject(PERSON_CONTEXT) private readonly personContext: PersonContext,
    @Inject(WeightMeasurementService)
    private readonly weights: WeightMeasurementService,
    @Inject(BodyMeasurementSessionService)
    private readonly bodyMeasurements: BodyMeasurementSessionService,
    @Inject(NutritionService)
    private readonly nutrition: NutritionService,
    @Inject(TrainingService)
    private readonly training: TrainingService,
    @Inject(RecoveryService)
    private readonly recovery: RecoveryService,
    @Inject(CoachingService)
    private readonly coaching: CoachingService
  ) {}

  /** Returns the live projection for an open day or its immutable closure snapshot. */
  public async projection(query: DailyProjectionQuery): Promise<DailyProjection> {
    this.validateDateContext(query.localDate, query.timezone);
    const personId = this.personContext.getPersonId();
    const active = await this.store.findActive(personId, query.localDate);
    if (!active) {
      return {
        localDate: query.localDate,
        timezone: query.timezone,
        state: "open",
        closure: null,
        snapshot: await this.compose(query.localDate, query.timezone),
        isStale: false
      };
    }
    if (active.closure.timezone !== query.timezone) {
      throw new ConflictError("The selected day was closed in a different timezone");
    }
    const current = await this.compose(query.localDate, query.timezone);
    const isStale =
      fingerprint({
        snapshot: current,
        references: snapshotReferences(current)
      }) !== active.stateFingerprint;
    return {
      localDate: query.localDate,
      timezone: query.timezone,
      state: isStale ? "stale" : "closed",
      closure: active.closure,
      snapshot: active.closure.snapshot,
      isStale
    };
  }

  /** Closes an open date with a reproducible snapshot and idempotency protection. */
  public async close(
    input: CloseDay
  ): Promise<{ readonly created: boolean; readonly closure: DayClosure }> {
    this.validateDateContext(input.localDate, input.timezone);
    const first = await this.compose(input.localDate, input.timezone);
    const second = await this.compose(input.localDate, input.timezone);
    const firstFingerprint = this.stateFingerprint(first);
    if (firstFingerprint !== this.stateFingerprint(second)) {
      throw new ConflictError("Daily facts changed while the closure was being composed");
    }
    const personId = this.personContext.getPersonId();
    return this.store.close(
      personId,
      {
        localDate: input.localDate,
        timezone: input.timezone,
        policyVersion: DAY_CLOSURE_POLICY_VERSION,
        snapshot: second,
        references: snapshotReferences(second),
        stateFingerprint: firstFingerprint,
        actorPersonId: personId,
        source: "manual"
      },
      input.idempotencyKey,
      fingerprint({
        operation: "close",
        localDate: input.localDate,
        timezone: input.timezone
      })
    );
  }

  /** Reopens an active closure without editing or deleting its snapshot. */
  public reopen(
    localDate: string,
    input: ReopenDay
  ): Promise<{ readonly created: boolean; readonly closure: DayClosure }> {
    assertLocalDate(localDate);
    return this.store.reopen(
      this.personContext.getPersonId(),
      localDate,
      input.reason,
      input.idempotencyKey,
      fingerprint({ operation: "reopen", localDate, reason: input.reason })
    );
  }

  /** Returns all versions for a Person-local date in newest-first order. */
  public async history(query: DailyProjectionQuery): Promise<DayClosureHistory> {
    this.validateDateContext(query.localDate, query.timezone);
    const history = await this.store.history(this.personContext.getPersonId(), query.localDate);
    if (history.items.some((item) => item.timezone !== query.timezone)) {
      throw new ConflictError("The selected day was closed in a different timezone");
    }
    return history;
  }

  private validateDateContext(localDate: string, timezone: string): void {
    assertLocalDate(localDate);
    assertIanaTimezone(timezone);
  }

  private stateFingerprint(snapshot: DaySnapshot): string {
    return fingerprint({ snapshot, references: snapshotReferences(snapshot) });
  }

  private async compose(localDate: string, timezone: string): Promise<DaySnapshot> {
    const [
      weights,
      bodySessions,
      dailyTotals,
      meals,
      workoutSessions,
      observations,
      assessments,
      recommendations
    ] = await Promise.all([
      this.weights.listForLocalDate(localDate),
      this.bodyMeasurements.listForLocalDate(localDate),
      this.nutrition.dailyTotals(localDate),
      this.nutrition.listMealsForLocalDate(localDate),
      this.training.listWorkoutSessionsForLocalDate(localDate),
      this.recovery.listObservationsForLocalDate(localDate),
      this.recovery.listAssessmentsForLocalDate(localDate),
      this.coaching.listForLocalDate(localDate, timezone)
    ]);
    return {
      physical: {
        weightMeasurements: weights
          .map((item) => ({
            id: item.id,
            measuredAt: item.measuredAt,
            temporalPrecision: item.temporalPrecision,
            weightKg: item.weightKg
          })),
        bodyMeasurementSessions: bodySessions
          .map((item) => ({
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
        recommendations: recommendations.map((item) => ({ id: item.id, asOf: item.asOf, state: item.state }))
      }
    };
  }
}
