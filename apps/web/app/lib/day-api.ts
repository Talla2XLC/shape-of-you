import { readCookie } from "./browser-security";

const csrfCookieName = "__Host-shape_of_you_api_csrf";

export interface DailyProjection {
  readonly localDate: string;
  readonly timezone: string;
  readonly asOf: string;
  readonly snapshot: {
    readonly physical: {
      readonly weightMeasurements: readonly { readonly weightKg: number }[];
    };
    readonly nutrition: {
      readonly totals: { readonly caloriesKcal: number | null; readonly mealCount: number };
    };
    readonly training: {
      readonly workoutSessions: readonly { readonly id: string }[];
    };
    readonly recovery: {
      readonly assessments: readonly {
        readonly id: string;
        readonly readinessScore: number;
        readonly riskLevel: string;
      }[];
    };
  };
}

export class DayApiError extends Error {
  public constructor(public readonly status: number) { super("Daily request was not accepted"); }
}

async function request<T>(path: string, init: RequestInit = {}): Promise<T> {
  const csrf = init.method && init.method !== "GET" ? readCookie(document.cookie, csrfCookieName) : null;
  const response = await fetch(path, { ...init, credentials: "same-origin", headers: { accept: "application/json", ...(init.body ? { "content-type": "application/json" } : {}), ...(csrf ? { "x-csrf-token": csrf } : {}), ...init.headers } });
  if (!response.ok) throw new DayApiError(response.status);
  return response.status === 204 ? undefined as T : await response.json() as T;
}

/** Same-origin browser adapter for the published daily projection contract. */
export const dayApi = {
  projection(localDate: string, timezone: string) { return request<DailyProjection>(`/api/v1/day-projections?localDate=${encodeURIComponent(localDate)}&timezone=${encodeURIComponent(timezone)}`); }
};
