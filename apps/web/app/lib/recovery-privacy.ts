import { readCookie } from "./browser-security";

const apiCsrfCookieName = "__Host-shape_of_you_api_csrf";

/** Browser projection of one Person-owned Recovery connection. */
export interface RecoveryConnectionSummary {
  readonly id: string;
  readonly status: "active" | "disconnected";
  readonly device: {
    readonly label: string | null;
    readonly modelVersion: {
      readonly providerName: string;
      readonly name: string;
    };
  };
  readonly connectedAt: string;
  readonly erasureRequestedAt: string | null;
}

/** Minimal server-owned status of one Recovery erasure request. */
export interface RecoveryErasureSummary {
  readonly id: string;
  readonly connectionId: string;
  readonly reason: "user_request" | "retention_expired";
  readonly status: "pending" | "processing" | "completed";
  readonly requestedAt: string;
  readonly completedAt: string | null;
}

/** Bounded privacy API failure that never copies server details to the UI. */
export class RecoveryPrivacyApiError extends Error {
  public constructor(public readonly status: number) {
    super("Recovery privacy request was not accepted");
    this.name = "RecoveryPrivacyApiError";
  }
}

async function request<T>(path: string, init: RequestInit = {}): Promise<T> {
  const csrf = init.method && init.method !== "GET"
    ? readCookie(document.cookie, apiCsrfCookieName)
    : null;
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
  if (!response.ok) throw new RecoveryPrivacyApiError(response.status);
  return await response.json() as T;
}

/** Same-origin adapter for Recovery connection privacy controls. */
export const recoveryPrivacyApi = {
  listConnections() {
    return request<{ readonly items: readonly RecoveryConnectionSummary[] }>(
      "/api/v1/recovery/connections"
    );
  },
  startErasure(connectionId: string) {
    return request<{ readonly authorizationUrl: string }>(
      "/api/browser-auth/recovery-erasure/start",
      { method: "POST", body: JSON.stringify({ connectionId }) }
    );
  },
  getErasureRequest(id: string) {
    return request<RecoveryErasureSummary>(
      `/api/v1/recovery/erasure-requests/${encodeURIComponent(id)}`
    );
  }
};
