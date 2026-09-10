import { randomBytes } from "node:crypto";
import { describe, expect, it, vi } from "vitest";

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
      restingHR: 51, hrv: 63, bodyBattery: 77, ignoredProviderField: "ignored"
    });
    const activity = normalizeIntervalsActivity({
      id: "i123", name: "Morning Run", start_date: "2026-09-07T06:00:00Z",
      start_date_local: "2026-09-07T09:00:00", elapsed_time: 3_600,
      moving_time: 3_300, distance: 10_100, icu_training_load: 85,
      average_heartrate: 146, max_heartrate: 177, device_name: "Garmin Forerunner 965"
    });

    expect(wellness).toMatchObject({ totalSleepMinutes: 450, hrvRmssd: 63, timezone: "UTC" });
    expect(activity).toMatchObject({ durationSeconds: 3_300, garminAttributed: true, localDate: "2026-09-07" });
    expect(normalizedChecksum(wellness)).toBe(normalizedChecksum({ ...wellness }));
  });

  it("rejects malformed provider records without retaining their raw body", () => {
    expect(() => normalizeIntervalsWellness({ id: "not-a-date", hrv: "secret" })).toThrowError(
      expect.objectContaining({ failureCode: "provider_response_invalid" })
    );
    expect(() => normalizeIntervalsActivity({ id: "a" })).toThrow(IntegrationProviderError);
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
});
