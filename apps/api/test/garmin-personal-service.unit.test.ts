import { describe, expect, it, vi } from "vitest";
import { SyntheticPersonContext } from "../src/application/person-context.js";
import { GarminPersonalService, type GarminPersonalRuntime } from "../src/integrations/garmin-personal.service.js";
import type { ActiveIntegrationConnection } from "../src/integrations/integration-store.js";
import type { ProviderReconciliation } from "../src/integrations/provider.js";
import type { RecoveryStore } from "../src/storage/recovery-repository.js";
import type { TrainingStore } from "../src/storage/training-repository.js";

const date = "2026-01-20";
const personId = "00000000-0000-4000-8000-000000000001";
const connection = { id: "00000000-0000-4000-8000-000000000002", personId, consentId: "00000000-0000-4000-8000-000000000003", recoveryConnectionId: "00000000-0000-4000-8000-000000000004", credential: {}, historicalImportStatus: "not_requested", historicalCursorBefore: null, historicalNextAttemptAt: null } as ActiveIntegrationConnection;
const day = { identity: date, localDate: date, timezone: "UTC", fitness: { vo2Max: { vo2Max: 45, vo2MaxCycling: null, vo2MaxRowing: null } }, nutrition: { hydration: { consumedFluidMl: 500 } } };
const measurement = { identity: "measurement", localDate: date, timezone: "UTC", measuredAt: `${date}T12:00:00Z`, weightKg: 80, composition: null };
const result = { wellness: [], activities: [], connectedDays: [day], bodyMeasurements: [measurement], externalUserId: "42" };

function harness(output: ProviderReconciliation & { externalUserId: string | null } = result, writer = true) {
  const store = { claimDue: vi.fn(async () => connection), bindExternalIdentity: vi.fn(async () => true),
    assertReadAllowed: vi.fn(async () => true), markSyncSucceeded: vi.fn(), markSyncPartial: vi.fn(), markSyncFailed: vi.fn(), releaseClaim: vi.fn(), recordInbox: vi.fn() };
  const connected = { importFitnessDay: vi.fn(async () => "created" as const), importNutritionDay: vi.fn(async () => "created" as const), importBodyMeasurement: vi.fn(async () => "created" as const) };
  const createObservation = vi.fn();
  const service = new GarminPersonalService(new SyntheticPersonContext(personId), { createObservation } as unknown as RecoveryStore,
    { reconcileRecentActivityLinks: vi.fn() } as unknown as TrainingStore,
    { store, provider: { reconcile: vi.fn(async () => output) }, cipher: { decrypt: () => "synthetic" } } as unknown as GarminPersonalRuntime,
    null, writer ? connected : null);
  return { service, store, connected, createObservation };
}

describe("Garmin Personal production importer assembly", () => {
  it("forwards all three new data families through the public worker entry and binds an available account ID", async () => {
    const { service, store, connected } = harness();
    await expect(service.processNext("synthetic-worker", 60000)).resolves.toBe(true);
    const owner = { id: connection.id, personId, consentId: connection.consentId, providerKey: "garmin_personal" };
    expect(store.bindExternalIdentity).toHaveBeenCalledWith(connection.id, connection.consentId, "42");
    expect(connected.importFitnessDay).toHaveBeenCalledWith(owner, day);
    expect(connected.importNutritionDay).toHaveBeenCalledWith(owner, day);
    expect(connected.importBodyMeasurement).toHaveBeenCalledWith(owner, measurement);
    expect(store.markSyncSucceeded).toHaveBeenCalledWith(connection.id, connection.consentId, true);
    expect(store.markSyncFailed).not.toHaveBeenCalled();
  });

  it("drops every new family when identity binding rejects the captured generation", async () => {
    const { service, store, connected } = harness();
    store.bindExternalIdentity.mockResolvedValue(false);
    await service.processNext("synthetic-worker", 60000);
    expect(connected.importFitnessDay).not.toHaveBeenCalled();
    expect(connected.importNutritionDay).not.toHaveBeenCalled();
    expect(connected.importBodyMeasurement).not.toHaveBeenCalled();
  });

  it("imports authenticated new-only DTOs without inventing an account ID or requiring watch data", async () => {
    const { service, store, connected } = harness({ ...result, externalUserId: null });
    await service.processNext("synthetic-worker", 60000);
    expect(store.bindExternalIdentity).not.toHaveBeenCalled();
    expect(connected.importNutritionDay).toHaveBeenCalledOnce();
    expect(connected.importBodyMeasurement).toHaveBeenCalledOnce();
    expect(store.markSyncFailed).not.toHaveBeenCalled();
  });

  it("fails a missing writer before Recovery mutations and never checkpoints success", async () => {
    const { service, store, createObservation } = harness({ ...result, wellness: [{ identity: date, localDate: date, timezone: "UTC", totalSleepMinutes: 480,
      sleepScore: null, restingHeartRate: null, averageSleepingHeartRate: null, hrvRmssd: null, oxygenSaturation: null, respirationRate: null,
      bodyBatteryMinimum: null, bodyBatteryMaximum: null }] }, false);
    await service.processNext("synthetic-worker", 60000);
    expect(createObservation).not.toHaveBeenCalled();
    expect(store.recordInbox).not.toHaveBeenCalled();
    expect(store.markSyncSucceeded).not.toHaveBeenCalled();
    expect(store.markSyncPartial).not.toHaveBeenCalled();
    expect(store.markSyncFailed).toHaveBeenCalledWith(connection.id, connection.consentId, "provider_unavailable");
    expect(store.releaseClaim).toHaveBeenCalledWith(connection.id, connection.consentId);
  });

  it("keeps an empty account compatible with no account ID or new writer", async () => {
    const { service, store } = harness({ wellness: [], activities: [], externalUserId: null }, false);
    await service.processNext("synthetic-worker", 60000);
    expect(store.bindExternalIdentity).not.toHaveBeenCalled();
    expect(store.markSyncSucceeded).toHaveBeenCalledWith(connection.id, connection.consentId, false);
    expect(store.markSyncFailed).not.toHaveBeenCalled();
  });
});
