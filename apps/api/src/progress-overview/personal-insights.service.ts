import { Inject, Injectable } from "@nestjs/common";

import type { PersonalInsightsQuery, PersonalInsightsResult } from "@shape-of-you/contracts";

import { DailyContextNoteService } from "../daily-context-notes/daily-context-note.service.js";
import { assertIanaTimezone, assertLocalDate } from "../domain/date-context.js";
import { DomainValidationError } from "../domain/errors.js";
import { evaluatePersonalInsights, type InsightTrainingDay } from "../domain/personal-insights.js";
import { RecoveryService } from "../recovery/recovery.service.js";
import { TrainingService } from "../training/training.service.js";
import { WeightMeasurementService } from "../weight-measurements/weight-measurement.service.js";

function shift(value: string, days: number): string {
  const date = new Date(`${value}T00:00:00.000Z`);
  date.setUTCDate(date.getUTCDate() + days);
  return date.toISOString().slice(0, 10);
}

/** Composes current owner evidence for one bounded, non-prescriptive insight policy. */
@Injectable()
export class PersonalInsightsService {
  public constructor(
    @Inject(WeightMeasurementService) private readonly weights: WeightMeasurementService,
    @Inject(TrainingService) private readonly training: TrainingService,
    @Inject(RecoveryService) private readonly recovery: RecoveryService,
    @Inject(DailyContextNoteService) private readonly notes: DailyContextNoteService
  ) {}

  /** Reads only current Person facts and evaluates the three independent v1 gates. */
  public async read(query: PersonalInsightsQuery): Promise<PersonalInsightsResult> {
    assertLocalDate(query.localDate);
    assertIanaTimezone(query.timezone);
    const todayParts = new Intl.DateTimeFormat("en-US", {
      timeZone: query.timezone, year: "numeric", month: "2-digit", day: "2-digit"
    }).formatToParts(new Date());
    const today = Object.fromEntries(todayParts.map((part) => [part.type, part.value]));
    if (query.localDate > `${today.year}-${today.month}-${today.day}`) {
      throw new DomainValidationError("localDate must not be in the future");
    }
    const from56 = shift(query.localDate, -56);
    const split = shift(query.localDate, -28);
    const to = shift(query.localDate, -1);
    const [weights, earlierTraining, laterTraining, observations, notes, trainingHistoryComplete] = await Promise.all([
      this.weights.listForLocalDateRange(split, to),
      this.training.listTrainingFactsForLocalDateRange(from56, shift(split, -1)),
      this.training.listTrainingFactsForLocalDateRange(split, to),
      this.recovery.listObservationsForLocalDateRange(from56, to),
      this.notes.listForLocalDateRange(from56, to),
      this.training.hasCompleteConnectedActivityHistory(query.localDate, query.timezone)
    ]);

    const training = [earlierTraining, laterTraining];
    const completedSessions = training.flatMap((slice) => slice.sessions).filter((item) =>
      item.exercises.some((exercise) => exercise.sets.length > 0));
    const linked = new Set(completedSessions.flatMap((session) => session.externalActivityId ? [session.externalActivityId] : []));
    const days = new Map<string, { workoutSessionIds: Set<string>; externalActivityIds: Set<string> }>();
    for (const session of completedSessions) {
      const day = days.get(session.localDate) ?? { workoutSessionIds: new Set<string>(), externalActivityIds: new Set<string>() };
      day.workoutSessionIds.add(session.id);
      days.set(session.localDate, day);
    }
    for (const slice of training) {
      for (const activity of slice.externalActivities) {
        if (activity.sessionCovered || linked.has(activity.id) || activity.durationSeconds < 20 * 60 ||
          activity.trainingLoad === null || activity.trainingLoad <= 0) continue;
        const day = days.get(activity.localDate) ?? { workoutSessionIds: new Set<string>(), externalActivityIds: new Set<string>() };
        day.externalActivityIds.add(activity.id);
        days.set(activity.localDate, day);
      }
    }
    const trainingDays: InsightTrainingDay[] = [...days.entries()].map(([localDate, ids]) => ({
      localDate,
      workoutSessionIds: [...ids.workoutSessionIds],
      externalActivityIds: [...ids.externalActivityIds]
    }));
    const excludedDates = new Set(notes.items.filter((note) => note.contextKind === "travel").map((note) => note.localDate));
    for (const observation of observations) {
      if (observation.kind !== "subjective" || observation.detail.type !== "subjective") continue;
      const detail = observation.detail;
      if (("signal" in detail && (detail.signal === "acute_illness" || detail.signal === "injury_concern")) ||
        ("acuteIllness" in detail && (detail.acuteIllness || detail.injuryConcern))) {
        excludedDates.add(observation.localDate);
      }
    }
    return evaluatePersonalInsights({
      localDate: query.localDate,
      timezone: query.timezone,
      weights: weights.map((item) => ({ id: item.id, localDate: item.localDate, measuredAt: item.measuredAt, weightKg: item.weightKg })),
      trainingDays,
      sleeps: observations.filter((item) => item.kind === "sleep" && item.detail.type === "sleep").map((item) => ({
        id: item.id, localDate: item.localDate, totalSleepMinutes: item.detail.type === "sleep" ? item.detail.totalSleepMinutes : 0,
        quality: item.quality
      })),
      excludedDates,
      trainingHistoryComplete
    });
  }
}
