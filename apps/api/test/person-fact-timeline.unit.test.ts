import { describe, expect, it, vi } from "vitest";

import { PersonFactTimelineService } from "../src/progress-overview/person-fact-timeline.service.js";

function fixture(overrides: Partial<Record<"weights" | "body" | "meals" | "training" | "recovery", unknown>> = {}) {
  const reads = {
    weights: vi.fn().mockResolvedValue(overrides.weights ?? []),
    body: vi.fn().mockResolvedValue(overrides.body ?? []),
    meals: vi.fn().mockResolvedValue(overrides.meals ?? []),
    training: vi.fn().mockResolvedValue(overrides.training ?? { sessions: [], externalActivities: [] }),
    recovery: vi.fn().mockResolvedValue(overrides.recovery ?? [])
  };
  const service = new PersonFactTimelineService(
    { listForLocalDateRange: reads.weights } as never,
    { listForLocalDateRange: reads.body } as never,
    { listMealsForLocalDateRange: reads.meals } as never,
    { listTrainingFactsForLocalDateRange: reads.training } as never,
    { listObservationsForLocalDateRange: reads.recovery } as never
  );
  return { reads, service };
}

describe("PersonFactTimelineService", () => {
  it("keeps a corrected date-only fact untimed and exposes its owner history", async () => {
    const { service, reads } = fixture({ weights: [{
      id: "00000000-0000-4000-8000-000000000001", localDate: "2026-09-22", measuredAt: null,
      temporalPrecision: "local_date", weightKg: 70,
      supersedesId: "00000000-0000-4000-8000-000000000002"
    }] });
    const result = await service.read({ from: "2026-09-22", to: "2026-09-22", timezone: "Europe/Moscow" });
    expect(result.scope).toBe("current_recorded_facts_only");
    expect(result.items).toEqual([expect.objectContaining({
      kind: "weight", occurredAt: null, numericValue: 70,
      historyPath: "/v1/weight-measurements/00000000-0000-4000-8000-000000000001/history"
    })]);
    expect(reads.weights).toHaveBeenCalledWith("2026-09-22", "2026-09-22");
  });

  it("collapses only an exactly linked external activity and sorts unlinked facts", async () => {
    const { service } = fixture({ training: {
      sessions: [{ id: "00000000-0000-4000-8000-000000000011", localDate: "2026-09-23",
        occurredAt: "2026-09-23T17:00:00Z", temporalPrecision: "instant", workoutName: "Ahilej B",
        externalActivityId: "00000000-0000-4000-8000-000000000012", supersedesId: null }],
      externalActivities: [
        { id: "00000000-0000-4000-8000-000000000012", localDate: "2026-09-23",
          occurredAt: "2026-09-23T17:01:00Z", name: "Strength", durationSeconds: 2765, sessionCovered: true },
        { id: "00000000-0000-4000-8000-000000000013", localDate: "2026-09-24",
          occurredAt: "2026-09-24T08:00:00Z", name: "Walk", durationSeconds: 1200, sessionCovered: false,
          supersedesId: "00000000-0000-4000-8000-000000000015" }
      ]
    } });
    const result = await service.read({ from: "2026-09-23", to: "2026-09-24", timezone: "Europe/Moscow" });
    expect(result.items.map((item) => item.id)).toEqual([
      "00000000-0000-4000-8000-000000000013",
      "00000000-0000-4000-8000-000000000011"
    ]);
    expect(result.items[1]?.linkedExternalActivityId).toBe("00000000-0000-4000-8000-000000000012");
    expect(result.items[0]?.supersedesId).toBe("00000000-0000-4000-8000-000000000015");
  });

  it("does not present a corrected activity as another workout when its lineage is covered", async () => {
    const { service } = fixture({ training: {
      sessions: [{ id: "00000000-0000-4000-8000-000000000011", localDate: "2026-09-23",
        occurredAt: "2026-09-23T17:00:00Z", temporalPrecision: "instant", workoutName: "Ahilej B",
        externalActivityId: "00000000-0000-4000-8000-000000000012", supersedesId: null }],
      externalActivities: [{ id: "00000000-0000-4000-8000-000000000014", localDate: "2026-09-23",
        occurredAt: "2026-09-23T17:01:00Z", name: "Corrected strength", durationSeconds: 2765,
        sessionCovered: true }]
    } });
    const result = await service.read({ from: "2026-09-23", to: "2026-09-23", timezone: "Europe/Moscow" });
    expect(result.items.map((item) => item.kind)).toEqual(["workout_session"]);
  });

  it("rejects invalid or oversized ranges before any owner read", async () => {
    const { service, reads } = fixture();
    await expect(service.read({ from: "2026-08-01", to: "2026-09-02", timezone: "UTC" })).rejects.toThrow("32");
    await expect(service.read({ from: "2026-09-02", to: "2026-09-01", timezone: "UTC" })).rejects.toThrow("32");
    await expect(service.read({ from: "2026-09-01", to: "2026-09-01", timezone: "Invalid/Zone" })).rejects.toThrow("IANA");
    for (const read of Object.values(reads)) expect(read).not.toHaveBeenCalled();
  });
});
