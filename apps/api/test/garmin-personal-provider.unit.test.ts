import { describe, expect, it, vi } from "vitest";

import { GarminPersonalProvider } from "../src/integrations/garmin-personal/provider.js";
import { extractOriginalFit } from "../src/integrations/garmin-personal/zip.js";

const key = "synthetic-personal-key";
const oneFit = "UEsDBBQAAAAIAJJUdF3ogR9qDAAAABAAAAAMAAAAYWN0aXZpdHkuZml041NgAAM9N88QEA0AUEsBAhQDFAAAAAgAklR0XeiBH2oMAAAAEAAAAAwAAAAAAAAAAAAAAIABAAAAAGFjdGl2aXR5LmZpdFBLBQYAAAAAAQABADoAAAA2AAAAAAA=";
const noFit = "UEsDBBQAAAAIAJJUdF3BEgfVEgAAABAAAAAKAAAAcmVhZG1lLnR4dMvLV0hMLsksyyypVEjLzEkFAFBLAQIUAxQAAAAIAJJUdF3BEgfVEgAAABAAAAAKAAAAAAAAAAAAAACAAQAAAAByZWFkbWUudHh0UEsFBgAAAAABAAEAOAAAADoAAAAAAA==";
const twoFits = "UEsDBBQAAAAIAJJUdF3ogR9qDAAAABAAAAAMAAAAYWN0aXZpdHkuZml041NgAAM9N88QEA0AUEsDBBQAAAAIAJJUdF3ogR9qDAAAABAAAAAKAAAAc2Vjb25kLmZpdONTYAADPTfPEBANAFBLAQIUAxQAAAAIAJJUdF3ogR9qDAAAABAAAAAMAAAAAAAAAAAAAACAAQAAAABhY3Rpdml0eS5maXRQSwECFAMUAAAACACSVHRd6IEfagwAAAAQAAAACgAAAAAAAAAAAAAAgAE2AAAAc2Vjb25kLmZpdFBLBQYAAAAAAgACAHIAAABqAAAAAAA=";

function token(expiresAt = Math.floor(Date.now() / 1000) + 86_400): string {
  return `header.${Buffer.from(JSON.stringify({ exp: expiresAt })).toString("base64url")}.signature`;
}
function json(data: unknown): Response { return new Response(JSON.stringify(data), { headers: { "content-type": "application/json" } }); }
function fake(overrides: (url: URL, init: RequestInit | undefined) => Response | undefined = () => undefined) {
  return vi.fn(async (input: string | URL | Request, init?: RequestInit) => {
    const url = new URL(String(input));
    const override = overrides(url, init);
    if (override) return override;
    if (url.pathname.endsWith("/token")) return new Response(token());
    if (url.pathname.endsWith("/settings")) return json({ timeZone: "Europe/Moscow" });
    if (url.pathname.endsWith("/dailysummaries")) return json({ data: [] });
    if (url.pathname.endsWith("/search/activities")) return json([]);
    if (url.pathname.endsWith("/dailySleep") || url.pathname.endsWith("/dailyHeartRate")) return new Response(null, { status: 204 });
    throw new Error("Unexpected test request");
  });
}

describe("Garmin Personal API transport", () => {
  it("inspects an empty cutover candidate without inventing an account ID or retaining its token", async () => {
    const request = fake();
    const provider = new GarminPersonalProvider({ fetch: request });
    await expect(provider.inspectCutoverCandidate(key)).resolves.toEqual({ externalUserId: null, activityPresent: false, originalFit: null });
    await provider.inspectCutoverCandidate(key);
    expect(request.mock.calls.filter(([url]) => String(url).endsWith("/token"))).toHaveLength(2);
  });

  it("rejects conflicting candidate owners before downloading a FIT", async () => {
    const request = fake(url => url.pathname.endsWith("/search/activities") ?
      json([{ activityId: 101, ownerId: 41 }, { activityId: 102, ownerId: 42 }]) : undefined);
    await expect(new GarminPersonalProvider({ fetch: request }).inspectCutoverCandidate(key))
      .rejects.toMatchObject({ failureCode: "provider_response_invalid" });
    expect(request.mock.calls.some(([url]) => String(url).includes("/download-service/"))).toBe(false);
  });

  it("stops before the next external read when cutover authority expires", async () => {
    const request = fake();
    let checks = 0;
    const stopped = new Error("Synthetic policy expired");
    const beforeRequest = async () => { if (++checks === 3) throw stopped; };
    await expect(new GarminPersonalProvider({ fetch: request }).reconcile(key, "2026-11-01", "2026-11-01", "scope", { beforeRequest }))
      .rejects.toBe(stopped);
    expect(request).toHaveBeenCalledTimes(2);
  });

  it("pads only activity transport dates while preserving the exact wellness date window", async () => {
    const request = fake();
    await new GarminPersonalProvider({ fetch: request }).reconcile(key, "2026-11-01", "2026-11-01", "scope", {
      activityFromDate: "2026-10-30", activityToDate: "2026-11-03"
    });
    const urls = request.mock.calls.map(([url]) => new URL(String(url)));
    expect(urls.find(url => url.pathname.endsWith("/dailysummaries"))?.searchParams.get("startDate")).toBe("2026-11-01");
    expect(urls.find(url => url.pathname.endsWith("/search/activities"))?.searchParams.get("startDate")).toBe("2026-10-30");
    expect(urls.find(url => url.pathname.endsWith("/search/activities"))?.searchParams.get("endDate")).toBe("2026-11-03");
  });

  it("verifies a key without any activity, health records, identity, or retained token", async () => {
    const request = fake((url) => url.pathname.endsWith("/settings") ? json({}) : undefined);
    const provider = new GarminPersonalProvider({ fetch: request });
    await provider.verifyKey(key);
    await provider.verifyKey(key);
    expect(request.mock.calls.filter(([url]) => String(url).endsWith("/token"))).toHaveLength(2);
    const [url, options] = request.mock.calls[0]!;
    expect(url).toBe("https://personal.connectapi.garmin.com/personalapitoken-service/personal-api/personal-api-key/token");
    expect(options).toMatchObject({ method: "POST", redirect: "error", headers: { authorization: `ApiKey ${key}`, accept: "*/*" } });
  });

  it("accepts an empty account and only caches tokens in the same connection generation", async () => {
    const request = fake((url) => url.pathname.endsWith("/settings") ? json({}) : undefined);
    const provider = new GarminPersonalProvider({ fetch: request });
    await expect(provider.reconcile(key, "2026-11-01", "2026-11-01", "connection:consent-1"))
      .resolves.toEqual({ wellness: [], activities: [], externalUserId: null });
    await provider.reconcile(key, "2026-11-01", "2026-11-01", "connection:consent-1");
    expect(request.mock.calls.filter(([url]) => String(url).endsWith("/token"))).toHaveLength(1);
    await provider.reconcile(key, "2026-11-01", "2026-11-01", "connection:consent-2");
    await provider.reconcile("synthetic-replacement-key", "2026-11-01", "2026-11-01", "connection:consent-2");
    expect(request.mock.calls.filter(([url]) => String(url).endsWith("/token"))).toHaveLength(3);
    provider.forget(key);
    await provider.reconcile(key, "2026-11-01", "2026-11-01", "connection:consent-1");
    expect(request.mock.calls.filter(([url]) => String(url).endsWith("/token"))).toHaveLength(4);
    for (const [url, options] of request.mock.calls) {
      expect(new URL(String(url)).origin).toBe("https://personal.connectapi.garmin.com");
      expect(String(url)).not.toContain(key);
      expect(options?.redirect).toBe("error");
    }
  });

  it("deduplicates concurrent token acquisition and expires memory tokens before reuse", async () => {
    vi.useFakeTimers();
    try {
      const request = fake();
      const provider = new GarminPersonalProvider({ fetch: request });
      await Promise.all([provider.reconcile(key, "2026-11-01", "2026-11-01", "one"), provider.reconcile(key, "2026-11-01", "2026-11-01", "one")]);
      expect(request.mock.calls.filter(([url]) => String(url).endsWith("/token"))).toHaveLength(1);
      vi.setSystemTime(Date.now() + 86_400_000);
      await provider.reconcile(key, "2026-11-01", "2026-11-01", "one");
      expect(request.mock.calls.filter(([url]) => String(url).endsWith("/token"))).toHaveLength(2);
    } finally { vi.useRealTimers(); }
  });

  it("maps documented wellness values without substituting minimum pulse, naps, or seven-day averages", async () => {
    const request = fake((url) => {
      if (url.pathname.endsWith("/dailysummaries")) return json({ data: [{ userProfilePk: 42, calendarDate: "2026-11-01", bodyBattery: { minValue: 18, maxValue: 91, latestValue: 60 }, movement: { steps: { value: 1234 } }, wellnessChronology: { endTimestampGmt: "2026-11-01T10:00:00" }, heartRate: { restingValue: 30 } }] });
      if (url.pathname.endsWith("/dailySleep")) return json({ userProfilePK: 42, calendarDate: "2026-11-01", sleepTimeSeconds: 27_000, napTimeSeconds: 600, sleepScores: { overall: { value: 90 } }, avgHeartRate: 54.5, averageSpO2Value: 97.2, averageRespirationValue: 14.3 });
      if (url.pathname.endsWith("/dailyHeartRate")) return json({ userProfilePK: 42, calendarDate: "2026-11-01", restingHeartRate: 51, minHeartRate: 30, lastSevenDaysAvgRestingHeartRate: 55 });
      return undefined;
    });
    const result = await new GarminPersonalProvider({ fetch: request }).reconcile(key, "2026-11-01", "2026-11-01");
    expect(result.externalUserId).toBe("42");
    expect(result.wellness).toEqual([{
      identity: "2026-11-01", localDate: "2026-11-01", timezone: "Europe/Moscow", updatedAt: "2026-11-01T10:00:00.000Z",
      totalSleepMinutes: 450, sleepScore: null, restingHeartRate: 51, averageSleepingHeartRate: 54.5, hrvRmssd: null,
      oxygenSaturation: 97.2, respirationRate: 14.3, bodyBatteryMinimum: 18, bodyBatteryMaximum: 91, bodyBatteryLatest: 60, steps: 1234
    }]);
  });

  it.each([5, 100, null, undefined])("keeps latest Body Battery independent of extrema and unknown timestamps: %s", async (latestValue) => {
    const request = fake((url) => url.pathname.endsWith("/dailysummaries") ? json({ data: [{
      userProfilePk: 42, calendarDate: "2026-11-01", bodyBattery: { latestValue }
    }] }) : undefined);
    const result = await new GarminPersonalProvider({ fetch: request }).reconcile(key, "2026-11-01", "2026-11-01");
    expect(result.wellness[0]).toMatchObject({ bodyBatteryLatest: latestValue ?? null, bodyBatteryMinimum: null,
      bodyBatteryMaximum: null, updatedAt: null, averageSleepingHeartRate: null, oxygenSaturation: null, respirationRate: null });
  });

  it.each([0, 4, 101, 50.5, "60"])('rejects invalid latest Body Battery instead of substituting extrema: %s', async (latestValue) => {
    const request = fake((url) => url.pathname.endsWith("/dailysummaries") ? json({ data: [{
      userProfilePk: 42, calendarDate: "2026-11-01", bodyBattery: { latestValue, minValue: 18, maxValue: 91 }
    }] }) : undefined);
    await expect(new GarminPersonalProvider({ fetch: request }).reconcile(key, "2026-11-01", "2026-11-01"))
      .rejects.toMatchObject({ failureCode: "provider_response_invalid" });
  });

  it.each([
    { userProfilePK: 41, calendarDate: "2026-11-01", restingHeartRate: 50 },
    { calendarDate: "2026-11-01", restingHeartRate: 50 },
    { userProfilePK: 9_007_199_254_740_992, calendarDate: "2026-11-01", restingHeartRate: 50 },
    { userProfilePK: 42, calendarDate: "2026-10-31", restingHeartRate: 50 },
    { userProfilePK: 42, calendarDate: "2026-11-01", restingHeartRate: 0 }
  ])("rejects account ambiguity, unsafe IDs, wrong dates and invalid measurements", async (heart) => {
    const request = fake((url) => {
      if (url.pathname.endsWith("/dailysummaries")) return json({ data: [{ userProfilePk: 42, calendarDate: "2026-11-01" }] });
      if (url.pathname.endsWith("/dailyHeartRate")) return json(heart);
      return undefined;
    });
    await expect(new GarminPersonalProvider({ fetch: request }).reconcile(key, "2026-11-01", "2026-11-01"))
      .rejects.toMatchObject({ failureCode: "provider_response_invalid" });
  });

  it("reads activity detail timezone and excludes Garmin load with unverified Intervals semantics", async () => {
    const request = fake((url) => {
      if (url.pathname.endsWith("/search/activities")) return json([{ activityId: 101, ownerId: 42 }]);
      if (url.pathname.endsWith("/activity/101")) return json({ activityId: 101, userProfileId: 42, activityName: "Synthetic run", timeZoneUnitDTO: { timeZone: "Europe/Moscow" }, summaryDTO: { startTimeGMT: "2026-11-01T06:00:00.000", startTimeLocal: "2026-11-01T09:00:00.000", duration: 123.45, distance: 10000, averageHR: 145, maxHR: 170, trainingStressScore: 90 } });
      return undefined;
    });
    const result = await new GarminPersonalProvider({ fetch: request }).reconcile(key, "2026-11-01", "2026-11-01");
    expect(result.activities).toEqual([{
      identity: "101", fileType: "fit", occurredAt: "2026-11-01T06:00:00.000Z", localDate: "2026-11-01", timezone: "Europe/Moscow",
      name: "Synthetic run", durationSeconds: 123, distanceMeters: 10000, trainingLoad: null, trainingLoadBasis: null,
      trainingLoadBasisVersion: null, averageHeartRate: 145, maximumHeartRate: 170, deviceName: null, garminAttributed: false
    }]);
  });

  it("continues a full activity page and never returns a silently truncated page set", async () => {
    const request = fake((url) => {
      if (url.pathname.endsWith("/search/activities")) {
        return json(url.searchParams.get("start") === "0" ? Array.from({ length: 99 }, (_, index) => ({ activityId: index + 1, ownerId: 42 })) : []);
      }
      const id = url.pathname.match(/\/activity\/(\d+)$/)?.[1];
      if (id) return json({ activityId: Number(id), userProfileId: 42, activityName: "Synthetic run", timeZoneUnitDTO: { timeZone: "UTC" }, summaryDTO: { startTimeGMT: "2026-11-01T06:00:00.000", startTimeLocal: "2026-11-01T06:00:00.000", duration: 3600 } });
      return undefined;
    });
    const result = await new GarminPersonalProvider({ fetch: request }).reconcile(key, "2026-11-01", "2026-11-01");
    expect(result.activities).toHaveLength(99);
    expect(request.mock.calls.filter(([url]) => String(url).includes("search/activities")).map(([url]) => new URL(String(url)).searchParams.get("start"))).toEqual(["0", "99"]);

    const duplicatePages = fake((url) => {
      if (url.pathname.endsWith("/search/activities")) return json(Array.from({ length: 99 }, (_, index) => ({ activityId: index + 1, ownerId: 42 })));
      const id = url.pathname.match(/\/activity\/(\d+)$/)?.[1];
      if (id) return json({ activityId: Number(id), userProfileId: 42, activityName: "Synthetic run", timeZoneUnitDTO: { timeZone: "UTC" }, summaryDTO: { startTimeGMT: "2026-11-01T06:00:00.000", startTimeLocal: "2026-11-01T06:00:00.000", duration: 3600 } });
      return undefined;
    });
    await expect(new GarminPersonalProvider({ fetch: duplicatePages }).reconcile(key, "2026-11-01", "2026-11-01"))
      .rejects.toMatchObject({ failureCode: "provider_response_invalid" });
  });

  it("invalidates a revoked bearer so the next sync can obtain a new token", async () => {
    let denyProfile = false;
    const request = fake((url) => url.pathname.endsWith("/settings") && denyProfile ? new Response("private", { status: 401 }) : undefined);
    const provider = new GarminPersonalProvider({ fetch: request });
    await provider.reconcile(key, "2026-11-01", "2026-11-01", "same");
    denyProfile = true;
    await expect(provider.reconcile(key, "2026-11-01", "2026-11-01", "same")).rejects.toMatchObject({ failureCode: "authorization_required" });
    denyProfile = false;
    await provider.reconcile(key, "2026-11-01", "2026-11-01", "same");
    expect(request.mock.calls.filter(([url]) => String(url).endsWith("/token"))).toHaveLength(2);
  });

  it("does not repopulate a forgotten generation after an in-flight token request resolves", async () => {
    let resolve: (value: Response) => void = () => {};
    let started: () => void = () => {};
    const tokenStarted = new Promise<void>((done) => { started = done; });
    let first = true;
    const request = fake();
    const normal = request.getMockImplementation()!;
    request.mockImplementation((url, options) => {
      if (String(url).endsWith("/token") && first) {
        first = false;
        return new Promise<Response>((done) => { resolve = done; started(); });
      }
      return normal(url, options);
    });
    const provider = new GarminPersonalProvider({ fetch: request });
    const pending = provider.reconcile(key, "2026-11-01", "2026-11-01", "same");
    await tokenStarted;
    provider.forget(key);
    resolve(new Response(token()));
    await pending;
    await provider.reconcile(key, "2026-11-01", "2026-11-01", "same");
    expect(request.mock.calls.filter(([url]) => String(url).endsWith("/token"))).toHaveLength(2);
  });

  it("bounds a reconciliation pass rather than extending its worker lease indefinitely", async () => {
    vi.useFakeTimers();
    try {
      const request = fake((url) => {
        if (url.pathname.endsWith("/settings")) {
          vi.setSystemTime(Date.now() + 46_000);
          return json({ timeZone: "UTC" });
        }
        return undefined;
      });
      await expect(new GarminPersonalProvider({ fetch: request }).reconcile(key, "2026-11-01", "2026-11-01"))
        .rejects.toMatchObject({ failureCode: "provider_timeout" });
      expect(request).toHaveBeenCalledTimes(2);
    } finally { vi.useRealTimers(); }
  });

  it("retires cached consent scopes permanently while leaving a replacement generation usable", async () => {
    const request = fake();
    const provider = new GarminPersonalProvider({ fetch: request });
    await provider.reconcile(key, "2026-11-01", "2026-11-01", "connection:old");
    provider.invalidateScope("connection:old");
    const count = request.mock.calls.length;
    await expect(provider.reconcile(key, "2026-11-01", "2026-11-01", "connection:old")).rejects.toMatchObject({ failureCode: "authorization_required" });
    await expect(provider.originalActivityFile(key, "101", "connection:old")).rejects.toMatchObject({ failureCode: "authorization_required" });
    expect(request).toHaveBeenCalledTimes(count);
    await expect(provider.reconcile(key, "2026-11-01", "2026-11-01", "connection:new")).resolves.toMatchObject({ externalUserId: null });
  });

  it("rejects an in-flight retired generation before reading data or repopulating its cache", async () => {
    let resolve: (value: Response) => void = () => {};
    let started: () => void = () => {};
    const tokenStarted = new Promise<void>((done) => { started = done; });
    const request = fake();
    const normal = request.getMockImplementation()!;
    request.mockImplementation((url, options) => String(url).endsWith("/token")
      ? new Promise<Response>((done) => { resolve = done; started(); })
      : normal(url, options));
    const provider = new GarminPersonalProvider({ fetch: request });
    const pending = provider.reconcile(key, "2026-11-01", "2026-11-01", "retired");
    const outcome = expect(pending).rejects.toMatchObject({ failureCode: "authorization_required" });
    await tokenStarted;
    provider.invalidateScope("retired");
    resolve(new Response(token()));
    await outcome;
    await expect(provider.reconcile(key, "2026-11-01", "2026-11-01", "retired")).rejects.toMatchObject({ failureCode: "authorization_required" });
    expect(request).toHaveBeenCalledTimes(1);
  });

  it("fails closed if its bounded scope-revocation registry is exhausted", async () => {
    const request = fake();
    const provider = new GarminPersonalProvider({ fetch: request });
    for (let index = 0; index <= 10_000; index++) provider.invalidateScope(`synthetic:${index}`);
    await expect(provider.reconcile(key, "2026-11-01", "2026-11-01", "new")).rejects.toMatchObject({ failureCode: "authorization_required" });
    expect(request).not.toHaveBeenCalled();
  });

  it.each([[401, "authorization_required"], [403, "authorization_required"], [429, "provider_rate_limited"], [500, "provider_unavailable"]])("sanitizes provider failure %s", async (status, failureCode) => {
    const request = fake(() => new Response(`private error contains ${key}`, { status: status as number }));
    const error: unknown = await new GarminPersonalProvider({ fetch: request }).verifyKey(key).catch((value: unknown) => value);
    expect(error).toMatchObject({ failureCode });
    expect(JSON.stringify(error)).not.toContain(key);
    expect(String(error)).not.toContain("private error");
  });

  it("rejects malformed token, oversized streamed JSON, and invalid range without unbounded work", async () => {
    await expect(new GarminPersonalProvider({ fetch: fake((url) => url.pathname.endsWith("/token") ? json({ access_token: "not-the-contract" }) : undefined) }).verifyKey(key))
      .rejects.toMatchObject({ failureCode: "provider_response_invalid" });
    const oversized = new GarminPersonalProvider({ fetch: fake((url) => url.pathname.endsWith("/settings") ? new Response(" ".repeat(2_000_001)) : undefined) });
    await expect(oversized.verifyKey(key)).rejects.toMatchObject({ failureCode: "provider_response_invalid" });
    const request = fake();
    await expect(new GarminPersonalProvider({ fetch: request }).reconcile(key, "2026-02-30", "2026-03-01")).rejects.toMatchObject({ failureCode: "provider_response_invalid" });
    await expect(new GarminPersonalProvider({ fetch: request }).reconcile(key, "2026-01-01", "2026-03-01")).rejects.toMatchObject({ failureCode: "provider_response_invalid" });
    expect(request).not.toHaveBeenCalled();
  });

  it("downloads original ZIP bytes with a binary Accept header and never follows redirects", async () => {
    const request = fake((url) => url.pathname.endsWith("/files/activity/101") ? new Response(Buffer.from(oneFit, "base64")) : undefined);
    const result = await new GarminPersonalProvider({ fetch: request }).originalActivityFile(key, "101", "connection:generation");
    expect(Buffer.from(result!).subarray(8, 12).toString()).toBe(".FIT");
    expect(request.mock.calls.at(-1)?.[1]).toMatchObject({ redirect: "error", headers: { accept: "application/zip, application/x-zip-compressed, application/octet-stream" } });
  });
});

describe("bounded original FIT ZIP parsing", () => {
  it("extracts an independently generated deflated FIT and distinguishes a valid ZIP without FIT", () => {
    expect(extractOriginalFit(Buffer.from(oneFit, "base64"))).toHaveLength(16);
    expect(extractOriginalFit(Buffer.from(noFit, "base64"))).toBeNull();
  });

  it("rejects multiple FIT entries, corrupt bytes, and inflated size declarations before extraction", () => {
    expect(() => extractOriginalFit(Buffer.from(twoFits, "base64"))).toThrow();
    const corrupt = Buffer.from(oneFit, "base64");
    corrupt[43] = corrupt[43]! ^ 1;
    expect(() => extractOriginalFit(corrupt)).toThrow();
    const bomb = Buffer.from(oneFit, "base64");
    const central = bomb.indexOf(Buffer.from([0x50, 0x4b, 0x01, 0x02]));
    bomb.writeUInt32LE(2_000_001, central + 24);
    expect(() => extractOriginalFit(bomb)).toThrowError(expect.objectContaining({ issue: "limit_exceeded" }));
    expect(() => extractOriginalFit(new Uint8Array(2_000_001))).toThrowError(expect.objectContaining({ issue: "limit_exceeded" }));
  });
});
