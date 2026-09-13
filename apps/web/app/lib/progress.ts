/** Metric identifiers published by the initial progress read model. */
export type ProgressMetricKey = "weight_kg" | "calories_kcal" | "protein_g" | "workout_session_count" | "readiness_score";

/** Browser-facing shape of the bounded sparse progress response. */
export interface ProgressOverview {
  readonly from: string;
  readonly to: string;
  readonly timezone: string;
  readonly metrics: readonly { readonly key: ProgressMetricKey; readonly label: string; readonly unit: string; readonly points: readonly { readonly localDate: string; readonly value: number }[] }[];
  readonly days: readonly { readonly localDate: string; readonly facts: Readonly<Record<string, number>> }[];
}

export type ProgressDataDirectionKey = "sleep" | "hrv" | "resting_heart_rate" | "body_battery" | "training" | "weight" | "nutrition";
export type ProgressDataReadinessStatus = "sparse" | "partial" | "good";
export type ProgressDataReadinessReason = "no_data" | "stale" | "not_enough_recent_data" | "significant_gaps" | "partial_records" | "limited_history";

export interface ProgressDataDirection {
  readonly key: ProgressDataDirectionKey;
  readonly firstDataDate: string | null;
  readonly lastDataDate: string | null;
  readonly freshnessDays: number | null;
  readonly coverage28: { readonly windowDays: 28; readonly from: string; readonly to: string; readonly recordedDays: number; readonly usableDays: number };
  readonly coverage90: { readonly windowDays: 90; readonly from: string; readonly to: string; readonly recordedDays: number; readonly usableDays: number };
  readonly gaps: { readonly significantGapCount: number; readonly longestGapDays: number };
  readonly status: ProgressDataReadinessStatus;
  readonly reasons: readonly ProgressDataReadinessReason[];
}

/** Browser-facing provider-neutral profile coverage response. */
export interface ProgressDataCoverage {
  readonly localDate: string;
  readonly completedThrough: string;
  readonly timezone: string;
  readonly policyVersion: "profile-data-coverage-v1";
  readonly directions: readonly ProgressDataDirection[];
}

const directionLabels: Readonly<Record<ProgressDataDirectionKey, string>> = {
  sleep: "Sleep",
  hrv: "HRV",
  resting_heart_rate: "Resting heart rate",
  body_battery: "Body Battery",
  training: "Training",
  weight: "Weight",
  nutrition: "Nutrition"
};

/** Returns the user-facing label for one provider-neutral direction. */
export function coverageDirectionLabel(key: ProgressDataDirectionKey): string {
  return directionLabels[key];
}

/** Formats freshness without implying that missing evidence means missing behavior. */
export function formatCoverageFreshness(days: number | null): string {
  if (days === null) return "No recorded data";
  if (days === 0) return "Recorded today";
  if (days === 1) return "Last recorded yesterday";
  return `Last recorded ${days} days ago`;
}

/** Explains data sufficiency without making health or medical-quality claims. */
export function coverageExplanation(direction: ProgressDataDirection): string {
  if (direction.reasons.includes("no_data")) return "No recorded evidence yet. More data is needed before this can inform recommendations.";
  const partial = direction.reasons.includes("partial_records");
  if (direction.key === "nutrition") {
    if (direction.status === "good") return partial
      ? "Recorded meals provide useful pattern context, but some nutrient details are incomplete and full-day intake is not proven."
      : "More regular, complete meal records are needed. Recorded meals do not prove that the whole day was captured.";
    return "Recorded meals can provide limited context. More regular, complete meal records are needed, and full-day intake is not proven.";
  }
  if (direction.key === "body_battery" && partial) return "Some days contain only part of the Body Battery evidence. Record more complete and recent days for stronger context.";
  if (direction.status === "good") return "Recent regularity is sufficient to use this direction as recommendation context.";
  if (direction.status === "partial") return "This can provide limited context. More recent, regular data would make recommendations better grounded.";
  return direction.reasons.includes("stale")
    ? "Historical data exists, but recent evidence is too stale or sparse to ground current recommendations."
    : "More recent recorded evidence is needed before this can inform recommendations.";
}

/** Returns whether a value is a real ISO calendar date. */
export function isLocalDate(value: unknown): value is string {
  if (typeof value !== "string" || !/^\d{4}-\d{2}-\d{2}$/u.test(value)) return false;
  const candidate = new Date(`${value}T00:00:00.000Z`);
  return !Number.isNaN(candidate.valueOf()) && candidate.toISOString().startsWith(value);
}

/** Returns whether a value is a bounded IANA timezone supported by the runtime. */
export function isIanaTimezone(value: unknown): value is string {
  if (typeof value !== "string" || value.length > 64) return false;
  try { new Intl.DateTimeFormat("en", { timeZone: value }).format(); return true; } catch { return false; }
}

/** Returns a trailing inclusive local-date range without browser-timezone arithmetic. */
export function trailingRange(to: string, days: 7 | 30 | 365): { from: string; to: string } {
  const date = new Date(`${to}T00:00:00.000Z`);
  date.setUTCDate(date.getUTCDate() - days + 1);
  return { from: date.toISOString().slice(0, 10), to };
}

/** Creates monotonic request tokens so only the newest response may update UI state. */
export function createLatestRequestGate(): { begin(): number; isCurrent(token: number): boolean } {
  let current = 0;
  return { begin: () => ++current, isCurrent: (token) => token === current };
}

/** Builds the canonical dated drill-down route with an explicit safe timezone. */
export function dayRoute(localDate: string, timezone: string): string {
  return `/days/${encodeURIComponent(localDate)}?timezone=${encodeURIComponent(timezone)}`;
}

/** Same-origin adapter for the bounded progress overview contract. */
export async function fetchProgressOverview(from: string, to: string, timezone: string, signal?: AbortSignal): Promise<ProgressOverview> {
  const query = new URLSearchParams({ from, to, timezone });
  const response = await fetch(`/api/v1/progress-overview?${query.toString()}`, { credentials: "same-origin", headers: { accept: "application/json" }, signal: signal ?? null });
  if (!response.ok) throw Object.assign(new Error("Progress overview unavailable"), { status: response.status });
  return await response.json() as ProgressOverview;
}

/** Same-origin adapter for provider-neutral profile data coverage. */
export async function fetchProgressDataCoverage(localDate: string, timezone: string): Promise<ProgressDataCoverage> {
  const query = new URLSearchParams({ localDate, timezone });
  const response = await fetch(`/api/v1/progress-data-coverage?${query.toString()}`, { credentials: "same-origin", headers: { accept: "application/json" } });
  if (!response.ok) throw Object.assign(new Error("Profile data coverage unavailable"), { status: response.status });
  return await response.json() as ProgressDataCoverage;
}
