import { randomBytes } from "node:crypto";
import { describe, expect, it, vi } from "vitest";
import type { FastifyInstance } from "fastify";

import {
  ConnectionCredentialCipher,
  parseIntegrationKeyRing
} from "../src/integrations/credential-cipher.js";
import { FakeHealthDataProvider } from "../src/integrations/fake-provider.js";
import {
  normalizeIntervalsActivity,
  normalizeIntervalsWellness,
  normalizedChecksum
} from "../src/integrations/intervals-icu/normalizer.js";
import { IntervalsIcuProvider } from "../src/integrations/intervals-icu/provider.js";
import { registerIntegrationCallback } from "../src/integrations/integration.controller.js";
import { IntegrationProviderError } from "../src/integrations/provider.js";
import { IntegrationService } from "../src/integrations/integration.service.js";
import type { IntegrationStore } from "../src/integrations/integration-store.js";
import type { RecoveryStore } from "../src/storage/recovery-repository.js";
import type { TrainingStore } from "../src/storage/training-repository.js";
import { SyntheticPersonContext } from "../src/application/person-context.js";

describe("Garmin via Intervals.icu integration contracts", () => {
  it("encrypts a Person token with authenticated connection binding", () => {
    const key = randomBytes(32).toString("base64");
    const keys = parseIntegrationKeyRing(`v1:${key}`);
    const cipher = new ConnectionCredentialCipher("v1", keys);
    const encrypted = cipher.encrypt("private-access-token", "intervals_icu:person-a:connection-a");

    expect(encrypted.ciphertext).not.toContain("private-access-token");
    expect(cipher.decrypt(encrypted, "intervals_icu:person-a:connection-a")).toBe("private-access-token");
    expect(() => cipher.decrypt(encrypted, "intervals_icu:person-b:connection-a")).toThrow();
  });

  it("normalizes only the supported typed wellness and activity surface", () => {
    const wellness = normalizeIntervalsWellness({
      id: "2026-09-07", sleepSecs: 27_000, sleepScore: 84,
      restingHR: 51, avgSleepingHR: 48, hrv: 63, spO2: 96.5,
      respiration: 15.2, BodyBatteryMin: 18, BodyBatteryMax: 91,
      updated: "2026-09-07T14:30:00Z", steps: 12_345,
      bodyBattery: 77, ignoredProviderField: "ignored"
    });
    const activity = normalizeIntervalsActivity({
      id: "i123", name: "Morning Run", start_date: "2026-09-07T06:00:00Z",
      start_date_local: "2026-09-07T09:00:00", elapsed_time: 3_600,
      moving_time: 3_300, distance: 10_100, icu_training_load: 85,
      average_heartrate: 146, max_heartrate: 177, device_name: "Garmin Forerunner 965"
    });

    expect(wellness).toEqual({
      identity: "2026-09-07",
      localDate: "2026-09-07",
      timezone: "UTC",
      updatedAt: "2026-09-07T14:30:00.000Z",
      totalSleepMinutes: 450,
      sleepScore: 84,
      restingHeartRate: 51,
      averageSleepingHeartRate: 48,
      hrvRmssd: 63,
      oxygenSaturation: 96.5,
      respirationRate: 15.2,
      bodyBatteryMinimum: 18,
      bodyBatteryMaximum: 91,
      steps: 12_345
    });
    expect(activity).toMatchObject({ durationSeconds: 3_300, garminAttributed: true, localDate: "2026-09-07" });
    expect(normalizedChecksum(wellness)).toBe(normalizedChecksum({ ...wellness }));
  });

  it("rejects malformed provider records without retaining their raw body", () => {
    expect(() => normalizeIntervalsWellness({ id: "not-a-date", hrv: "secret" })).toThrowError(
      expect.objectContaining({ failureCode: "provider_response_invalid" })
    );
    expect(() => normalizeIntervalsActivity({ id: "a" })).toThrow(IntegrationProviderError);
  });

  it.each([
    { id: "2026-09-07", avgSleepingHR: 301 },
    { id: "2026-09-07", spO2: 101 },
    { id: "2026-09-07", respiration: -1 },
    { id: "2026-09-07", BodyBatteryMin: "18" },
    { id: "2026-09-07", BodyBatteryMax: 101 },
    { id: "2026-09-07", BodyBatteryMin: 91, BodyBatteryMax: 18 },
    { id: "2026-09-07", steps: 1.5 },
    { id: "2026-09-07", updated: "not-a-time" }
  ])("rejects an invalid typed wellness value without exposing transport data", (record) => {
    expect(() => normalizeIntervalsWellness(record)).toThrowError(
      expect.objectContaining({ failureCode: "provider_response_invalid" })
    );
  });

  it("constructs the allowlisted minimal OAuth request", () => {
    const provider = new IntervalsIcuProvider({
      clientId: "shape-test", clientSecret: "not-a-real-secret-value",
      redirectUri: "https://shape.example/api/integrations/intervals-icu/callback",
      fetch: vi.fn()
    });
    const url = new URL(provider.authorizationUrl("one-use-state"));
    expect(url.origin + url.pathname).toBe("https://intervals.icu/oauth/authorize");
    expect(url.searchParams.get("scope")).toBe("ACTIVITY:READ,WELLNESS:READ");
    expect(url.searchParams.get("state")).toBe("one-use-state");
  });

  it("exchanges a code using the documented form and nested athlete identity", async () => {
    const request = vi.fn().mockResolvedValue(new Response(JSON.stringify({
      token_type: "Bearer",
      access_token: "documented-access-token",
      scope: "ACTIVITY:READ,WELLNESS:READ",
      athlete: { id: "i705019", name: "Test Athlete" }
    }), { status: 200 }));
    const provider = new IntervalsIcuProvider({
      clientId: "shape-test",
      clientSecret: "not-a-real-secret-value",
      redirectUri: "https://shape.example/api/integrations/intervals-icu/callback",
      fetch: request
    });

    await expect(provider.exchangeAuthorizationCode("one-use-code")).resolves.toEqual({
      accessToken: "documented-access-token",
      externalUserId: "i705019"
    });
    const [url, init] = request.mock.calls[0] as [string, RequestInit];
    expect(url).toBe("https://intervals.icu/api/oauth/token");
    expect(init.method).toBe("POST");
    expect(Object.fromEntries((init.body as URLSearchParams).entries())).toEqual({
      client_id: "shape-test",
      client_secret: "not-a-real-secret-value",
      code: "one-use-code"
    });
  });

  it("reconciles wellness and activities through the documented date-range endpoints", async () => {
    const request = vi.fn()
      .mockResolvedValueOnce(new Response("[]", { status: 200 }))
      .mockResolvedValueOnce(new Response("[]", { status: 200 }));
    const provider = new IntervalsIcuProvider({
      clientId: "shape-test",
      clientSecret: "not-a-real-secret-value",
      redirectUri: "https://shape.example/api/integrations/intervals-icu/callback",
      fetch: request
    });

    await expect(provider.reconcile("opaque-test-token", "2026-09-01", "2026-09-11")).resolves.toEqual({
      wellness: [],
      activities: []
    });

    expect(request).toHaveBeenCalledTimes(2);
    const [wellnessUrl, wellnessInit] = request.mock.calls[0] as [string, RequestInit];
    const parsedWellnessUrl = new URL(wellnessUrl);
    expect(parsedWellnessUrl.origin + parsedWellnessUrl.pathname).toBe(
      "https://intervals.icu/api/v1/athlete/0/wellness"
    );
    expect(parsedWellnessUrl.searchParams.get("oldest")).toBe("2026-09-01");
    expect(parsedWellnessUrl.searchParams.get("newest")).toBe("2026-09-11");
    expect(parsedWellnessUrl.searchParams.get("fields")).toBe(
      "id,updated,sleepSecs,sleepScore,restingHR,avgSleepingHR,hrv,spO2,respiration,BodyBatteryMin,BodyBatteryMax,steps"
    );
    expect(parsedWellnessUrl.searchParams.has("access_token")).toBe(false);
    expect(wellnessInit.headers).toEqual(expect.objectContaining({ authorization: "Bearer opaque-test-token" }));
    expect(request).toHaveBeenCalledWith(
      "https://intervals.icu/api/v1/athlete/0/activities?oldest=2026-09-01&newest=2026-09-11",
      expect.objectContaining({
        headers: expect.objectContaining({ authorization: "Bearer opaque-test-token" })
      })
    );
  });

  it("revokes access through the documented disconnect endpoint", async () => {
    const request = vi.fn().mockResolvedValue(new Response(null, { status: 204 }));
    const provider = new IntervalsIcuProvider({
      clientId: "shape-test",
      clientSecret: "not-a-real-secret-value",
      redirectUri: "https://shape.example/api/integrations/intervals-icu/callback",
      fetch: request
    });

    await provider.disconnect("opaque-test-token");

    expect(request).toHaveBeenCalledWith(
      "https://intervals.icu/api/v1/disconnect-app",
      expect.objectContaining({
        method: "DELETE",
        headers: expect.objectContaining({ authorization: "Bearer opaque-test-token" })
      })
    );
  });

  it("logs only a bounded callback failure category before redirecting", async () => {
    type CallbackHandler = (
      request: { readonly query: Record<string, unknown> },
      reply: { readonly header: ReturnType<typeof vi.fn>; readonly redirect: ReturnType<typeof vi.fn> }
    ) => Promise<void>;
    let callback: CallbackHandler | null = null;
    const warn = vi.fn();
    const fastify = {
      log: { warn },
      get: (_path: string, _options: unknown, handler: CallbackHandler) => { callback = handler; }
    } as unknown as FastifyInstance;
    const providerDiagnostic = {
      operation: "oauth_token_exchange" as const,
      httpStatus: 400,
      headers: { "content-type": "application/json", "x-request-id": "intervals-request-123" },
      responseBody: '{"error":"invalid_client"}',
      responseBodyTruncated: false
    };
    const service = {
      completeAuthorization: vi.fn().mockRejectedValue(
        new IntegrationProviderError("provider_response_invalid", undefined, providerDiagnostic)
      )
    } as unknown as IntegrationService;
    const reply = { header: vi.fn(), redirect: vi.fn() };

    registerIntegrationCallback(fastify, service);
    await callback!({ query: { state: "private-state", code: "private-code" } }, reply);

    expect(warn).toHaveBeenCalledWith(
      { failureCode: "provider_response_invalid", providerDiagnostic },
      "Intervals.icu authorization callback failed"
    );
    expect(JSON.stringify(warn.mock.calls)).not.toContain("private-state");
    expect(JSON.stringify(warn.mock.calls)).not.toContain("private-code");
    expect(reply.redirect).toHaveBeenCalledWith("/connections?provider=authorization_failed");
  });

  it.each([
    ["provider_rate_limited"], ["provider_timeout"], ["provider_unavailable"],
    ["provider_response_invalid"], ["authorization_required"]
  ] as const)("supports deterministic fake failure %s", async (failure) => {
    const provider = new FakeHealthDataProvider();
    provider.nextFailure = failure;
    await expect(provider.reconcile()).rejects.toMatchObject({ failureCode: failure });
  });

  it("covers provider denial and token revocation without a real account", async () => {
    const provider = new FakeHealthDataProvider();
    await expect(provider.exchangeAuthorizationCode("denied")).rejects.toMatchObject({ failureCode: "authorization_required" });
    await provider.disconnect("opaque-test-token");
    expect(provider.disconnectedTokens).toEqual(["opaque-test-token"]);
  });

  it("classifies HTTP rate limits and malformed token responses", async () => {
    const rateLimited = new IntervalsIcuProvider({
      clientId: "shape-test", clientSecret: "not-a-real-secret-value", redirectUri: "https://shape.example/callback",
      fetch: vi.fn().mockResolvedValue(new Response("{}", { status: 429 }))
    });
    await expect(rateLimited.exchangeAuthorizationCode("code")).rejects.toMatchObject({ failureCode: "provider_rate_limited" });

    const malformed = new IntervalsIcuProvider({
      clientId: "shape-test", clientSecret: "not-a-real-secret-value", redirectUri: "https://shape.example/callback",
      fetch: vi.fn().mockResolvedValue(new Response("{}", { status: 200 }))
    });
    await expect(malformed.exchangeAuthorizationCode("code")).rejects.toMatchObject({ failureCode: "provider_response_invalid" });

    const oversized = new IntervalsIcuProvider({
      clientId: "shape-test", clientSecret: "not-a-real-secret-value", redirectUri: "https://shape.example/callback",
      fetch: vi.fn().mockResolvedValue(new Response("{}", { status: 200, headers: { "content-length": "2000001" } }))
    });
    await expect(oversized.exchangeAuthorizationCode("code")).rejects.toMatchObject({ failureCode: "provider_response_invalid" });
  });

  it("logs bounded redacted token-exchange evidence without credentials or authorization code", async () => {
    const clientId = "shape-sensitive-client-id";
    const clientSecret = "sensitive-client-secret-value";
    const authorizationCode = "sensitive-one-use-authorization-code";
    const responseBody = JSON.stringify({
      error: "invalid_client",
      error_description: `client ${clientId} rejected secret ${clientSecret}`,
      code: authorizationCode,
      access_token: "provider-returned-sensitive-token",
      unknown_token: "1234567890abcdefghijklmnopqrstuvwxyz",
      contact: "athlete@example.test"
    });
    const provider = new IntervalsIcuProvider({
      clientId,
      clientSecret,
      redirectUri: "https://shape.example/callback",
      fetch: vi.fn().mockResolvedValue(new Response(responseBody, {
        status: 400,
        headers: {
          "content-type": "application/json",
          "x-request-id": "intervals-request-123"
        }
      }))
    });

    const error = await provider.exchangeAuthorizationCode(authorizationCode).catch((caught: unknown) => caught);

    expect(error).toBeInstanceOf(IntegrationProviderError);
    expect(error).toMatchObject({
      failureCode: "provider_unavailable",
      diagnostic: {
        operation: "oauth_token_exchange",
        httpStatus: 400,
        headers: {
          "content-type": "application/json",
          "x-request-id": "intervals-request-123"
        },
        responseBodyTruncated: false
      }
    });
    const serialized = JSON.stringify((error as IntegrationProviderError).diagnostic);
    expect(serialized).toContain("invalid_client");
    expect(serialized).not.toContain(clientId);
    expect(serialized).not.toContain(clientSecret);
    expect(serialized).not.toContain(authorizationCode);
    expect(serialized).not.toContain("provider-returned-sensitive-token");
    expect(serialized).not.toContain("1234567890abcdefghijklmnopqrstuvwxyz");
    expect(serialized).not.toContain("athlete@example.test");
  });

  it("bounds oversized token-exchange diagnostics before logging", async () => {
    const provider = new IntervalsIcuProvider({
      clientId: "shape-test",
      clientSecret: "not-a-real-secret-value",
      redirectUri: "https://shape.example/callback",
      fetch: vi.fn().mockResolvedValue(new Response("x".repeat(5_000), { status: 502 }))
    });

    const error = await provider.exchangeAuthorizationCode("one-use-code").catch((caught: unknown) => caught);
    const diagnostic = (error as IntegrationProviderError).diagnostic;

    expect(diagnostic?.responseBody.length).toBeLessThanOrEqual(4_096);
    expect(diagnostic?.responseBody).toBe("[redacted-token]");
    expect(diagnostic?.responseBodyTruncated).toBe(true);
  });

  it("binds OAuth state to one Person and consumes it only once", async () => {
    let pending: { hash: string; personId: string; returnTo: string; expiresAt: Date } | null = null;
    let activated: Parameters<IntegrationStore["activate"]>[0] | null = null;
    const store = {
      createAuthorization: async (personId: string, hash: string, returnTo: string, expiresAt: Date) => { pending = { hash, personId, returnTo, expiresAt }; },
      consumeAuthorization: async (hash: string, now: Date) => {
        const current = pending;
        pending = null;
        return current && current.hash === hash && current.expiresAt >= now
          ? { personId: current.personId, returnTo: current.returnTo, createdAt: new Date() }
          : null;
      },
      authorizationIdentity: async () => null,
      activate: async (input: Parameters<IntegrationStore["activate"]>[0]) => { activated = input; }
    } as unknown as IntegrationStore;
    const provider = new FakeHealthDataProvider();
    const cipher = new ConnectionCredentialCipher("v1", new Map([["v1", randomBytes(32)]]));
    const service = new IntegrationService(
      new SyntheticPersonContext("00000000-0000-4000-8000-000000000101"),
      store,
      provider,
      cipher,
      {} as RecoveryStore,
      {} as TrainingStore
    );

    const started = await service.start({ returnTo: "/connections" });
    const state = new URL(started.authorizationUrl).searchParams.get("state")!;
    expect(pending).not.toBeNull();
    expect(JSON.stringify(pending)).not.toContain(state);
    await expect(service.completeAuthorization(state, "approved")).resolves.toBe("/connections");
    expect(activated).not.toBeNull();
    expect(JSON.stringify(activated)).not.toContain("fake-token-approved");
    await expect(service.completeAuthorization(state, "replay")).rejects.toMatchObject({ failureCode: "authorization_required" });

    const denied = await service.start({ returnTo: "/connections" });
    const deniedState = new URL(denied.authorizationUrl).searchParams.get("state")!;
    await expect(service.denyAuthorization(deniedState)).resolves.toBeUndefined();
    await expect(service.denyAuthorization(deniedState)).rejects.toMatchObject({ failureCode: "authorization_required" });
  });

  it("runs history only after explicit state and keeps its failure separate from live sync", async () => {
    const personId = "00000000-0000-4000-8000-000000000201";
    const connectionId = "00000000-0000-4000-8000-000000000202";
    const cipher = new ConnectionCredentialCipher("v1", new Map([["v1", randomBytes(32)]]));
    const credential = cipher.encrypt("history-token", `intervals_icu:${personId}:${connectionId}`);
    const markSyncSucceeded = vi.fn();
    const markSyncFailed = vi.fn();
    const markHistoricalImportFailed = vi.fn();
    const markHistoricalWindowSucceeded = vi.fn();
    const releaseClaim = vi.fn();
    const claimHistoricalWindow = vi.fn(async (
      _id: string,
      _consentId: string,
      cursorBefore: string | null,
      claimToken: string
    ): Promise<{ claimToken: string; cursorBefore: string | null } | null> => ({
      claimToken,
      cursorBefore
    }));
    const store = {
      markSyncSucceeded,
      markSyncFailed,
      markHistoricalImportFailed,
      markHistoricalWindowSucceeded,
      claimHistoricalWindow,
      releaseClaim
    } as unknown as IntegrationStore;
    const reconcile = vi.fn()
      .mockResolvedValueOnce({ wellness: [], activities: [] })
      .mockRejectedValueOnce(new IntegrationProviderError("provider_timeout"));
    const provider = {
      reconcile
    } as unknown as FakeHealthDataProvider;
    const reconcileRecentActivityLinks = vi.fn(async () => {});
    const service = new IntegrationService(
      new SyntheticPersonContext(personId), store, provider, cipher,
      {} as RecoveryStore,
      { reconcileRecentActivityLinks } as unknown as TrainingStore
    );
    const base = {
      id: connectionId,
      personId,
      recoveryConnectionId: "00000000-0000-4000-8000-000000000203",
      consentId: "00000000-0000-4000-8000-000000000204",
      credential,
      historicalCursorBefore: null,
      historicalNextAttemptAt: new Date(0)
    } as const;

    await service.reconcileConnection({ ...base, historicalImportStatus: "running" });

    expect(reconcile).toHaveBeenCalledTimes(2);
    const [, historicalOldest, historicalNewest] = reconcile.mock.calls[1]!;
    expect(historicalNewest < reconcile.mock.calls[0]![1]).toBe(true);
    expect((Date.parse(`${historicalNewest}T00:00:00.000Z`) - Date.parse(`${historicalOldest}T00:00:00.000Z`)) / 86_400_000 + 1).toBeLessThanOrEqual(180);
    expect(markSyncSucceeded).toHaveBeenCalledOnce();
    expect(reconcileRecentActivityLinks).toHaveBeenCalledOnce();
    expect(markHistoricalImportFailed).toHaveBeenCalledWith(connectionId, expect.any(String), "provider_timeout", true);
    expect(markSyncFailed).not.toHaveBeenCalled();
    expect(releaseClaim).toHaveBeenCalledWith(connectionId);

    reconcile.mockClear();
    reconcile.mockResolvedValue({ wellness: [], activities: [] });
    await service.reconcileConnection({ ...base, historicalImportStatus: "not_requested" });
    expect(reconcile).toHaveBeenCalledTimes(1);
    expect(claimHistoricalWindow).toHaveBeenCalledTimes(1);

    reconcile.mockClear();
    claimHistoricalWindow.mockResolvedValueOnce(null);
    await service.reconcileConnection({ ...base, historicalImportStatus: "running" });
    expect(reconcile).toHaveBeenCalledTimes(1);

    reconcile.mockClear();
    await service.reconcileConnection({
      ...base,
      historicalImportStatus: "running",
      historicalCursorBefore: "2000-01-02"
    });
    expect(markHistoricalWindowSucceeded).toHaveBeenCalledWith(connectionId, expect.any(String), "2000-01-01", true);
  });
});
