import { describe, expect, it, vi } from "vitest";
import type { CreateRecoveryObservation } from "@shape-of-you/contracts";
import { SyntheticPersonContext } from "../src/application/person-context.js";
import { validateRecoveryObservation } from "../src/domain/recovery.js";
import { IntegrationService } from "../src/integrations/integration.service.js";
import type { ActiveIntegrationConnection, IntegrationStore } from "../src/integrations/integration-store.js";
import type { ConnectionCredentialCipher } from "../src/integrations/credential-cipher.js";
import type { ProviderReconciliation, ProviderWellnessRecord } from "../src/integrations/provider.js";
import type { RecoveryStore } from "../src/storage/recovery-repository.js";
import type { TrainingStore } from "../src/storage/training-repository.js";

const date = "2026-01-20";
const personId = "00000000-0000-4000-8000-000000000001";
const connection = { id: "00000000-0000-4000-8000-000000000002", personId, consentId: "00000000-0000-4000-8000-000000000003", recoveryConnectionId: "00000000-0000-4000-8000-000000000004", credential: {}, historicalImportStatus: "not_requested", historicalCursorBefore: null, historicalNextAttemptAt: null } as ActiveIntegrationConnection;
function wellness(fields: Partial<ProviderWellnessRecord> = {}): ProviderWellnessRecord {
  return { identity: date, localDate: date, timezone: "Europe/Moscow", totalSleepMinutes: null, sleepScore: null, restingHeartRate: null, averageSleepingHeartRate: null, hrvRmssd: null, oxygenSaturation: null, respirationRate: null, bodyBatteryMinimum: null, bodyBatteryMaximum: null, ...fields };
}
function harness(result: ProviderReconciliation) {
  const createObservation = vi.fn(async (_person: string, input: CreateRecoveryObservation) => {
    validateRecoveryObservation(input);
    return { observation: { id: "00000000-0000-4000-8000-000000000005" }, created: true };
  });
  const correctObservation = vi.fn(async (_person: string, _prior: string, input: CreateRecoveryObservation) => {
    validateRecoveryObservation(input);
    return { observation: { id: "00000000-0000-4000-8000-000000000007" }, created: true };
  });
  const withdrawObservation = vi.fn(async () => ({ observation: { id: "00000000-0000-4000-8000-000000000006" }, created: true }));
  const store = { recordInbox: vi.fn(async () => ({ state: "process", receiptId: "receipt" })), recoveryFact: vi.fn(async () => null),
    recoveryFactKeys: vi.fn(async () => [] as string[]), linkRecoveryFact: vi.fn(), completeInbox: vi.fn(), markSyncSucceeded: vi.fn(), markSyncPartial: vi.fn(), markSyncFailed: vi.fn(), releaseClaim: vi.fn() };
  const connected = { importFitnessDay: vi.fn(async () => "created" as const), importNutritionDay: vi.fn(async () => "created" as const), importBodyMeasurement: vi.fn(async () => "created" as const) };
  const service = new IntegrationService(new SyntheticPersonContext(personId), store as unknown as IntegrationStore,
    { reconcile: vi.fn(async () => result), originalActivityFile: vi.fn() },
    { decrypt: () => "synthetic" } as unknown as ConnectionCredentialCipher,
    { createObservation, correctObservation, withdrawObservation } as unknown as RecoveryStore,
    { reconcileRecentActivityLinks: vi.fn() } as unknown as TrainingStore,
    { providerKey: "garmin_personal", historicalWindowDays: 31 }, connected);
  return { service, store, connected, createObservation, correctObservation, withdrawObservation };
}

describe("Complete typed Garmin importer", () => {
  it("restores a provider field as a correction of its withdrawal instead of starting a disconnected chain", async () => {
    const { service, store, createObservation, correctObservation } = harness({ activities: [], wellness: [wellness({ steps: 12002, authoritativeFactKeys: ["steps"] })] });
    store.recoveryFact.mockResolvedValue({ observationId: "withdrawn-prior", checksum: "removed", confirmedConsentId: connection.consentId, confirmedDeliveryId: "delivery" } as never);
    await service.reconcileConnection(connection);
    expect(createObservation).not.toHaveBeenCalled();
    expect(correctObservation).toHaveBeenCalledWith(personId, "withdrawn-prior", expect.objectContaining({ reason: "provider_record_changed", detail: { type: "metric", metric: "steps", value: 12002, unit: "count" } }));
  });

  it("publishes stages, minimum oxygen, a real point and a separate nap under the delivery receipt", async () => {
    const { service, store, createObservation } = harness({ activities: [], wellness: [wellness({ totalSleepMinutes: 400,
      sleepDetail: { type: "sleep", totalSleepMinutes: 400, deepSleepMinutes: 60, remSleepMinutes: 140, lightSleepMinutes: 200, awakeSleepMinutes: 20, sleepQuality: null },
      extraMetrics: [{ type: "metric", metric: "minimum_oxygen_saturation", unit: "percent", value: 92 }], bodyBatteryLatest: 65,
      bodyBatteryInstant: { value: 60, observedAt: `${date}T12:00:00Z` },
      naps: [{ identity: "nap", observedFrom: `${date}T11:00:00Z`, observedUntil: `${date}T11:20:00Z`, totalSleepMinutes: 20 }]
    })] });
    await service.reconcileConnection(connection);
    const inputs = createObservation.mock.calls.map(([, input]) => input);
    expect(inputs.find((input) => input.temporalPrecision === "local_date" && input.detail.type === "sleep")?.detail).toMatchObject({ deepSleepMinutes: 60, remSleepMinutes: 140 });
    expect(inputs.filter((input) => input.detail.type === "metric" && input.detail.metric === "body_battery")).toHaveLength(2);
    expect(inputs.find((input) => input.observedUntil === `${date}T12:00:00Z`)).toMatchObject({ temporalPrecision: "instant", localDate: null, sourceReference: { occurredAt: `${date}T12:00:00Z` } });
    expect(inputs.find((input) => input.observedFrom === `${date}T11:00:00Z`)?.detail).toEqual({ type: "sleep", sleepKind: "nap", totalSleepMinutes: 20, sleepQuality: null });
    expect(store.linkRecoveryFact).toHaveBeenCalledWith(connection.id, connection.consentId, date, "receipt", "body_battery_instant", expect.any(String), expect.any(String));
    expect(store.markSyncFailed).not.toHaveBeenCalled();
  });

  it("retains failed endpoint facts and marks the pass partial", async () => {
    const { service, store, withdrawObservation } = harness({ activities: [], incomplete: true, wellness: [wellness({ authoritativeFactKeys: ["sleep"] })] });
    await service.reconcileConnection(connection);
    expect((store.recoveryFact.mock.calls as unknown as readonly (readonly string[])[]).map((args) => args[2])).toEqual(["sleep"]);
    expect(withdrawObservation).not.toHaveBeenCalled();
    expect(store.markSyncPartial).toHaveBeenCalledWith(connection.id, connection.consentId);
    expect(store.markSyncSucceeded).not.toHaveBeenCalled();
  });

  it("hands independent typed bundles to each owner with the exact consent generation", async () => {
    const day = { identity: date, localDate: date, timezone: "Europe/Moscow", fitness: { vo2Max: { vo2Max: 45, vo2MaxCycling: null, vo2MaxRowing: null } }, nutrition: { hydration: { consumedFluidMl: 500 } } };
    const measurement = { identity: "measurement", localDate: date, timezone: "Europe/Moscow", measuredAt: `${date}T12:00:00Z`, weightKg: 80, composition: null };
    const { service, connected } = harness({ wellness: [], activities: [], connectedDays: [day], bodyMeasurements: [measurement] });
    await service.reconcileConnection(connection);
    const owner = { id: connection.id, personId, consentId: connection.consentId, providerKey: "garmin_personal" };
    expect(connected.importFitnessDay).toHaveBeenCalledWith(owner, day);
    expect(connected.importNutritionDay).toHaveBeenCalledWith(owner, day);
    expect(connected.importBodyMeasurement).toHaveBeenCalledWith(owner, measurement);
  });

  it("withdraws a removed nap only when its authoritative sleep endpoint completed", async () => {
    const { service, store, withdrawObservation } = harness({ activities: [], wellness: [wellness({ authoritativeFactKeys: [], naps: [] })] });
    store.recoveryFactKeys.mockResolvedValue(["sleep_nap:old"]);
    store.recoveryFact.mockResolvedValue({ observationId: "prior", checksum: "prior", confirmedConsentId: connection.consentId, confirmedDeliveryId: "delivery" } as never);
    await service.reconcileConnection(connection);
    expect(withdrawObservation).toHaveBeenCalledWith(personId, "prior", expect.any(String), "provider_field_removed", { connectionId: connection.recoveryConnectionId, consentId: connection.consentId });
  });
});
