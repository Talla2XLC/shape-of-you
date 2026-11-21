import { readCookie } from "./browser-security";

const csrfCookieName = "__Host-shape_of_you_api_csrf";

/** Browser-safe direct Garmin status; personal keys are write-only inputs. */
export interface GarminPersonalStatus {
  readonly provider: "garmin_personal";
  readonly displayName: "Garmin";
  readonly recoveryConnectionId: string | null;
  readonly lifecycle: "unavailable" | "connecting" | "active" | "degraded" | "disconnected";
  readonly failureCode: "authorization_required" | "provider_rate_limited" | "provider_timeout" | "provider_unavailable" | "provider_response_invalid" | "cutover_source_stopped" | null;
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
    readonly failureCode: GarminPersonalStatus["failureCode"];
    readonly scopeFromDate?: string;
  };
}

/** Bounded HTTP failure; untrusted provider response bodies are never retained. */
export class IntegrationApiError extends Error {
  public constructor(public readonly status: number) {
    super("Integration request was not accepted");
    this.name = "IntegrationApiError";
  }
}

/** Explains direct Garmin failures without echoing provider responses or keys. */
export function garminPersonalFailureReason(code: GarminPersonalStatus["failureCode"]): string | null {
  if (!code) return null;
  return {
    authorization_required: "Update your Garmin API key to continue syncing.",
    provider_rate_limited: "Garmin asked us to retry later.",
    provider_timeout: "Garmin did not respond in time. Please try again.",
    provider_unavailable: "Garmin is temporarily unavailable. Please try again.",
    provider_response_invalid: "Some Garmin data could not be safely imported.",
    cutover_source_stopped: "The old import period has ended. Already imported data remains available."
  }[code];
}

/** Maps key-linking failures to fixed copy; untrusted error text is never displayed. */
export function garminPersonalRequestMessage(error: unknown): string {
  if (error instanceof IntegrationApiError) {
    if (error.status === 401 || error.status === 403) return "Access could not be verified. Check your sign-in and Garmin API key.";
    if (error.status === 409) return "This connection could not be changed. Existing imports or retained history require a connection review. Contact support before changing accounts.";
    if (error.status === 429) return "Please wait a moment before trying again.";
    if (error.status === 400 || error.status === 422) return "The key could not be accepted. Copy the complete personal API key from Garmin and try again.";
  }
  return "Garmin could not be reached or the result could not be confirmed. Check the connection status before trying again.";
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

/** Same-origin direct Garmin management; keys are sent only in mutation bodies. */
export const garminPersonalApi = {
  status() { return request<GarminPersonalStatus>("/api/v1/integrations/garmin-personal"); },
  check(apiKey: string) {
    return request<{ readonly verified: true }>("/api/v1/integrations/garmin-personal/check", {
      method: "POST", body: JSON.stringify({ apiKey })
    });
  },
  connect(apiKey: string) {
    return request<GarminPersonalStatus>("/api/v1/integrations/garmin-personal/connect", {
      method: "POST", body: JSON.stringify({ apiKey, consent: true })
    });
  },
  disconnect() {
    return request<GarminPersonalStatus>("/api/v1/integrations/garmin-personal/disconnect", {
      method: "POST", body: JSON.stringify({ reason: "user requested disconnect" })
    });
  },
  startErasure(connectionId: string) {
    return request<{ readonly authorizationUrl: string }>("/api/browser-auth/recovery-erasure/start", {
      method: "POST", body: JSON.stringify({ connectionId })
    });
  },
  startHistoricalImport() {
    return request<GarminPersonalStatus>("/api/v1/integrations/garmin-personal/historical-import", { method: "POST" });
  }
};
