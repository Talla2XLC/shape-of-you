import { readCookie } from "./browser-security";

const csrfCookieName = "__Host-shape_of_you_api_csrf";

/** Browser-safe status of Garmin through Intervals.icu. */
export interface GarminIntervalsStatus {
  readonly provider: "intervals_icu";
  readonly displayName: "Garmin via Intervals.icu";
  readonly recoveryConnectionId: string | null;
  readonly lifecycle: "unavailable" | "connecting" | "active" | "degraded" | "disconnected";
  readonly failureCode: "authorization_required" | "provider_rate_limited" | "provider_timeout" | "provider_unavailable" | "provider_response_invalid" | null;
  readonly lastAttemptAt: string | null;
  readonly lastSuccessfulSyncAt: string | null;
  readonly lastDataAt: string | null;
  readonly connectedAt: string | null;
  readonly disconnectedAt: string | null;
  readonly historicalImport: {
    readonly status: "not_requested" | "running" | "completed" | "failed";
    readonly processedThroughDate: string | null;
    readonly requestedAt: string | null;
    readonly lastAttemptAt: string | null;
    readonly completedAt: string | null;
    readonly failureCode: GarminIntervalsStatus["failureCode"];
  };
}

export class IntegrationApiError extends Error {
  public constructor(public readonly status: number) {
    super("Integration request was not accepted");
    this.name = "IntegrationApiError";
  }
}

/** Maps persisted provider failure classes to bounded, non-sensitive UI copy. */
export function integrationFailureReason(code: GarminIntervalsStatus["failureCode"]): string | null {
  if (!code) return null;
  return {
    authorization_required: "Authorization needs to be renewed.",
    provider_rate_limited: "Intervals.icu asked us to retry later.",
    provider_timeout: "Intervals.icu did not respond in time.",
    provider_unavailable: "Intervals.icu is temporarily unavailable.",
    provider_response_invalid: "Intervals.icu returned data we could not safely import."
  }[code];
}

/** Maps the bounded OAuth callback result to safe user-facing copy. */
export function integrationAuthorizationResultMessage(
  result: string | readonly (string | null)[] | null | undefined
): string | null {
  return result === "authorization_failed"
    ? "Intervals.icu authorization could not be completed. Please try again."
    : null;
}

async function request<T>(path: string, init: RequestInit = {}): Promise<T> {
  const csrf = init.method && init.method !== "GET" ? readCookie(document.cookie, csrfCookieName) : null;
  const response = await fetch(path, {
    ...init,
    credentials: "same-origin",
    cache: "no-store",
    headers: {
      accept: "application/json",
      ...(init.body ? { "content-type": "application/json" } : {}),
      ...(csrf ? { "x-csrf-token": csrf } : {}),
      ...init.headers
    }
  });
  if (!response.ok) throw new IntegrationApiError(response.status);
  return await response.json() as T;
}

/** Same-origin browser adapter; OAuth tokens never enter JavaScript. */
export const integrationApi = {
  status() { return request<GarminIntervalsStatus>("/api/v1/integrations/garmin-intervals"); },
  start() {
    return request<{ readonly authorizationUrl: string }>("/api/v1/integrations/garmin-intervals/authorization", {
      method: "POST", body: JSON.stringify({ returnTo: "/connections" })
    });
  },
  disconnect() {
    return request<GarminIntervalsStatus>("/api/v1/integrations/garmin-intervals/disconnect", {
      method: "POST", body: JSON.stringify({ reason: "user requested disconnect" })
    });
  },
  startHistoricalImport() {
    return request<GarminIntervalsStatus>("/api/v1/integrations/garmin-intervals/historical-import", {
      method: "POST"
    });
  },
  startErasure(connectionId: string) {
    return request<{ readonly authorizationUrl: string }>("/api/browser-auth/recovery-erasure/start", {
      method: "POST", body: JSON.stringify({ connectionId })
    });
  }
};
