import { describe, expect, it, vi } from "vitest";

import { CurrentRecoveryContextService } from "../src/coaching/current-recovery-context.service.js";
import type { PersonContext } from "../src/application/person-context.js";
import type { IntegrationStore } from "../src/integrations/integration-store.js";
import type { RecoveryService } from "../src/recovery/recovery.service.js";
import type { DailyAssessmentStore } from "../src/storage/daily-assessment-repository.js";

const personId = "00000000-0000-4000-8000-000000000018";
const personContext = { getPersonId: () => personId } as PersonContext;

describe("CurrentRecoveryContextService", () => {
  it("fails closed before reading evidence when Person timezone is unset", async () => {
    const connectedRecoveryDelivery = vi.fn();
    const listObservations = vi.fn();
    const service = new CurrentRecoveryContextService(
      personContext,
      { getPreferences: async () => ({ timezone: null }) } as unknown as DailyAssessmentStore,
      { connectedRecoveryDelivery } as unknown as IntegrationStore,
      { listObservations } as unknown as RecoveryService
    );

    await expect(service.read(new Date("2026-09-18T08:30:00.000Z"))).resolves.toEqual({
      state: "timezone_required",
      timezone: null
    });
    expect(connectedRecoveryDelivery).not.toHaveBeenCalled();
    expect(listObservations).not.toHaveBeenCalled();
  });

  it("derives the Person-local day and composes typed facts with empty delivery", async () => {
    const connectedRecoveryDelivery = vi.fn().mockResolvedValue({
      lifecycle: "active",
      importEnabled: true,
      failureCode: null,
      lastAttemptAt: new Date("2026-09-17T22:01:00.000Z"),
      lastSuccessfulSyncAt: new Date("2026-09-17T22:01:00.000Z"),
      targetDateRecordReceived: true,
      targetDateSupportedFactsPresent: false
    });
    const listObservations = vi.fn().mockResolvedValue({ items: [] });
    const service = new CurrentRecoveryContextService(
      personContext,
      { getPreferences: async () => ({ timezone: "Europe/Belgrade" }) } as unknown as DailyAssessmentStore,
      { connectedRecoveryDelivery } as unknown as IntegrationStore,
      { listObservations } as unknown as RecoveryService
    );

    await expect(service.read(new Date("2026-09-17T22:05:00.000Z"))).resolves.toEqual({
      state: "available",
      policyVersion: "connected-recovery-freshness-v1",
      calculatedAt: "2026-09-17T22:05:00.000Z",
      localDate: "2026-09-18",
      timezone: "Europe/Belgrade",
      syncState: "fresh_success",
      targetDateDelivery: "record_without_supported_facts",
      checkedAt: "2026-09-17T22:01:00.000Z",
      observations: { items: [] }
    });
    expect(connectedRecoveryDelivery).toHaveBeenCalledWith(personId, "2026-09-18");
    expect(listObservations).toHaveBeenCalledWith({ localDate: "2026-09-18", limit: 100 });
  });

  it("reports configured integration unavailability without inventing delivery", async () => {
    const service = new CurrentRecoveryContextService(
      personContext,
      { getPreferences: async () => ({ timezone: "UTC" }) } as unknown as DailyAssessmentStore,
      null,
      { listObservations: async () => ({ items: [] }) } as unknown as RecoveryService
    );

    await expect(service.read(new Date("2026-09-18T08:30:00.000Z"))).resolves.toMatchObject({
      state: "available",
      syncState: "unavailable",
      targetDateDelivery: "unknown",
      checkedAt: null
    });
  });

  it("does not claim no record before the Person-local target day was covered", async () => {
    const service = new CurrentRecoveryContextService(
      personContext,
      { getPreferences: async () => ({ timezone: "Europe/Belgrade" }) } as unknown as DailyAssessmentStore,
      {
        connectedRecoveryDelivery: async () => ({
          lifecycle: "active",
          importEnabled: true,
          failureCode: null,
          lastAttemptAt: new Date("2026-12-14T23:05:00.000Z"),
          lastSuccessfulSyncAt: new Date("2026-12-14T23:05:00.000Z"),
          targetDateRecordReceived: false,
          targetDateSupportedFactsPresent: false
        })
      } as unknown as IntegrationStore,
      { listObservations: async () => ({ items: [] }) } as unknown as RecoveryService
    );

    await expect(service.read(new Date("2026-12-14T23:06:00.000Z"))).resolves.toMatchObject({
      localDate: "2026-12-15",
      syncState: "fresh_success",
      targetDateDelivery: "unknown"
    });
  });
});
