import type {
  HealthDataProvider,
  ProviderAuthorization,
  ProviderReconciliation
} from "../provider.js";
import { IntegrationProviderError } from "../provider.js";
import {
  normalizeIntervalsActivity,
  normalizeIntervalsWellness
} from "./normalizer.js";

const authorizationEndpoint = "https://intervals.icu/oauth/authorize";
const tokenEndpoint = "https://intervals.icu/api/oauth/token";
const apiOrigin = "https://intervals.icu";
const maxResponseBytes = 2_000_000;
const timeoutMs = 10_000;

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
        grant_type: "authorization_code",
        code,
        client_id: this.options.clientId,
        client_secret: this.options.clientSecret,
        redirect_uri: this.options.redirectUri
      })
    });
    if (!value || typeof value !== "object" || Array.isArray(value)) invalid();
    const record = value as Record<string, unknown>;
    if (typeof record.access_token !== "string" || record.access_token.length < 8) invalid();
    const externalUserId = typeof record.athlete_id === "string"
      ? record.athlete_id
      : typeof record.athlete_id === "number" ? String(record.athlete_id) : null;
    if (!externalUserId || externalUserId.length > 128) invalid();
    return { accessToken: record.access_token, externalUserId };
  }

  public async reconcile(accessToken: string, fromLocalDate: string, toLocalDate: string): Promise<ProviderReconciliation> {
    const headers = { authorization: `Bearer ${accessToken}`, accept: "application/json" };
    const [wellness, activities] = await Promise.all([
      this.fetchJson(`${apiOrigin}/api/v1/athlete/0/wellness/${fromLocalDate}/${toLocalDate}`, { headers }),
      this.fetchJson(`${apiOrigin}/api/v1/athlete/0/activities?oldest=${fromLocalDate}&newest=${toLocalDate}`, { headers })
    ]);
    if (!Array.isArray(wellness) || !Array.isArray(activities) || wellness.length > 400 || activities.length > 2_000) invalid();
    return {
      wellness: wellness.map(normalizeIntervalsWellness),
      activities: activities.map(normalizeIntervalsActivity)
    };
  }

  public async disconnect(accessToken: string): Promise<void> {
    await this.fetchJson(`${apiOrigin}/api/v1/athlete/0/disconnect-app`, {
      method: "POST",
      headers: { authorization: `Bearer ${accessToken}`, accept: "application/json" }
    }, true);
  }

  private async fetchJson(url: string, init: RequestInit, allowEmpty = false): Promise<unknown> {
    const controller = new AbortController();
    const timer = setTimeout(() => controller.abort(), timeoutMs);
    try {
      const response = await this.request(url, { ...init, signal: controller.signal });
      if (response.status === 401 || response.status === 403) throw new IntegrationProviderError("authorization_required");
      if (response.status === 429) throw new IntegrationProviderError("provider_rate_limited");
      if (!response.ok) throw new IntegrationProviderError("provider_unavailable");
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

function invalid(): never {
  throw new IntegrationProviderError("provider_response_invalid");
}
