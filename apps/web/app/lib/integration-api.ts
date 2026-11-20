import { readCookie } from "./browser-security";
import type {
  CancelGarminCutover,
  GarminCutoverCapability,
  GarminCutoverPreview,
  GarminCutoverStatus,
  PreviewGarminCutover,
  RetryGarminCutover,
  ScheduleGarminCutover
} from "../../../../packages/contracts/src/integration-cutover";

export type {
  GarminCutover,
  GarminCutoverCapability,
  GarminCutoverGap,
  GarminCutoverPreview,
  GarminCutoverStatus
} from "../../../../packages/contracts/src/integration-cutover";

const csrfCookieName = "__Host-shape_of_you_api_csrf";

/** Browser-safe status of Garmin through Intervals.icu. */
export interface GarminIntervalsStatus {
  readonly provider: "intervals_icu";
  readonly displayName: "Garmin via Intervals.icu";
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
    readonly failureCode: GarminIntervalsStatus["failureCode"];
    readonly scopeFromDate?: string;
  };
}

/** Safe direct Garmin projection; personal keys are write-only inputs. */
export type GarminPersonalStatus = Omit<GarminIntervalsStatus, "provider" | "displayName"> & {
  readonly provider: "garmin_personal";
  readonly displayName: "Garmin";
};

export class IntegrationApiError extends Error {
  public constructor(public readonly status: number, public readonly cutoverPreview?: GarminCutoverPreview) {
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
    provider_response_invalid: "Intervals.icu returned data we could not safely import.",
    cutover_source_stopped: "Intervals history import stopped at the end of the transition period. Unchecked older dates have not been marked complete."
  }[code];
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
    if (error.status === 409) return "This connection could not be changed. Existing Intervals imports or retained history can prevent switching automatically.";
    if (error.status === 429) return "Please wait a moment before trying again.";
    if (error.status === 400 || error.status === 422) return "The key could not be accepted. Copy the complete personal API key from Garmin and try again.";
  }
  return "Garmin could not be reached or the result could not be confirmed. Check the connection status before trying again.";
}

/** Maps the bounded OAuth callback result to safe user-facing copy. */
export function integrationAuthorizationResultMessage(
  result: string | readonly (string | null)[] | null | undefined
): string | null {
  return result === "authorization_failed"
    ? "Intervals.icu authorization could not be completed. Please try again."
    : null;
}

async function request<T>(path: string, init: RequestInit = {}, allowCutoverPreview = false): Promise<T> {
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
  if (!response.ok) throw new IntegrationApiError(response.status, allowCutoverPreview && response.status === 409 ? await readCutoverErrorPreview(response) : undefined);
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
  startHistoricalImport() {
    return request<GarminPersonalStatus>("/api/v1/integrations/garmin-personal/historical-import", { method: "POST" });
  }
};

/** Same-origin cutover operations; a failed preview never persists a key. */
export const garminCutoverApi = {
  status() { return request<GarminCutoverStatus>("/api/v1/integrations/garmin-personal/cutover"); },
  preview(input: PreviewGarminCutover = {}) {
    return request<GarminCutoverPreview>("/api/v1/integrations/garmin-personal/cutover/preview", {
      method: "POST", body: JSON.stringify(input)
    });
  },
  schedule(input: ScheduleGarminCutover) {
    return request<GarminCutoverStatus>("/api/v1/integrations/garmin-personal/cutover/schedule", {
      method: "POST", body: JSON.stringify(input)
    }, true);
  },
  retry(input: RetryGarminCutover) {
    return request<GarminCutoverStatus>("/api/v1/integrations/garmin-personal/cutover/retry", {
      method: "POST", body: JSON.stringify(input)
    }, true);
  },
  cancel(input: CancelGarminCutover) {
    return request<GarminCutoverStatus>("/api/v1/integrations/garmin-personal/cutover/cancel", {
      method: "POST", body: JSON.stringify(input)
    });
  }
};

/** Fixed labels prevent arbitrary provider error text from reaching the interface. */
export function cutoverCapabilityLabel(capability: GarminCutoverCapability): string {
  return {
    "recovery.hrv_rmssd": "Overnight HRV (RMSSD)",
    "recovery.sleep_score": "Overall sleep score",
    "training.normalized_load": "Comparable training load",
    "training.device_attribution": "Confirmed Garmin device attribution",
    "training.original_fit": "Original training details (FIT)"
  }[capability];
}

/** Explains safe transition failures without showing exception or provider text. */
export function garminCutoverRequestMessage(error: unknown): string {
  if (error instanceof IntegrationApiError) {
    if (error.cutoverPreview) return "The coverage check changed. Review and confirm the updated limitations before continuing. Your key has not been saved.";
    if (error.status === 409) return "The transition changed or this action is no longer available. Refresh its status and review a new preview before trying again.";
    if (error.status === 400 || error.status === 422) return "Check the selected start date and your confirmations, then try again.";
    if (error.status === 401 || error.status === 403) return "Your sign-in or Garmin access could not be verified.";
    if (error.status === 429) return "Please wait a moment before trying again.";
    if (error.status === 503) return "The transition is temporarily unavailable. Refresh its status before trying again.";
  }
  return "The result could not be confirmed. Refresh the transition status before sending another request.";
}

async function readCutoverErrorPreview(response: Response): Promise<GarminCutoverPreview | undefined> {
  const limit = 16_384;
  if (Number(response.headers.get("content-length")) > limit || !response.body) return undefined;
  const reader = response.body.getReader();
  const decoder = new TextDecoder();
  let text = "";
  let length = 0;
  try {
    while (true) {
      const chunk = await reader.read();
      if (chunk.done) break;
      length += chunk.value.byteLength;
      if (length > limit) { await reader.cancel(); return undefined; }
      text += decoder.decode(chunk.value, { stream: true });
    }
    text += decoder.decode();
    const envelope: unknown = JSON.parse(text);
    if (!isRecord(envelope) || envelope.error !== "coverage_changed" || !isRecord(envelope.details)) return undefined;
    return safeCutoverPreview(envelope.details.preview);
  } catch {
    return undefined;
  } finally {
    reader.releaseLock();
  }
}

function isRecord(value: unknown): value is Record<string, unknown> {
  return value !== null && typeof value === "object" && !Array.isArray(value);
}

function safeCutoverPreview(value: unknown): GarminCutoverPreview | undefined {
  if (!isRecord(value)) return undefined;
  const date = (item: unknown): item is string => typeof item === "string" && /^\d{4}-\d{2}-\d{2}$/.test(item) && !Number.isNaN(Date.parse(`${item}T00:00:00Z`)) && new Date(`${item}T00:00:00Z`).toISOString().slice(0, 10) === item;
  const instant = (item: unknown): item is string => typeof item === "string" && item.length <= 40 && /^\d{4}-\d{2}-\d{2}T/.test(item) && !Number.isNaN(Date.parse(item));
  const bounded = (item: unknown, max: number): item is string => typeof item === "string" && item.length > 0 && item.length <= max;
  if (!bounded(value.expectedRevision, 512) || !date(value.startsOn) || !bounded(value.timezone, 100) ||
      !instant(value.startsAt) || !instant(value.sourceDrainsUntil) || !date(value.sourceTailFromDate) ||
      !bounded(value.capabilityVersion, 128) || !Array.isArray(value.gaps) || value.gaps.length > 5) return undefined;
  try { new Intl.DateTimeFormat("en", { timeZone: value.timezone }); } catch { return undefined; }
  const capabilities = ["recovery.hrv_rmssd", "recovery.sleep_score", "training.normalized_load", "training.device_attribution", "training.original_fit"] as const;
  const gaps: GarminCutoverPreview["gaps"] = [];
  for (const item of value.gaps) {
    if (!isRecord(item) || !capabilities.includes(item.capability as GarminCutoverCapability) ||
        (item.status !== "unsupported" && item.status !== "unverified")) return undefined;
    const capability = item.capability as GarminCutoverCapability;
    if (gaps.some((gap) => gap.capability === capability)) return undefined;
    gaps.push({ capability, status: item.status, description: cutoverCapabilityLabel(capability) });
  }
  return {
    expectedRevision: value.expectedRevision, startsOn: value.startsOn, timezone: value.timezone,
    startsAt: value.startsAt, sourceDrainsUntil: value.sourceDrainsUntil,
    sourceTailFromDate: value.sourceTailFromDate, capabilityVersion: value.capabilityVersion, gaps
  };
}
