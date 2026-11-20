import { randomBytes, randomUUID } from "node:crypto";
import { afterEach, describe, expect, it, vi } from "vitest";

import { SyntheticPersonContext } from "../src/application/person-context.js";
import { ConnectionCredentialCipher } from "../src/integrations/credential-cipher.js";
import { IntegrationService } from "../src/integrations/integration.service.js";
import type { ActiveIntegrationConnection, IntegrationImportPolicy, IntegrationStore } from "../src/integrations/integration-store.js";
import type { HealthDataReader, ProviderActivityRecord, ProviderReconciliation, ProviderWellnessRecord } from "../src/integrations/provider.js";
import type { RecoveryStore } from "../src/storage/recovery-repository.js";
import type { TrainingStore } from "../src/storage/training-repository.js";

const startsOn = "2026-11-21";
const startsAt = new Date("2026-11-20T21:00:00.000Z");

afterEach(() => vi.useRealTimers());

function policy(role: "source" | "target", overrides: Partial<IntegrationImportPolicy> = {}): IntegrationImportPolicy {
  return {
    role, state: "draining", startsOn, startsAt, timezone: "Europe/Moscow",
    sourceDrainsUntil: new Date("2026-12-04T21:00:00.000Z"),
    version: 2, requestAllowed: true,
    historyScopeFromDate: role === "target" ? startsOn : "2000-01-01",
    ...overrides
  };
}

function wellness(localDate: string): ProviderWellnessRecord {
  return {
    identity: localDate, localDate, timezone: "Europe/Moscow",
    totalSleepMinutes: null, sleepScore: null, restingHeartRate: 53,
    averageSleepingHeartRate: null, hrvRmssd: null, oxygenSaturation: null,
    respirationRate: null, bodyBatteryMinimum: null, bodyBatteryMaximum: null
  };
}

function activity(identity: string, occurredAt: string, localDate: string): ProviderActivityRecord {
  return {
    identity, occurredAt, localDate, timezone: "Europe/Moscow", name: "Synthetic run",
    durationSeconds: 1800, distanceMeters: 3000, trainingLoad: null,
    trainingLoadBasis: null, trainingLoadBasisVersion: null,
    averageHeartRate: null, maximumHeartRate: null, deviceName: null, garminAttributed: false
  };
}

function harness(importPolicy: IntegrationImportPolicy, result: ProviderReconciliation = { wellness: [], activities: [] }) {
  const personId = randomUUID();
  const connectionId = randomUUID();
  const providerKey = importPolicy.role === "source" ? "intervals_icu" : "garmin_personal";
  const cipher = new ConnectionCredentialCipher("v1", new Map([["v1", randomBytes(32)]]));
  const connection: ActiveIntegrationConnection = {
    id: connectionId, personId, recoveryConnectionId: randomUUID(), consentId: randomUUID(),
    credential: cipher.encrypt("synthetic-import-credential", `${providerKey}:${personId}:${connectionId}`),
    historicalImportStatus: "not_requested", historicalCursorBefore: null,
    historicalNextAttemptAt: null, historicalScopeFromDate: importPolicy.historyScopeFromDate
  };
  const decrypt = vi.spyOn(cipher, "decrypt");
  const mocks = {
    importPolicy: vi.fn(async () => importPolicy),
    assertReadAllowed: vi.fn(async () => true),
    markSyncSucceeded: vi.fn(async () => {}),
    markSyncPartial: vi.fn(async () => {}),
    markSyncFailed: vi.fn(async () => {}),
    releaseClaim: vi.fn(async () => {}),
    claimHistoricalWindow: vi.fn(async (_id: string, _consentId: string, cursorBefore: string | null, claimToken: string) => ({ claimToken, cursorBefore })),
    markHistoricalWindowSucceeded: vi.fn(async () => true),
    deferHistoricalWindow: vi.fn(async () => true),
    markHistoricalImportFailed: vi.fn(async () => true),
    recordInbox: vi.fn<IntegrationStore["recordInbox"]>(async () => ({ state: "process" as const, receiptId: randomUUID() })),
    completeInbox: vi.fn(async () => true),
    recoveryFact: vi.fn(async () => null),
    linkRecoveryFact: vi.fn(async () => true)
  };
  const networkRequest = vi.fn(async () => result);
  const reconcile = vi.fn<HealthDataReader["reconcile"]>(async (_credential, _from, _until, _scope, options) => {
    await options?.beforeRequest?.();
    return networkRequest();
  });
  const originalActivityFile = vi.fn<HealthDataReader["originalActivityFile"]>(async () => null);
  const createObservation = vi.fn(async () => ({ created: true, observation: { id: randomUUID() } }));
  const importExternalActivity = vi.fn(async () => "created" as const);
  const reconcileRecentActivityLinks = vi.fn(async () => {});
  const service = new IntegrationService(
    new SyntheticPersonContext(personId),
    mocks as unknown as IntegrationStore,
    { reconcile, originalActivityFile },
    cipher,
    { createObservation } as unknown as RecoveryStore,
    { importExternalActivity, reconcileRecentActivityLinks } as unknown as TrainingStore,
    { providerKey, historicalWindowDays: providerKey === "garmin_personal" ? 14 : 180 }
  );
  return { service, connection, mocks, reconcile, originalActivityFile, networkRequest, decrypt, createObservation, importExternalActivity, reconcileRecentActivityLinks };
}

describe("date-bounded Garmin cutover importer", () => {
  it("keeps the source tail fixed at D minus 14 through D minus 1 after activation, and partitions activities by their UTC start", async () => {
    vi.useFakeTimers();
    vi.setSystemTime("2026-11-27T22:00:00.000Z");
    const oldActivity = activity("before-boundary", "2026-11-20T20:59:59.999Z", "2026-11-21");
    const newActivity = activity("at-boundary", "2026-11-20T21:00:00.000Z", "2026-11-20");
    const h = harness(policy("source"), {
      wellness: [wellness("2026-11-20"), wellness("2026-11-21")],
      activities: [oldActivity, newActivity]
    });

    await h.service.reconcileConnection(h.connection);

    expect(h.reconcile).toHaveBeenCalledWith(
      "synthetic-import-credential", "2026-11-07", "2026-11-20",
      `${h.connection.id}:${h.connection.consentId}`,
      { beforeRequest: expect.any(Function), activityFromDate: "2026-11-05", activityToDate: "2026-11-22" }
    );
    expect(h.createObservation).toHaveBeenCalledTimes(1);
    expect(h.createObservation).toHaveBeenCalledWith(h.connection.personId, expect.objectContaining({ localDate: "2026-11-20" }));
    expect(h.importExternalActivity).toHaveBeenCalledTimes(1);
    expect(h.importExternalActivity).toHaveBeenCalledWith(expect.objectContaining({
      providerIdentity: "before-boundary", occurredAt: oldActivity.occurredAt, durationSeconds: 1800
    }));
    expect(h.mocks.recordInbox.mock.calls.map((call) => call[3])).toEqual(["2026-11-20", "before-boundary"]);
    expect(h.reconcileRecentActivityLinks).toHaveBeenCalledWith(h.connection.personId, "2026-11-05", "2026-11-22");
    expect(h.mocks.markSyncFailed).not.toHaveBeenCalled();
  });

  it("uses the policy timezone's current calendar day before the source boundary, rather than the UTC day", async () => {
    vi.useFakeTimers();
    vi.setSystemTime("2026-11-20T12:30:00.000Z");
    const h = harness(policy("source", {
      state: "scheduled", startsOn: "2026-11-22", timezone: "Pacific/Auckland",
      startsAt: new Date("2026-11-21T11:00:00.000Z"),
      sourceDrainsUntil: new Date("2026-12-05T11:00:00.000Z")
    }));

    await h.service.reconcileConnection(h.connection);

    expect(h.reconcile).toHaveBeenCalledWith(expect.any(String), "2026-11-07", "2026-11-21", expect.any(String), expect.objectContaining({
      activityFromDate: "2026-11-05", activityToDate: "2026-11-23"
    }));
    expect(h.mocks.markSyncSucceeded).toHaveBeenCalledWith(h.connection.id, h.connection.consentId, false);
    expect(h.mocks.markSyncFailed).not.toHaveBeenCalled();
  });

  it("starts target rolling at D, omits pre-D wellness and pre-boundary activities, and completes an empty scoped history at D", async () => {
    vi.useFakeTimers();
    vi.setSystemTime("2026-11-21T21:30:00.000Z");
    const h = harness(policy("target"), {
      wellness: [wellness("2026-11-20"), wellness("2026-11-21")],
      activities: [
        activity("old-period", "2026-11-20T20:59:59.999Z", "2026-11-21"),
        activity("new-period", "2026-11-20T21:00:00.000Z", "2026-11-20")
      ]
    });

    await h.service.reconcileConnection({ ...h.connection, historicalImportStatus: "running" });

    expect(h.reconcile).toHaveBeenCalledTimes(1);
    expect(h.reconcile).toHaveBeenCalledWith(expect.any(String), "2026-11-21", "2026-11-22", expect.any(String), expect.objectContaining({
      activityFromDate: "2026-11-19", activityToDate: "2026-11-24"
    }));
    expect(h.mocks.recordInbox.mock.calls.map((call) => call[3])).toEqual(["2026-11-21", "new-period"]);
    expect(h.createObservation).toHaveBeenCalledWith(h.connection.personId, expect.objectContaining({ localDate: "2026-11-21" }));
    expect(h.importExternalActivity).toHaveBeenCalledWith(expect.objectContaining({ providerIdentity: "new-period" }));
    expect(h.mocks.markHistoricalWindowSucceeded).toHaveBeenCalledWith(h.connection.id, expect.any(String), startsOn, true);
    expect(h.mocks.markSyncFailed).not.toHaveBeenCalled();
  });

  it("catches up a delayed target in bounded history windows and never queries wellness or completes a cursor before its D snapshot", async () => {
    vi.useFakeTimers();
    vi.setSystemTime("2026-12-20T23:30:00.000Z");
    const h = harness(policy("target", { state: "active" }));

    await h.service.reconcileConnection({ ...h.connection, historicalImportStatus: "running" });
    expect(h.mocks.markHistoricalWindowSucceeded).toHaveBeenLastCalledWith(h.connection.id, expect.any(String), "2026-11-23", false);
    await h.service.reconcileConnection({ ...h.connection, historicalImportStatus: "running", historicalCursorBefore: "2026-11-23" });

    expect(h.reconcile.mock.calls.map((call) => [call[1], call[2]])).toEqual([
      ["2026-12-07", "2026-12-21"],
      ["2026-11-23", "2026-12-06"],
      ["2026-12-07", "2026-12-21"],
      ["2026-11-21", "2026-11-22"]
    ]);
    for (const call of h.reconcile.mock.calls) {
      expect(call[1] >= startsOn).toBe(true);
      expect(call[2] >= startsOn).toBe(true);
    }
    expect(h.reconcile.mock.calls[3]?.[4]).toEqual({
      beforeRequest: expect.any(Function), activityFromDate: "2026-11-19", activityToDate: "2026-11-24"
    });
    expect(h.mocks.markHistoricalWindowSucceeded).toHaveBeenLastCalledWith(h.connection.id, expect.any(String), startsOn, true);
    expect(h.mocks.assertReadAllowed).toHaveBeenCalledTimes(4);
    expect(h.mocks.markHistoricalImportFailed).not.toHaveBeenCalled();
    expect(h.mocks.markSyncFailed).not.toHaveBeenCalled();
  });

  it("does not decrypt credentials or issue any provider request when current policy denies admission", async () => {
    vi.useFakeTimers();
    vi.setSystemTime("2026-12-07T00:00:00.000Z");
    const h = harness(policy("source", { state: "active", requestAllowed: false }));

    await h.service.reconcileConnection({ ...h.connection, historicalImportStatus: "running" });

    expect(h.decrypt).not.toHaveBeenCalled();
    expect(h.reconcile).not.toHaveBeenCalled();
    expect(h.originalActivityFile).not.toHaveBeenCalled();
    expect(h.networkRequest).not.toHaveBeenCalled();
    expect(h.mocks.claimHistoricalWindow).not.toHaveBeenCalled();
    expect(h.mocks.markSyncSucceeded).not.toHaveBeenCalled();
    expect(h.mocks.markSyncFailed).toHaveBeenCalledWith(h.connection.id, h.connection.consentId, "cutover_source_stopped");
    expect(h.mocks.releaseClaim).toHaveBeenCalledWith(h.connection.id, h.connection.consentId);
  });

  it("rechecks live read permission immediately before the transport request and leaves history unadvanced when it closes", async () => {
    vi.useFakeTimers();
    vi.setSystemTime("2026-11-27T22:00:00.000Z");
    const h = harness(policy("source"));
    h.mocks.assertReadAllowed.mockResolvedValue(false);

    await h.service.reconcileConnection({ ...h.connection, historicalImportStatus: "running" });

    expect(h.reconcile).toHaveBeenCalledTimes(1);
    expect(h.networkRequest).not.toHaveBeenCalled();
    expect(h.mocks.recordInbox).not.toHaveBeenCalled();
    expect(h.mocks.claimHistoricalWindow).not.toHaveBeenCalled();
    expect(h.mocks.markHistoricalWindowSucceeded).not.toHaveBeenCalled();
    expect(h.mocks.markSyncFailed).toHaveBeenCalledWith(h.connection.id, h.connection.consentId, "cutover_source_stopped");
    expect(h.mocks.releaseClaim).toHaveBeenCalledWith(h.connection.id, h.connection.consentId);
  });
});
