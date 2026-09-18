/** Metrics whose personal norm can inform a shadow daily assessment. */
export const personalBaselineV1Metrics = [
  "sleep_minutes",
  "hrv_rmssd",
  "resting_heart_rate",
  "body_battery",
  "body_battery_min",
  "body_battery_max",
  "training_load"
] as const;

/** Metrics supported by the V3 policy, including optional daily movement. */
export const personalBaselineMetrics = [...personalBaselineV1Metrics, "steps"] as const;

/** Provider-neutral metric supported by the personal-baseline policy. */
export type PersonalBaselineMetric = (typeof personalBaselineMetrics)[number];

/** One normalized Person-local day considered by a baseline candidate. */
export interface PersonalBaselineSample {
  readonly localDate: string;
  readonly value: number;
  readonly eligible: boolean;
}

/** Immutable parameters of one shadow baseline candidate. */
export interface PersonalBaselinePolicy {
  readonly key: "responsive" | "balanced" | "stable";
  readonly policyVersion: "personal-baseline-shadow-v1" | "personal-baseline-v1" | "personal-baseline-v2";
  readonly minimumEligibleDays: 14;
  readonly minimumTrainingCalendarSpanDays: 21;
  readonly targetEligibleDays: number;
  readonly maximumLookbackDays: number;
  readonly minimumRecentCoverage: number;
  readonly usualMadMultiplier: number;
  readonly severeMadMultiplier: number;
  readonly lowerPercentile: number;
  readonly upperPercentile: number;
  readonly trendSampleCount: number;
  readonly persistentDeviationCount: number;
  readonly recoveryBufferDays: number;
  readonly multiSignalFreezeThreshold: number;
}

/** Aggregate-safe comparison with a personal norm; it contains no raw value. */
export interface PersonalBaselineComparison {
  readonly availability: "available" | "insufficient_history";
  readonly position: "below_usual" | "within_usual" | "above_usual" | null;
  readonly severity: "usual" | "notable" | "marked" | null;
  readonly eligibleDayCount: number;
  readonly method: "median_mad" | "median_percentiles" | null;
}

/** Candidate bundles evaluated by the retrospective dry-run before activation. */
export const personalBaselineCandidates: readonly PersonalBaselinePolicy[] = [
  {
    key: "responsive",
    policyVersion: "personal-baseline-shadow-v1",
    minimumEligibleDays: 14,
    minimumTrainingCalendarSpanDays: 21,
    targetEligibleDays: 21,
    maximumLookbackDays: 60,
    minimumRecentCoverage: 0.5,
    usualMadMultiplier: 1.5,
    severeMadMultiplier: 3,
    lowerPercentile: 0.2,
    upperPercentile: 0.8,
    trendSampleCount: 3,
    persistentDeviationCount: 2,
    recoveryBufferDays: 1,
    multiSignalFreezeThreshold: 3
  },
  {
    key: "balanced",
    policyVersion: "personal-baseline-shadow-v1",
    minimumEligibleDays: 14,
    minimumTrainingCalendarSpanDays: 21,
    targetEligibleDays: 28,
    maximumLookbackDays: 84,
    minimumRecentCoverage: 0.45,
    usualMadMultiplier: 1.5,
    severeMadMultiplier: 3,
    lowerPercentile: 0.2,
    upperPercentile: 0.8,
    trendSampleCount: 4,
    persistentDeviationCount: 3,
    recoveryBufferDays: 2,
    multiSignalFreezeThreshold: 3
  },
  {
    key: "stable",
    policyVersion: "personal-baseline-shadow-v1",
    minimumEligibleDays: 14,
    minimumTrainingCalendarSpanDays: 21,
    targetEligibleDays: 42,
    maximumLookbackDays: 120,
    minimumRecentCoverage: 0.35,
    usualMadMultiplier: 1.5,
    severeMadMultiplier: 3,
    lowerPercentile: 0.2,
    upperPercentile: 0.8,
    trendSampleCount: 5,
    persistentDeviationCount: 3,
    recoveryBufferDays: 3,
    multiSignalFreezeThreshold: 3
  }
] as const;

/** Immutable balanced policy selected for the authoritative v2 assessment. */
export const activePersonalBaselinePolicy: PersonalBaselinePolicy = {
  ...personalBaselineCandidates[1]!,
  policyVersion: "personal-baseline-v1"
};

/** Immutable balanced policy used by authoritative daily-assessment-v3. */
export const activePersonalBaselineV2Policy: PersonalBaselinePolicy = {
  ...personalBaselineCandidates[1]!,
  policyVersion: "personal-baseline-v2"
};

/** Returns the exact metric set pinned by one baseline policy version. */
export function personalBaselineMetricsForPolicy(
  policy: PersonalBaselinePolicy
): readonly PersonalBaselineMetric[] {
  return policy.policyVersion === "personal-baseline-v2"
    ? personalBaselineMetrics
    : personalBaselineV1Metrics;
}

function median(values: readonly number[]): number {
  const sorted = [...values].sort((left, right) => left - right);
  const middle = Math.floor(sorted.length / 2);
  if (sorted.length % 2 === 1) {
    return sorted[middle]!;
  }
  return (sorted[middle - 1]! + sorted[middle]!) / 2;
}

function percentile(values: readonly number[], fraction: number): number {
  const sorted = [...values].sort((left, right) => left - right);
  const index = (sorted.length - 1) * fraction;
  const lower = Math.floor(index);
  const upper = Math.ceil(index);
  if (lower === upper) {
    return sorted[lower]!;
  }
  return sorted[lower]! + (sorted[upper]! - sorted[lower]!) * (index - lower);
}

function subtractDays(localDate: string, days: number): string {
  const date = new Date(`${localDate}T00:00:00.000Z`);
  date.setUTCDate(date.getUTCDate() - days);
  return date.toISOString().slice(0, 10);
}

function selectPersonalBaselineValues(
  currentLocalDate: string,
  samples: readonly PersonalBaselineSample[],
  policy: PersonalBaselinePolicy,
  minimumCalendarSpanDays: number
): { readonly selected: readonly number[]; readonly available: boolean } {
  const earliestDate = subtractDays(currentLocalDate, policy.maximumLookbackDays);
  const valuesByDate = new Map<string, number[]>();
  for (const sample of samples) {
    if (
      sample.eligible && sample.localDate < currentLocalDate &&
      sample.localDate >= earliestDate && Number.isFinite(sample.value)
    ) {
      const values = valuesByDate.get(sample.localDate) ?? [];
      values.push(sample.value);
      valuesByDate.set(sample.localDate, values);
    }
  }
  const selectedEntries = [...valuesByDate.entries()]
    .sort(([left], [right]) => right.localeCompare(left))
    .slice(0, policy.targetEligibleDays);
  const recentBoundary = subtractDays(currentLocalDate, policy.targetEligibleDays);
  const recentEligibleCount = selectedEntries.filter(
    ([localDate]) => localDate >= recentBoundary
  ).length;
  const coverage = recentEligibleCount / policy.minimumEligibleDays;
  const oldestSelectedDate = selectedEntries.at(-1)?.[0];
  const newestSelectedDate = selectedEntries[0]?.[0];
  const calendarSpan = oldestSelectedDate === undefined || newestSelectedDate === undefined
    ? 0
    : rangeDays(oldestSelectedDate, newestSelectedDate) + 1;
  const available = !(
    selectedEntries.length < policy.minimumEligibleDays ||
    coverage < policy.minimumRecentCoverage ||
    calendarSpan < minimumCalendarSpanDays
  );
  return {
    selected: selectedEntries.map(([, values]) => median(values)),
    available
  };
}

/** Returns the exact canonical center used by an available baseline. */
export function personalBaselineCenter(
  currentLocalDate: string,
  samples: readonly PersonalBaselineSample[],
  policy: PersonalBaselinePolicy,
  options: { readonly minimumCalendarSpanDays?: number } = {}
): number | null {
  const selection = selectPersonalBaselineValues(
    currentLocalDate,
    samples,
    policy,
    options.minimumCalendarSpanDays ?? 0
  );
  return selection.available ? median(selection.selected) : null;
}

/**
 * Compares a current value with earlier eligible days under one immutable
 * candidate. The current day is excluded by date, so late corrections produce
 * the same result as an equivalent originally imported history.
 */
export function compareWithPersonalBaseline(
  currentLocalDate: string,
  currentValue: number,
  samples: readonly PersonalBaselineSample[],
  policy: PersonalBaselinePolicy,
  options: { readonly minimumCalendarSpanDays?: number } = {}
): PersonalBaselineComparison {
  const selection = selectPersonalBaselineValues(
    currentLocalDate,
    samples,
    policy,
    options.minimumCalendarSpanDays ?? 0
  );
  if (!selection.available) {
    return {
      availability: "insufficient_history",
      position: null,
      severity: null,
      eligibleDayCount: selection.selected.length,
      method: null
    };
  }
  const selected = selection.selected;

  const center = median(selected);
  const mad = median(selected.map((value) => Math.abs(value - center)));
  const method = mad > 0 ? "median_mad" : "median_percentiles";
  const lower =
    mad > 0
      ? center - policy.usualMadMultiplier * mad
      : percentile(selected, policy.lowerPercentile);
  const upper =
    mad > 0
      ? center + policy.usualMadMultiplier * mad
      : percentile(selected, policy.upperPercentile);
  const position =
    currentValue < lower
      ? "below_usual"
      : currentValue > upper
        ? "above_usual"
        : "within_usual";
  const severeDistance = policy.severeMadMultiplier * mad;
  const marked = mad > 0 && Math.abs(currentValue - center) >= severeDistance;

  return {
    availability: "available",
    position,
    severity: position === "within_usual" ? "usual" : marked ? "marked" : "notable",
    eligibleDayCount: selected.length,
    method
  };
}

function rangeDays(from: string, to: string): number {
  return Math.round(
    (Date.parse(`${to}T00:00:00.000Z`) - Date.parse(`${from}T00:00:00.000Z`)) /
      86_400_000
  );
}

/** Returns whether the adverse signal persisted often enough for this policy. */
export function isPersistentDeviation(
  recentAdverseSignals: readonly boolean[],
  policy: PersonalBaselinePolicy
): boolean {
  return (
    recentAdverseSignals.slice(-policy.trendSampleCount).filter(Boolean).length >=
    policy.persistentDeviationCount
  );
}
