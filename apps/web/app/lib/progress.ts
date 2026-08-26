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
