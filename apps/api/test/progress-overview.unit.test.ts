import { describe, expect, it, vi } from "vitest";

import { ProgressOverviewService } from "../src/progress-overview/progress-overview.service.js";

describe("ProgressOverviewService", () => {
  it("coordinates one bounded range read per owner and preserves factual gaps", async () => {
    const calls = {
      weights: vi.fn().mockResolvedValue([
        { id: "w1", localDate: "2026-08-17", measuredAt: "2026-08-17T07:00:00.000Z", weightKg: 80 },
        { id: "w2", localDate: "2026-08-17", measuredAt: "2026-08-17T20:00:00.000Z", weightKg: 79.5 }
      ]),
      body: vi.fn().mockResolvedValue([{ localDate: "2026-08-16" }]),
      meals: vi.fn().mockResolvedValue([
        { localDate: "2026-08-18", totals: { caloriesKcal: 600, proteinG: 35 } },
        { localDate: "2026-08-18", totals: { caloriesKcal: 400, proteinG: 25 } },
        { localDate: "2026-08-16", totals: { caloriesKcal: 0, proteinG: 0 } }
      ]),
      workouts: vi.fn().mockResolvedValue([{ localDate: "2026-08-16" }, { localDate: "2026-08-16" }]),
      observations: vi.fn().mockResolvedValue([{ localDate: "2026-08-17" }]),
      assessments: vi.fn().mockResolvedValue([
        { id: "a1", localDate: "2026-08-16", asOf: "2026-08-16T08:00:00.000Z", readinessScore: 60 },
        { id: "a2", localDate: "2026-08-16", asOf: "2026-08-16T20:00:00.000Z", readinessScore: 72 }
      ]),
      coaching: vi.fn().mockResolvedValue([{ asOf: "2026-08-15T22:30:00.000Z" }])
    };
    const service = new ProgressOverviewService(
      { listForLocalDateRange: calls.weights } as never,
      { listForLocalDateRange: calls.body } as never,
      { listMealsForLocalDateRange: calls.meals } as never,
      { listWorkoutSessionsForLocalDateRange: calls.workouts } as never,
      { listObservationsForLocalDateRange: calls.observations, listAssessmentsForLocalDateRange: calls.assessments } as never,
      { listForLocalDateRange: calls.coaching } as never
    );

    const result = await service.read({ from: "2026-08-16", to: "2026-08-18", timezone: "Europe/Moscow" });

    for (const read of Object.values(calls)) expect(read).toHaveBeenCalledTimes(1);
    expect(result.metrics.find((metric) => metric.key === "weight_kg")?.points).toEqual([
      { localDate: "2026-08-17", value: 79.5 }
    ]);
    expect(result.metrics.find((metric) => metric.key === "calories_kcal")?.points).toEqual([
      { localDate: "2026-08-16", value: 0 }, { localDate: "2026-08-18", value: 1000 }
    ]);
    expect(result.metrics.find((metric) => metric.key === "workout_session_count")?.points).toEqual([{ localDate: "2026-08-16", value: 2 }]);
    expect(result.metrics.find((metric) => metric.key === "readiness_score")?.points).toEqual([{ localDate: "2026-08-16", value: 72 }]);
    expect(result.days.map((day) => day.localDate)).toEqual(["2026-08-18", "2026-08-17", "2026-08-16"]);
    expect(result.days.at(-1)?.facts).toMatchObject({ bodyMeasurementSessions: 1, workoutSessions: 2, recoveryAssessments: 2, coachingRecommendations: 1 });
  });

  it("rejects a range longer than 366 inclusive days before reading owners", async () => {
    const read = vi.fn();
    const service = new ProgressOverviewService(
      { listForLocalDateRange: read } as never,
      { listForLocalDateRange: read } as never,
      { listMealsForLocalDateRange: read } as never,
      { listWorkoutSessionsForLocalDateRange: read } as never,
      { listObservationsForLocalDateRange: read, listAssessmentsForLocalDateRange: read } as never,
      { listForLocalDateRange: read } as never
    );

    await expect(service.read({ from: "2025-08-17", to: "2026-08-18", timezone: "UTC" })).rejects.toThrow("366");
    expect(read).not.toHaveBeenCalled();
  });

  it("accepts an exact 366-day inclusive range", async () => {
    const read = vi.fn().mockResolvedValue([]);
    const service = new ProgressOverviewService(
      { listForLocalDateRange: read } as never, { listForLocalDateRange: read } as never,
      { listMealsForLocalDateRange: read } as never, { listWorkoutSessionsForLocalDateRange: read } as never,
      { listObservationsForLocalDateRange: read, listAssessmentsForLocalDateRange: read } as never,
      { listForLocalDateRange: read } as never
    );
    await expect(service.read({ from: "2025-08-19", to: "2026-08-18", timezone: "UTC" })).resolves.toMatchObject({ days: [] });
    expect(read).toHaveBeenCalledTimes(7);
  });

  it.each([
    [{ from: "2026-08-19", to: "2026-08-18", timezone: "UTC" }, "between 1 and 366"],
    [{ from: "2026-02-30", to: "2026-03-01", timezone: "UTC" }, "valid calendar date"],
    [{ from: "2026-08-18", to: "2026-08-18", timezone: "Mars/Olympus" }, "IANA timezone"]
  ])("rejects invalid query context %#", async (query, message) => {
    const read = vi.fn();
    const service = new ProgressOverviewService(
      { listForLocalDateRange: read } as never, { listForLocalDateRange: read } as never,
      { listMealsForLocalDateRange: read } as never, { listWorkoutSessionsForLocalDateRange: read } as never,
      { listObservationsForLocalDateRange: read, listAssessmentsForLocalDateRange: read } as never,
      { listForLocalDateRange: read } as never
    );
    await expect(service.read(query)).rejects.toThrow(message);
    expect(read).not.toHaveBeenCalled();
  });
});
