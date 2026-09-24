import type {
  HealthDataProvider,
  IntegrationFailureCode,
  IntegrationProviderDiagnostic,
  ProviderAuthorization,
  ProviderReconciliation
} from "../provider.js";
import { IntegrationProviderError } from "../provider.js";
import { gunzipSync } from "node:zlib";
import {
  normalizeIntervalsActivity,
  normalizeIntervalsWellness
} from "./normalizer.js";

const authorizationEndpoint = "https://intervals.icu/oauth/authorize";
const tokenEndpoint = "https://intervals.icu/api/oauth/token";
const apiOrigin = "https://intervals.icu";
const maxResponseBytes = 2_000_000;
const maxDiagnosticResponseBytes = 4_096;
const timeoutMs = 10_000;
const wellnessFields = [
  "id",
  "updated",
  "sleepSecs",
  "sleepScore",
  "restingHR",
  "avgSleepingHR",
  "hrv",
  "spO2",
  "respiration",
  "BodyBatteryMin",
  "BodyBatteryMax",
  "steps"
] as const;
const diagnosticHeaders = [
  "content-type",
  "content-length",
  "date",
  "retry-after",
  "x-request-id",
  "cf-ray",
  "traceparent"
] as const;

/** Stable runtime settings for the approved Intervals.icu OAuth application. */
export interface IntervalsIcuProviderOptions {
  readonly clientId: string;
  readonly clientSecret: string;
  readonly redirectUri: string;
  readonly fetch?: typeof fetch;
}

/** Official OAuth/REST transport adapter; provider payloads end at this boundary. */
export class IntervalsIcuProvider implements HealthDataProvider {
  private readonly request: typeof fetch;

  public constructor(private readonly options: IntervalsIcuProviderOptions) {
    const redirect = new URL(options.redirectUri);
    if (redirect.protocol !== "https:" && redirect.hostname !== "localhost") {
      throw new Error("Intervals.icu redirect URI must use HTTPS");
    }
    this.request = options.fetch ?? fetch;
  }

  public authorizationUrl(state: string): string {
    const url = new URL(authorizationEndpoint);
    url.searchParams.set("client_id", this.options.clientId);
    url.searchParams.set("redirect_uri", this.options.redirectUri);
    url.searchParams.set("response_type", "code");
    url.searchParams.set("scope", "ACTIVITY:READ,WELLNESS:READ");
    url.searchParams.set("state", state);
    return url.toString();
  }

  public async exchangeAuthorizationCode(code: string): Promise<ProviderAuthorization> {
    const value = await this.fetchJson(tokenEndpoint, {
      method: "POST",
      headers: { "content-type": "application/x-www-form-urlencoded", accept: "application/json" },
      body: new URLSearchParams({
        client_id: this.options.clientId,
        client_secret: this.options.clientSecret,
        code
      })
    }, false, {
      operation: "oauth_token_exchange",
      sensitiveValues: [this.options.clientId, this.options.clientSecret, code]
    });
    if (!value || typeof value !== "object" || Array.isArray(value)) invalid();
    const record = value as Record<string, unknown>;
    if (typeof record.access_token !== "string" || record.access_token.length < 8) invalid();
    const athlete = record.athlete;
    if (!athlete || typeof athlete !== "object" || Array.isArray(athlete)) invalid();
    const athleteId = (athlete as Record<string, unknown>).id;
    const externalUserId = typeof athleteId === "string"
      ? athleteId
      : typeof athleteId === "number" ? String(athleteId) : null;
    if (!externalUserId || externalUserId.length > 128) invalid();
    return { accessToken: record.access_token, externalUserId };
  }

  public async reconcile(accessToken: string, fromLocalDate: string, toLocalDate: string): Promise<ProviderReconciliation> {
    const headers = { authorization: `Bearer ${accessToken}`, accept: "application/json" };
    const wellnessUrl = new URL(`${apiOrigin}/api/v1/athlete/0/wellness`);
    wellnessUrl.searchParams.set("oldest", fromLocalDate);
    wellnessUrl.searchParams.set("newest", toLocalDate);
    wellnessUrl.searchParams.set("fields", wellnessFields.join(","));
    const [wellness, activities] = await Promise.all([
      this.fetchJson(wellnessUrl.toString(), { headers }),
      this.fetchJson(`${apiOrigin}/api/v1/athlete/0/activities?oldest=${fromLocalDate}&newest=${toLocalDate}`, { headers })
    ]);
    if (!Array.isArray(wellness) || !Array.isArray(activities) || wellness.length > 400 || activities.length > 2_000) invalid();
    return {
      wellness: wellness.map(normalizeIntervalsWellness),
      activities: activities.map(normalizeIntervalsActivity)
    };
  }

  public async disconnect(accessToken: string): Promise<void> {
    await this.fetchJson(`${apiOrigin}/api/v1/disconnect-app`, {
      method: "DELETE",
      headers: { authorization: `Bearer ${accessToken}`, accept: "application/json" }
    }, true);
  }

  /** Fetches one original provider activity file without retaining its other contents. */
  public async originalActivityFile(accessToken: string, activityId: string): Promise<Uint8Array | null> {
    if (!activityId || activityId.length > 128) invalid();
    const controller = new AbortController();
    const timer = setTimeout(() => controller.abort(), timeoutMs);
    try {
      const response = await this.request(`${apiOrigin}/api/v1/activity/${encodeURIComponent(activityId)}/file`, {
        headers: { authorization: `Bearer ${accessToken}`, accept: "application/octet-stream" },
        redirect: "error",
        signal: controller.signal
      });
      if (response.status === 404) return null;
      if (!response.ok) throw new IntegrationProviderError(classifyHttpFailure(response.status));
      const contentType = response.headers.get("content-type")?.split(";", 1)[0]?.trim().toLowerCase();
      if (contentType && (
        contentType.startsWith("text/") || contentType === "application/json" ||
        contentType === "application/xml" || contentType === "application/xhtml+xml"
      )) invalid();
      const declared = Number(response.headers.get("content-length"));
      if (Number.isFinite(declared) && declared > maxResponseBytes) invalid();
      if (!response.body) invalid();
      const chunks: Uint8Array[] = [];
      let length = 0;
      for await (const chunk of response.body) {
        length += chunk.byteLength;
        if (length > maxResponseBytes) invalid();
        chunks.push(chunk);
      }
      const body = Buffer.concat(chunks);
      if (body.length < 2) invalid();
      let file: Buffer;
      try {
        file = body[0] === 0x1f && body[1] === 0x8b
          ? gunzipSync(body, { maxOutputLength: maxResponseBytes })
          : body;
      } catch { invalid(); }
      if (file.length > maxResponseBytes) invalid();
      return file;
    } catch (error) {
      if (error instanceof IntegrationProviderError) throw error;
      if (error instanceof Error && error.name === "AbortError") throw new IntegrationProviderError("provider_timeout");
      throw new IntegrationProviderError("provider_unavailable");
    } finally {
      clearTimeout(timer);
    }
  }

  private async fetchJson(
    url: string,
    init: RequestInit,
    allowEmpty = false,
    diagnosticContext?: DiagnosticContext
  ): Promise<unknown> {
    const controller = new AbortController();
    const timer = setTimeout(() => controller.abort(), timeoutMs);
    try {
      const response = await this.request(url, { ...init, signal: controller.signal });
      if (!response.ok) {
        const failureCode = classifyHttpFailure(response.status);
        const diagnostic = diagnosticContext
          ? await createDiagnostic(response, diagnosticContext)
          : undefined;
        throw new IntegrationProviderError(failureCode, undefined, diagnostic);
      }
      const declaredLength = Number(response.headers.get("content-length"));
      if (Number.isFinite(declaredLength) && declaredLength > maxResponseBytes) invalid();
      const text = await response.text();
      if (text.length > maxResponseBytes) invalid();
      if (!text && allowEmpty) return null;
      try { return JSON.parse(text) as unknown; } catch { invalid(); }
    } catch (error) {
      if (error instanceof IntegrationProviderError) throw error;
      if (error instanceof Error && error.name === "AbortError") throw new IntegrationProviderError("provider_timeout");
      throw new IntegrationProviderError("provider_unavailable");
    } finally {
      clearTimeout(timer);
    }
  }
}

interface DiagnosticContext {
  readonly operation: IntegrationProviderDiagnostic["operation"];
  readonly sensitiveValues: readonly string[];
}

function classifyHttpFailure(status: number): IntegrationFailureCode {
  if (status === 401 || status === 403) return "authorization_required";
  if (status === 429) return "provider_rate_limited";
  return "provider_unavailable";
}

async function createDiagnostic(
  response: Response,
  context: DiagnosticContext
): Promise<IntegrationProviderDiagnostic> {
  const headers: Record<string, string> = {};
  for (const name of diagnosticHeaders) {
    const value = response.headers.get(name);
    if (value) headers[name] = sanitizeDiagnosticText(value, context.sensitiveValues, 256);
  }
  const body = await readBoundedDiagnosticBody(response);
  return {
    operation: context.operation,
    httpStatus: response.status,
    headers,
    responseBody: sanitizeDiagnosticText(body.text, context.sensitiveValues, maxDiagnosticResponseBytes),
    responseBodyTruncated: body.truncated
  };
}

async function readBoundedDiagnosticBody(response: Response): Promise<{ text: string; truncated: boolean }> {
  if (!response.body) return { text: "", truncated: false };
  const reader = response.body.getReader();
  const decoder = new TextDecoder();
  let text = "";
  let readBytes = 0;
  let truncated = false;
  try {
    while (true) {
      const { done, value } = await reader.read();
      if (done) break;
      const remaining = maxDiagnosticResponseBytes - readBytes;
      if (value.byteLength > remaining) {
        text += decoder.decode(value.subarray(0, Math.max(remaining, 0)), { stream: true });
        truncated = true;
        await reader.cancel();
        break;
      }
      readBytes += value.byteLength;
      text += decoder.decode(value, { stream: true });
      if (readBytes === maxDiagnosticResponseBytes) {
        const next = await reader.read();
        truncated = !next.done;
        if (truncated) await reader.cancel();
        break;
      }
    }
  } finally {
    text += decoder.decode();
    reader.releaseLock();
  }
  return { text, truncated };
}

function sanitizeDiagnosticText(value: string, sensitiveValues: readonly string[], maxCharacters: number): string {
  let sanitized = value.replace(/[\u0000-\u0008\u000B\u000C\u000E-\u001F\u007F]/g, "?");
  for (const sensitive of sensitiveValues) {
    if (sensitive) sanitized = sanitized.split(sensitive).join("[redacted]");
  }
  sanitized = sanitized
    .replace(/("(?:access_token|refresh_token|client_secret|code)"\s*:\s*")[^"]*(")/gi, "$1[redacted]$2")
    .replace(/((?:access_token|refresh_token|client_secret|code)=)[^&\s]*/gi, "$1[redacted]")
    .replace(/(Bearer\s+)[A-Za-z0-9._~-]+/gi, "$1[redacted]")
    .replace(/\b[A-Z0-9._%+-]+@[A-Z0-9.-]+\.[A-Z]{2,}\b/gi, "[redacted-email]")
    .replace(/\b[A-Za-z0-9._~-]{32,}\b/g, "[redacted-token]");
  return sanitized.slice(0, maxCharacters);
}

function invalid(): never {
  throw new IntegrationProviderError("provider_response_invalid");
}
