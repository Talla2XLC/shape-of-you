import { createHash } from "node:crypto";

import type { ProviderActivityRecord, ProviderReconciliation, ProviderWellnessRecord } from "../provider.js";
import { ActivityDetailsReadError, IntegrationProviderError } from "../provider.js";
import { extractOriginalFit } from "./zip.js";

const origin = "https://personal.connectapi.garmin.com";
const tokenPath = "/personalapitoken-service/personal-api/personal-api-key/token";
const maxBytes = 2_000_000;
const dayMs = 86_400_000;
type RecordValue = Record<string, unknown>;
interface CachedToken { readonly promise: Promise<{ token: string; expiresAt: number }>; }

/** Injected HTTP boundary for deterministic contract checks; callers cannot choose the remote host. */
export interface GarminPersonalProviderOptions { readonly fetch?: typeof fetch; }

/** Official personal-key transport. Credentials and raw responses never escape into errors or logs. */
export class GarminPersonalProvider {
  private readonly request: typeof fetch;
  private readonly tokens = new Map<string, CachedToken>();
  private readonly revokedScopes = new Set<string>();
  private revocationsExhausted = false;

  public constructor(options: GarminPersonalProviderOptions = {}) { this.request = options.fetch ?? fetch; }

  /** Checks authentication without requiring health records or retaining the key/token after the request. */
  public async verifyKey(apiKey: string): Promise<void> {
    const { token } = await this.authenticate(apiKey);
    asRecord(await this.json("/userprofile-service/userprofile/settings", token));
  }

  /** Invalidates only this key's memory cache, including an in-flight refresh that must not be reused. */
  public forget(apiKey: string): void {
    const prefix = `${fingerprint(apiKey)}:`;
    for (const key of this.tokens.keys()) if (key.startsWith(prefix)) this.tokens.delete(key);
  }

  /** Permanently retires one connection/consent generation in this process, including pending refreshes. */
  public invalidateScope(scope: string): void {
    const hash = fingerprint(scope);
    if (!this.revokedScopes.has(hash)) {
      if (this.revokedScopes.size >= 10_000) this.revocationsExhausted = true;
      else this.revokedScopes.add(hash);
    }
    for (const key of this.tokens.keys()) if (key.endsWith(`:${hash}`)) this.tokens.delete(key);
  }

  /** Reads at most 31 inclusive days; complete pagination or failure prevents a silently partial import. */
  public async reconcile(apiKey: string, fromDate: string, toDate: string, scope = "unbound"): Promise<ProviderReconciliation & { readonly externalUserId: string | null }> {
    try { return await this.reconcileWindow(apiKey, fromDate, toDate, scope); }
    catch (error) {
      if (error instanceof IntegrationProviderError && error.failureCode === "authorization_required") this.tokens.delete(this.cacheKey(apiKey, scope));
      throw error;
    }
  }

  private async reconcileWindow(apiKey: string, fromDate: string, toDate: string, scope: string): Promise<ProviderReconciliation & { readonly externalUserId: string | null }> {
    const dates = dateRange(fromDate, toDate);
    const deadline = Date.now() + 45_000;
    const token = await this.token(apiKey, scope);
    const get = async (path: string): Promise<unknown> => {
      this.assertScope(scope);
      if (Date.now() >= deadline) throw new IntegrationProviderError("provider_timeout");
      const value = await this.json(path, token, deadline);
      this.assertScope(scope);
      return value;
    };
    const profile = asRecord(await get("/userprofile-service/userprofile/settings"));
    const timezone = profile.timeZone == null ? null : validTimezone(profile.timeZone);
    const document = asRecord(await get(`/usersummary-service/v2/dailysummaries?startDate=${fromDate}&endDate=${toDate}`));
    if (!Array.isArray(document.data) || document.data.length > dates.length) invalid();
    const daily = new Map<string, RecordValue>();
    const accountIds = new Set<string>();
    for (const item of document.data) {
      const record = asRecord(item);
      const date = requiredString(record.calendarDate, 10);
      if (!dates.includes(date) || daily.has(date)) invalid();
      accountIds.add(profileId(record.userProfilePk));
      daily.set(date, record);
    }
    const wellness: ProviderWellnessRecord[] = [];
    for (const date of dates) {
      const sleep = await get(`/sleep-service/sleep/dailySleep?date=${date}`);
      const heartRate = await get(`/wellness-service/wellness/dailyHeartRate?date=${date}`);
      const summary = daily.get(date);
      const sleepRecord = optionalRecord(sleep);
      const heartRecord = optionalRecord(heartRate);
      for (const item of [sleepRecord, heartRecord]) {
        if (Object.keys(item).length) {
          if (item.calendarDate !== date) invalid();
          accountIds.add(profileId(item.userProfilePK));
        }
      }
      if (!summary && !Object.keys(sleepRecord).length && !Object.keys(heartRecord).length) continue;
      const battery = optionalRecord(summary?.bodyBattery);
      const movement = optionalRecord(summary?.movement);
      const chronology = optionalRecord(summary?.wellnessChronology);
      const bodyBatteryMinimum = numberOrNull(battery.minValue, 5, 100);
      const bodyBatteryMaximum = numberOrNull(battery.maxValue, 5, 100);
      const bodyBatteryLatest = numberOrNull(battery.latestValue, 5, 100);
      if (bodyBatteryLatest !== null && !Number.isInteger(bodyBatteryLatest)) invalid();
      if (bodyBatteryMinimum !== null && bodyBatteryMaximum !== null && bodyBatteryMinimum > bodyBatteryMaximum) invalid();
      const sleepSeconds = numberOrNull(sleepRecord.sleepTimeSeconds, 0, 172_800);
      const steps = numberOrNull(optionalRecord(movement.steps).value, 0, 1_000_000);
      if (steps !== null && !Number.isInteger(steps)) invalid();
      wellness.push({
        identity: date, localDate: date, timezone: timezone ?? invalid(),
        updatedAt: chronology.endTimestampGmt == null ? null : gmtTimestamp(chronology.endTimestampGmt),
        totalSleepMinutes: sleepSeconds === null ? null : Math.round(sleepSeconds / 60),
        sleepScore: null, restingHeartRate: numberOrNull(heartRecord.restingHeartRate, 1, 300),
        averageSleepingHeartRate: numberOrNull(sleepRecord.avgHeartRate, 1, 300), hrvRmssd: null,
        oxygenSaturation: numberOrNull(sleepRecord.averageSpO2Value, 1, 100),
        respirationRate: numberOrNull(sleepRecord.averageRespirationValue, 1, 100),
        bodyBatteryMinimum, bodyBatteryMaximum, bodyBatteryLatest, steps
      });
    }
    const activities: ProviderActivityRecord[] = [];
    const seen = new Set<string>();
    const pageSize = 99;
    let complete = false;
    for (let page = 0; page < 21; page++) {
      const pageData = await get(`/activitylist-service/activities/search/activities?start=${page * pageSize}&limit=${pageSize}&startDate=${fromDate}&endDate=${toDate}&excludeChildren=true&sortOrder=asc`);
      if (!Array.isArray(pageData) || pageData.length > pageSize) invalid();
      if (activities.length + pageData.length > 2_000) invalid();
      for (const value of pageData) {
        const summary = asRecord(value);
        const id = profileId(summary.activityId);
        if (seen.has(id)) invalid();
        seen.add(id);
        const owner = profileId(summary.ownerId);
        accountIds.add(owner);
        const detail = asRecord(await get(`/activity-service/activity/${id}`));
        if (profileId(detail.activityId) !== id || profileId(detail.userProfileId) !== owner) invalid();
        const data = asRecord(detail.summaryDTO);
        const activityTimezone = validTimezone(asRecord(detail.timeZoneUnitDTO).timeZone);
        const occurredAt = gmtTimestamp(data.startTimeGMT);
        const localDate = requiredString(data.startTimeLocal, 64).slice(0, 10);
        if (!dates.includes(localDate) || dateInTimezone(occurredAt, activityTimezone) !== localDate) invalid();
        const durationSeconds = numberOrNull(data.duration, 0, 604_800);
        if (durationSeconds === null) invalid();
        activities.push({
          identity: id, fileType: "fit", occurredAt, localDate, timezone: activityTimezone,
          name: requiredString(detail.activityName, 256), durationSeconds: Math.round(durationSeconds),
          distanceMeters: numberOrNull(data.distance, 0, 10_000_000),
          trainingLoad: null, trainingLoadBasis: null, trainingLoadBasisVersion: null,
          averageHeartRate: numberOrNull(data.averageHR, 0, 300), maximumHeartRate: numberOrNull(data.maxHR, 0, 300),
          deviceName: null, garminAttributed: false
        });
      }
      if (pageData.length < pageSize) { complete = true; break; }
    }
    if (!complete || accountIds.size > 1) invalid();
    this.assertScope(scope);
    return { wellness, activities, externalUserId: accountIds.values().next().value ?? null };
  }

  /** Downloads and validates the original ZIP; returns null only for an absent file or a valid ZIP without FIT. */
  public async originalActivityFile(apiKey: string, activityId: string, scope = "unbound"): Promise<Uint8Array | null> {
    if (!/^[1-9]\d{0,19}$/.test(activityId)) invalid();
    const token = await this.token(apiKey, scope);
    try {
      const body = await this.read(`/download-service/files/activity/${activityId}`, {
        headers: { authorization: `Bearer ${token}`, accept: "application/zip, application/x-zip-compressed, application/octet-stream" }
      }, true);
      this.assertScope(scope);
      return body === null ? null : extractOriginalFit(body);
    } catch (error) {
      if (error instanceof IntegrationProviderError && error.failureCode === "authorization_required") this.tokens.delete(this.cacheKey(apiKey, scope));
      throw error;
    }
  }

  private async token(apiKey: string, scope: string): Promise<string> {
    this.assertScope(scope);
    const key = this.cacheKey(apiKey, scope);
    let entry = this.tokens.get(key);
    if (entry) {
      const cached = await entry.promise;
      this.assertScope(scope);
      if (cached.expiresAt > Date.now() + 60_000) return cached.token;
      if (this.tokens.get(key) === entry) this.tokens.delete(key);
      entry = this.tokens.get(key);
    }
    if (!entry) {
      if (this.tokens.size >= 100) this.tokens.delete(this.tokens.keys().next().value!);
      entry = { promise: this.authenticate(apiKey) };
      this.tokens.set(key, entry);
    }
    try {
      const value = await entry.promise;
      this.assertScope(scope);
      return value.token;
    }
    catch (error) { if (this.tokens.get(key) === entry) this.tokens.delete(key); throw error; }
  }

  private cacheKey(apiKey: string, scope: string): string { return `${fingerprint(apiKey)}:${fingerprint(scope)}`; }

  private assertScope(scope: string): void {
    if (this.revocationsExhausted || this.revokedScopes.has(fingerprint(scope))) throw new IntegrationProviderError("authorization_required");
  }

  private async authenticate(apiKey: string): Promise<{ token: string; expiresAt: number }> {
    if (!apiKey || apiKey.length > 4096 || /[\s\u0000-\u001f\u007f]/.test(apiKey)) throw new IntegrationProviderError("authorization_required");
    const body = await this.read(tokenPath, { method: "POST", headers: { authorization: `ApiKey ${apiKey}`, accept: "*/*" } });
    if (!body || body.length > 16_384) invalid();
    const token = body.toString("utf8").trim();
    try {
      if (!/^[\w-]+\.[\w-]+\.[\w-]+$/.test(token)) invalid();
      const claims = asRecord(JSON.parse(Buffer.from(token.split(".")[1]!, "base64url").toString("utf8")));
      if (typeof claims.exp !== "number" || !Number.isSafeInteger(claims.exp) || claims.exp * 1000 <= Date.now()) invalid();
      return { token, expiresAt: Math.min(claims.exp * 1000, Date.now() + dayMs) };
    } catch { invalid(); }
  }

  private async json(path: string, token: string, deadline?: number): Promise<unknown> {
    const bytes = await this.read(path, { headers: { authorization: `Bearer ${token}`, accept: "application/json" } }, false, deadline);
    if (bytes === null) return null;
    try { return JSON.parse(bytes.toString("utf8")) as unknown; } catch { invalid(); }
  }

  private async read(path: string, init: RequestInit, file = false, deadline = Date.now() + 10_000): Promise<Buffer | null> {
    const controller = new AbortController();
    const timeout = setTimeout(() => controller.abort(), Math.max(1, Math.min(10_000, deadline - Date.now())));
    try {
      const response = await this.request(`${origin}${path}`, { ...init, redirect: "error", signal: controller.signal });
      if (response.status === 204 || (file && response.status === 404)) { await response.body?.cancel(); return null; }
      if (!response.ok) {
        await response.body?.cancel();
        throw new IntegrationProviderError(response.status === 401 || response.status === 403 ? "authorization_required" : response.status === 429 ? "provider_rate_limited" : "provider_unavailable");
      }
      if (Number(response.headers.get("content-length")) > maxBytes) {
        await response.body?.cancel();
        throw file ? new ActivityDetailsReadError("limit_exceeded") : new IntegrationProviderError("provider_response_invalid");
      }
      if (!response.body) invalid();
      const chunks: Uint8Array[] = [];
      let size = 0;
      for await (const chunk of response.body) {
        size += chunk.byteLength;
        if (size > maxBytes) throw file ? new ActivityDetailsReadError("limit_exceeded") : new IntegrationProviderError("provider_response_invalid");
        chunks.push(chunk);
      }
      if (!size) invalid();
      return Buffer.concat(chunks);
    } catch (error) {
      if (error instanceof IntegrationProviderError) throw error;
      throw new IntegrationProviderError(controller.signal.aborted ? "provider_timeout" : "provider_unavailable");
    } finally { clearTimeout(timeout); }
  }
}

function fingerprint(value: string): string { return createHash("sha256").update(value).digest("hex"); }
function asRecord(value: unknown): RecordValue { if (!value || typeof value !== "object" || Array.isArray(value)) invalid(); return value as RecordValue; }
function optionalRecord(value: unknown): RecordValue { return value == null ? {} : asRecord(value); }
function profileId(value: unknown): string {
  if (typeof value === "number" && Number.isSafeInteger(value) && value > 0) return String(value);
  if (typeof value === "string" && /^[1-9]\d{0,18}$/.test(value) && BigInt(value) <= 9_223_372_036_854_775_807n) return value;
  invalid();
}
function requiredString(value: unknown, max: number): string { if (typeof value !== "string" || !value || value.length > max) invalid(); return value; }
function numberOrNull(value: unknown, min: number, max: number): number | null {
  if (value == null) return null;
  if (typeof value !== "number" || !Number.isFinite(value) || value < min || value > max) invalid();
  return value;
}
function validTimezone(value: unknown): string {
  const zone = requiredString(value, 64);
  if (zone.toLowerCase() === "gmt") return "UTC";
  try { new Intl.DateTimeFormat("en", { timeZone: zone }).format(); } catch { invalid(); }
  return zone;
}
function gmtTimestamp(value: unknown): string {
  const input = requiredString(value, 64);
  if (!/^\d{4}-\d\d-\d\d[T ]\d\d:\d\d:\d\d(?:\.\d{1,9})?(?:Z)?$/.test(input)) invalid();
  const date = new Date(input.replace(" ", "T").replace(/Z$/, "") + "Z");
  if (!Number.isFinite(date.valueOf()) || date.toISOString().slice(0, 10) !== input.slice(0, 10)) invalid();
  return date.toISOString();
}
function dateInTimezone(value: string, timezone: string): string {
  const parts = new Intl.DateTimeFormat("en", { timeZone: timezone, year: "numeric", month: "2-digit", day: "2-digit" }).formatToParts(new Date(value));
  const part = (type: string) => parts.find((item) => item.type === type)!.value;
  return `${part("year")}-${part("month")}-${part("day")}`;
}
function dateRange(from: string, to: string): string[] {
  const start = Date.parse(`${from}T00:00:00Z`), end = Date.parse(`${to}T00:00:00Z`);
  if (!/^\d{4}-\d\d-\d\d$/.test(from) || !/^\d{4}-\d\d-\d\d$/.test(to) || !Number.isFinite(start) || !Number.isFinite(end) || end < start || (end - start) / dayMs >= 31 || new Date(start).toISOString().slice(0, 10) !== from || new Date(end).toISOString().slice(0, 10) !== to) invalid();
  return Array.from({ length: (end - start) / dayMs + 1 }, (_, index) => new Date(start + index * dayMs).toISOString().slice(0, 10));
}
function invalid(): never { throw new IntegrationProviderError("provider_response_invalid"); }
