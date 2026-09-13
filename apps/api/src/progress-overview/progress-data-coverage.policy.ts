import type {
  ProgressDataCoverageWindow,
  ProgressDataDirection,
  ProgressDataDirectionKey,
  ProgressDataReadinessReason,
  ProgressDataReadinessStatus
} from "@shape-of-you/contracts";

import type { DataCoverageEvidence } from "../domain/data-coverage.js";

const dayMilliseconds = 86_400_000;
const dailyDirections = new Set<ProgressDataDirectionKey>([
  "sleep",
  "hrv",
  "resting_heart_rate",
  "body_battery",
  "nutrition"
]);

function ordinal(value: string): number {
  return Date.parse(`${value}T00:00:00.000Z`) / dayMilliseconds;
}

/** Shifts an ISO local date with timezone-independent calendar arithmetic. */
export function shiftLocalDate(value: string, days: number): string {
  return new Date((ordinal(value) + days) * dayMilliseconds).toISOString().slice(0, 10);
}

function windowFor(
  windowDays: 28 | 90,
  localDate: string,
  days: readonly { readonly localDate: string; readonly usable: boolean }[]
): ProgressDataCoverageWindow {
  const from = shiftLocalDate(localDate, -windowDays);
  const to = shiftLocalDate(localDate, -1);
  const included = days.filter((day) => day.localDate >= from && day.localDate <= to);
  return {
    windowDays,
    from,
    to,
    recordedDays: new Set(included.map((day) => day.localDate)).size,
    usableDays: new Set(included.filter((day) => day.usable).map((day) => day.localDate)).size
  };
}

function coveredWeeks(window: ProgressDataCoverageWindow, usableDates: ReadonlySet<string>): number {
  const start = ordinal(window.from);
  return new Set(
    [...usableDates]
      .filter((value) => value >= window.from && value <= window.to)
      .map((value) => Math.floor((ordinal(value) - start) / 7))
  ).size;
}

function gapSummary(
  localDate: string,
  usableDates: ReadonlySet<string>,
  firstDataDate: string | null,
  threshold: number
): { significantGapCount: number; longestGapDays: number } {
  if (firstDataDate === null) return { significantGapCount: 0, longestGapDays: 0 };
  const from = [shiftLocalDate(localDate, -90), firstDataDate].sort().at(-1)!;
  const to = shiftLocalDate(localDate, -1);
  let current = 0;
  let longest = 0;
  let significantGapCount = 0;
  for (let day = ordinal(from); day <= ordinal(to); day += 1) {
    const value = new Date(day * dayMilliseconds).toISOString().slice(0, 10);
    if (usableDates.has(value)) {
      if (current >= threshold) significantGapCount += 1;
      longest = Math.max(longest, current);
      current = 0;
    } else {
      current += 1;
    }
  }
  if (current >= threshold) significantGapCount += 1;
  return { significantGapCount, longestGapDays: Math.max(longest, current) };
}

function readiness(
  key: ProgressDataDirectionKey,
  coverage28: ProgressDataCoverageWindow,
  coverage90: ProgressDataCoverageWindow,
  usableDates: ReadonlySet<string>,
  localDate: string
): ProgressDataReadinessStatus {
  const latestUsable = [...usableDates].sort().at(-1);
  const freshness = latestUsable ? ordinal(localDate) - ordinal(latestUsable) : Number.POSITIVE_INFINITY;
  if (dailyDirections.has(key)) {
    if (coverage28.usableDays >= 21 && freshness <= 2) return "good";
    if (coverage28.usableDays >= 7 && freshness <= 7) return "partial";
    return "sparse";
  }
  const weeks = coveredWeeks(coverage28, usableDates);
  if (weeks >= 3 && freshness <= 10) return "good";
  if ((coverage28.usableDays >= (key === "weight" ? 2 : 1) || coverage90.usableDays >= (key === "weight" ? 4 : 3)) && freshness <= 21) {
    return "partial";
  }
  return "sparse";
}

/** Builds one explainable direction without inspecting provenance or provider identity. */
export function buildCoverageDirection(
  key: ProgressDataDirectionKey,
  localDate: string,
  evidence: DataCoverageEvidence
): ProgressDataDirection {
  const coverage28 = windowFor(28, localDate, evidence.days);
  const coverage90 = windowFor(90, localDate, evidence.days);
  const usableDates = new Set(evidence.days.filter((day) => day.usable).map((day) => day.localDate));
  const freshnessDays = evidence.lastDataDate === null ? null : Math.max(0, ordinal(localDate) - ordinal(evidence.lastDataDate));
  const gaps = gapSummary(localDate, usableDates, evidence.firstDataDate, dailyDirections.has(key) ? 3 : 15);
  const status = readiness(key, coverage28, coverage90, usableDates, localDate);
  const reasons: ProgressDataReadinessReason[] = [];
  if (evidence.firstDataDate === null) reasons.push("no_data");
  else {
    const latestUsable = [...usableDates].sort().at(-1);
    const usableFreshness = latestUsable ? ordinal(localDate) - ordinal(latestUsable) : Number.POSITIVE_INFINITY;
    if (usableFreshness > (dailyDirections.has(key) ? 7 : 21)) reasons.push("stale");
    if (status !== "good") reasons.push("not_enough_recent_data");
    if (gaps.significantGapCount > 0) reasons.push("significant_gaps");
    if (coverage90.recordedDays > coverage90.usableDays) reasons.push("partial_records");
    if (evidence.firstDataDate > coverage28.from) reasons.push("limited_history");
  }
  return {
    key,
    firstDataDate: evidence.firstDataDate,
    lastDataDate: evidence.lastDataDate,
    freshnessDays,
    coverage28,
    coverage90,
    gaps,
    status,
    reasons
  };
}
