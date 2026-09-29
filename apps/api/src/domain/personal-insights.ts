import type { PersonalInsight, PersonalInsightKind, PersonalInsightSuppression, PersonalInsightsResult } from "@shape-of-you/contracts";

/** Current, owner-approved weight evidence; ordering resolves same-day measurements. */
export interface InsightWeightSample {
  readonly id: string;
  readonly localDate: string;
  readonly measuredAt: string | null;
  readonly weightKg: number;
}

/** One verified training date after exact session/activity linkage is resolved. */
export interface InsightTrainingDay {
  readonly localDate: string;
  readonly workoutSessionIds: readonly string[];
  readonly externalActivityIds: readonly string[];
}

/** Current sleep-duration evidence with owner quality semantics. */
export interface InsightSleepSample {
  readonly id: string;
  readonly localDate: string;
  readonly totalSleepMinutes: number;
  readonly quality: "reliable" | "estimated" | "poor";
}

/** Bounded, current Person evidence used by the immutable v1 policy. */
export interface PersonalInsightInputs {
  readonly localDate: string;
  readonly timezone: string;
  readonly weights: readonly InsightWeightSample[];
  readonly trainingDays: readonly InsightTrainingDay[];
  readonly sleeps: readonly InsightSleepSample[];
  readonly excludedDates: ReadonlySet<string>;
  readonly trainingHistoryComplete: boolean;
}

function shift(value: string, days: number): string {
  const date = new Date(`${value}T00:00:00.000Z`);
  date.setUTCDate(date.getUTCDate() + days);
  return date.toISOString().slice(0, 10);
}

function median(values: readonly number[]): number {
  const sorted = [...values].sort((a, b) => a - b);
  const middle = Math.floor(sorted.length / 2);
  return sorted.length % 2 === 0 ? (sorted[middle - 1]! + sorted[middle]!) / 2 : sorted[middle]!;
}

function interquartileRange(values: readonly number[]): number {
  const sorted = [...values].sort((a, b) => a - b);
  const midpoint = Math.floor(sorted.length / 2);
  return median(sorted.slice(sorted.length % 2 === 0 ? midpoint : midpoint + 1)) - median(sorted.slice(0, midpoint));
}

function emptyEvidence(): PersonalInsight["evidence"] {
  return { weightMeasurementIds: [], workoutSessionIds: [], externalActivityIds: [], recoveryObservationIds: [] };
}

function suppressed(kind: PersonalInsightKind, reason: PersonalInsightSuppression["reason"]): PersonalInsightSuppression {
  return { kind, reason };
}

function weightDirection(input: PersonalInsightInputs): PersonalInsight | PersonalInsightSuppression {
  const from = shift(input.localDate, -28);
  const to = shift(input.localDate, -1);
  const split = shift(input.localDate, -14);
  const daily = new Map<string, InsightWeightSample>();
  for (const item of input.weights) {
    if (item.localDate < from || item.localDate > to) continue;
    const current = daily.get(item.localDate);
    if (!current || (item.measuredAt ?? "").localeCompare(current.measuredAt ?? "") > 0 ||
      (item.measuredAt === current.measuredAt && item.id > current.id)) daily.set(item.localDate, item);
  }
  const values = [...daily.values()].sort((a, b) => a.localDate.localeCompare(b.localDate));
  const earlier = values.filter((item) => item.localDate < split);
  const later = values.filter((item) => item.localDate >= split);
  if (values.length < 8 || earlier.length < 3 || later.length < 3 ||
    Date.parse(`${values.at(-1)?.localDate}T00:00:00Z`) - Date.parse(`${values[0]?.localDate}T00:00:00Z`) < 20 * 86_400_000) {
    return suppressed("weight_direction", "insufficient_data");
  }
  for (let index = 1; index < values.length; index += 1) {
    if (Date.parse(`${values[index]!.localDate}T00:00:00Z`) - Date.parse(`${values[index - 1]!.localDate}T00:00:00Z`) > 10 * 86_400_000) {
      return suppressed("weight_direction", "ambiguous_evidence");
    }
  }
  const difference = median(later.map((item) => item.weightKg)) - median(earlier.map((item) => item.weightKg));
  const dispersion = median(values.map((item) => Math.abs(item.weightKg - median(values.map((value) => value.weightKg)))));
  if (interquartileRange(values.map((item) => item.weightKg)) > 3) {
    return suppressed("weight_direction", "ambiguous_evidence");
  }
  let statement: string;
  if (difference >= 0.5) statement = "Recorded weight has generally been higher in the recent half of this period.";
  else if (difference <= -0.5) statement = "Recorded weight has generally been lower in the recent half of this period.";
  else if (Math.abs(difference) <= 0.3 && dispersion <= 0.8) statement = "Recorded weight has been broadly stable across this period.";
  else return suppressed("weight_direction", "no_meaningful_difference");
  if (dispersion > 1.5) return suppressed("weight_direction", "ambiguous_evidence");
  return {
    kind: "weight_direction", from, to, statement, uncertainty: "moderate",
    sampleDays: later.length, comparisonDays: earlier.length,
    limitation: "This describes recorded measurements only; it does not assess health, goals, or what caused a change.",
    evidence: { ...emptyEvidence(), weightMeasurementIds: values.map((item) => item.id) }
  };
}

function trainingRhythm(input: PersonalInsightInputs): PersonalInsight | PersonalInsightSuppression {
  if (!input.trainingHistoryComplete) return suppressed("training_rhythm", "ambiguous_evidence");
  const from = shift(input.localDate, -56);
  const to = shift(input.localDate, -1);
  const split = shift(input.localDate, -28);
  const days = input.trainingDays.filter((item) => item.localDate >= from && item.localDate <= to &&
    item.workoutSessionIds.length + item.externalActivityIds.length > 0);
  const earlier = days.filter((item) => item.localDate < split);
  const later = days.filter((item) => item.localDate >= split);
  if (days.length < 4 || earlier.length < 2 || later.length < 2) return suppressed("training_rhythm", "insufficient_data");
  if (Math.abs(later.length - earlier.length) < 2) return suppressed("training_rhythm", "no_meaningful_difference");
  return {
    kind: "training_rhythm", from, to,
    statement: `The last 28 completed days contain ${later.length} days with recorded training, compared with ${earlier.length} in the preceding 28 days.`,
    uncertainty: "high", sampleDays: later.length, comparisonDays: earlier.length,
    limitation: "Only recorded training is counted. An unrecorded day is not a confirmed rest day or a missed workout.",
    evidence: {
      ...emptyEvidence(),
      workoutSessionIds: [...new Set(days.flatMap((day) => day.workoutSessionIds))],
      externalActivityIds: [...new Set(days.flatMap((day) => day.externalActivityIds))]
    }
  };
}

function sleepAssociation(input: PersonalInsightInputs): PersonalInsight | PersonalInsightSuppression {
  if (!input.trainingHistoryComplete) return suppressed("post_training_sleep_association", "ambiguous_evidence");
  const from = shift(input.localDate, -56);
  const to = shift(input.localDate, -1);
  const training = new Map(input.trainingDays.map((day) => [day.localDate, day]));
  const daily = new Map<string, InsightSleepSample>();
  for (const sleep of input.sleeps) {
    if (sleep.localDate < from || sleep.localDate > to || sleep.quality === "poor" || sleep.totalSleepMinutes <= 0) continue;
    const current = daily.get(sleep.localDate);
    if (!current || (sleep.quality === "reliable" && current.quality !== "reliable")) daily.set(sleep.localDate, sleep);
    else if (sleep.quality === current.quality && sleep.totalSleepMinutes !== current.totalSleepMinutes) {
      return suppressed("post_training_sleep_association", "ambiguous_evidence");
    }
  }
  const relevant = [...daily.values()].filter((sleep) => {
    const prior = shift(sleep.localDate, -1);
    return prior >= from && !input.excludedDates.has(prior) && !input.excludedDates.has(sleep.localDate);
  });
  const afterTraining = relevant.filter((sleep) => training.has(shift(sleep.localDate, -1)));
  const withoutRecordedTraining = relevant.filter((sleep) => !training.has(shift(sleep.localDate, -1)));
  if (afterTraining.length < 8 || withoutRecordedTraining.length < 8) {
    return suppressed("post_training_sleep_association", "insufficient_data");
  }
  const candidateSleepDates: string[] = [];
  for (let day = shift(from, 1); day <= to; day = shift(day, 1)) {
    if (!input.excludedDates.has(day) && !input.excludedDates.has(shift(day, -1))) candidateSleepDates.push(day);
  }
  const eligibleTrainingDates = candidateSleepDates.filter((day) => training.has(shift(day, -1))).length;
  const eligibleNoTrainingDates = candidateSleepDates.length - eligibleTrainingDates;
  if (eligibleTrainingDates <= 0 || eligibleNoTrainingDates <= 0 ||
    afterTraining.length / eligibleTrainingDates < 0.4 || withoutRecordedTraining.length / eligibleNoTrainingDates < 0.4) {
    return suppressed("post_training_sleep_association", "ambiguous_evidence");
  }
  const difference = median(afterTraining.map((item) => item.totalSleepMinutes)) -
    median(withoutRecordedTraining.map((item) => item.totalSleepMinutes));
  if (Math.abs(difference) < 45) return suppressed("post_training_sleep_association", "no_meaningful_difference");
  const sourceDays = new Set(afterTraining.map((item) => shift(item.localDate, -1)));
  const sourceTraining = input.trainingDays.filter((day) => sourceDays.has(day.localDate));
  return {
    kind: "post_training_sleep_association", from, to,
    statement: difference < 0
      ? "In these records, next-day sleep was generally shorter after a recorded training day."
      : "In these records, next-day sleep was generally longer after a recorded training day.",
    uncertainty: "high", sampleDays: afterTraining.length, comparisonDays: withoutRecordedTraining.length,
    limitation: "This is an observational comparison, not an effect of training. Days without a recorded workout are not confirmed rest days.",
    evidence: {
      ...emptyEvidence(),
      workoutSessionIds: [...new Set(sourceTraining.flatMap((day) => day.workoutSessionIds))],
      externalActivityIds: [...new Set(sourceTraining.flatMap((day) => day.externalActivityIds))],
      recoveryObservationIds: relevant.map((item) => item.id)
    }
  };
}

/** Evaluates independent evidence gates without mutating owner facts or daily decisions. */
export function evaluatePersonalInsights(input: PersonalInsightInputs): PersonalInsightsResult {
  const candidates = [weightDirection(input), trainingRhythm(input), sleepAssociation(input)];
  const insights = candidates.filter((item): item is PersonalInsight => "statement" in item);
  const missing = candidates.filter((item): item is PersonalInsightSuppression => "reason" in item);
  return {
    localDate: input.localDate,
    completedThrough: shift(input.localDate, -1),
    timezone: input.timezone,
    policyVersion: "personal-insights-v1",
    insights,
    suppressed: missing
  };
}
