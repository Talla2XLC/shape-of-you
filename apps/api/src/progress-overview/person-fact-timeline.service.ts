import { Inject, Injectable } from "@nestjs/common";

import type { PersonFactTimeline, PersonFactTimelineEntry, PersonFactTimelineQuery } from "@shape-of-you/contracts";

import { BodyMeasurementSessionService } from "../body-measurement-sessions/body-measurement-session.service.js";
import { assertIanaTimezone, assertLocalDate } from "../domain/date-context.js";
import { DomainValidationError } from "../domain/errors.js";
import { NutritionService } from "../nutrition/nutrition.service.js";
import { RecoveryService } from "../recovery/recovery.service.js";
import { TrainingService } from "../training/training.service.js";
import { WeightMeasurementService } from "../weight-measurements/weight-measurement.service.js";

function eventInstant(value: string | null, precision: "instant" | "local_date"): string | null {
  return precision === "instant" ? value : null;
}

function historyPath(path: string, supersedesId: string | null): string | null {
  return supersedesId ? `${path}/history` : null;
}

/** Composes current Person facts through owner services without retaining another copy. */
@Injectable()
export class PersonFactTimelineService {
  public constructor(
    @Inject(WeightMeasurementService) private readonly weights: WeightMeasurementService,
    @Inject(BodyMeasurementSessionService) private readonly body: BodyMeasurementSessionService,
    @Inject(NutritionService) private readonly nutrition: NutritionService,
    @Inject(TrainingService) private readonly training: TrainingService,
    @Inject(RecoveryService) private readonly recovery: RecoveryService
  ) {}

  /** Reads an inclusive range of at most 32 Person-local days; no writes occur. */
  public async read(query: PersonFactTimelineQuery): Promise<PersonFactTimeline> {
    assertLocalDate(query.from);
    assertLocalDate(query.to);
    assertIanaTimezone(query.timezone);
    const span = (Date.parse(`${query.to}T00:00:00Z`) - Date.parse(`${query.from}T00:00:00Z`)) / 86_400_000 + 1;
    if (span < 1 || span > 32) {
      throw new DomainValidationError("person fact timeline range must contain between 1 and 32 inclusive days");
    }

    const [weights, body, meals, training, observations] = await Promise.all([
      this.weights.listForLocalDateRange(query.from, query.to),
      this.body.listForLocalDateRange(query.from, query.to),
      this.nutrition.listMealsForLocalDateRange(query.from, query.to),
      this.training.listTrainingFactsForLocalDateRange(query.from, query.to),
      this.recovery.listObservationsForLocalDateRange(query.from, query.to)
    ]);
    const linkedActivities = new Set(training.sessions.flatMap((session) => session.externalActivityId ? [session.externalActivityId] : []));
    const items: PersonFactTimelineEntry[] = [
      ...weights.map((item): PersonFactTimelineEntry => {
        const path = `/v1/weight-measurements/${item.id}`;
        return {
          kind: "weight", id: item.id, localDate: item.localDate,
          occurredAt: eventInstant(item.measuredAt, item.temporalPrecision), temporalPrecision: item.temporalPrecision,
          title: "Weight", numericValue: item.weightKg, unit: "kg", supersedesId: item.supersedesId,
          linkedExternalActivityId: null, detailPath: path, historyPath: historyPath(path, item.supersedesId)
        };
      }),
      ...body.map((item): PersonFactTimelineEntry => {
        const path = `/v1/body-measurement-sessions/${item.id}`;
        return {
          kind: "body_measurements", id: item.id, localDate: item.localDate,
          occurredAt: eventInstant(item.measuredAt, item.temporalPrecision), temporalPrecision: item.temporalPrecision,
          title: `Body measurements (${item.values.length})`, numericValue: null, unit: null,
          supersedesId: item.supersedesId, linkedExternalActivityId: null,
          detailPath: path, historyPath: historyPath(path, item.supersedesId)
        };
      }),
      ...meals.map((item): PersonFactTimelineEntry => {
        const path = `/v1/nutrition/meals/${item.id}`;
        return {
          kind: "meal", id: item.id, localDate: item.localDate,
          occurredAt: eventInstant(item.occurredAt, item.temporalPrecision), temporalPrecision: item.temporalPrecision,
          title: `Meal: ${item.kind}`, numericValue: item.totals.caloriesKcal, unit: item.totals.caloriesKcal === null ? null : "kcal",
          supersedesId: item.supersedesId, linkedExternalActivityId: null,
          detailPath: path, historyPath: historyPath(path, item.supersedesId)
        };
      }),
      ...training.sessions.map((item): PersonFactTimelineEntry => {
        const path = `/v1/training/sessions/${item.id}`;
        return {
          kind: "workout_session", id: item.id, localDate: item.localDate,
          occurredAt: eventInstant(item.occurredAt, item.temporalPrecision), temporalPrecision: item.temporalPrecision,
          title: item.workoutName, numericValue: null, unit: null,
          supersedesId: item.supersedesId, linkedExternalActivityId: item.externalActivityId,
          detailPath: path, historyPath: historyPath(path, item.supersedesId)
        };
      }),
      ...training.externalActivities.filter((item) => !item.sessionCovered && !linkedActivities.has(item.id)).map((item): PersonFactTimelineEntry => ({
        kind: "external_activity", id: item.id, localDate: item.localDate,
        occurredAt: item.occurredAt, temporalPrecision: "instant", title: item.name,
        numericValue: item.durationSeconds, unit: "second", supersedesId: item.supersedesId,
        linkedExternalActivityId: null, detailPath: null, historyPath: null
      })),
      ...observations.map((item): PersonFactTimelineEntry => {
        const path = `/v1/recovery/observations/${item.id}`;
        const detail = item.detail;
        return {
          kind: "recovery_observation", id: item.id, localDate: item.localDate,
          occurredAt: eventInstant(item.observedUntil ?? item.observedFrom, item.temporalPrecision),
          temporalPrecision: item.temporalPrecision,
          title: detail.type === "metric" ? `Recovery: ${detail.metric}` : `Recovery: ${item.kind}`,
          numericValue: detail.type === "metric" ? detail.value : detail.type === "sleep" ? detail.totalSleepMinutes : null,
          unit: detail.type === "metric" ? detail.unit : detail.type === "sleep" ? "minute" : null,
          supersedesId: item.supersedesId, linkedExternalActivityId: null,
          detailPath: path, historyPath: historyPath(path, item.supersedesId)
        };
      })
    ];

    items.sort((left, right) =>
      right.localDate.localeCompare(left.localDate) ||
      (right.occurredAt ?? "").localeCompare(left.occurredAt ?? "") ||
      left.kind.localeCompare(right.kind) || left.id.localeCompare(right.id)
    );
    return { from: query.from, to: query.to, timezone: query.timezone, scope: "current_recorded_facts_only", items };
  }
}
