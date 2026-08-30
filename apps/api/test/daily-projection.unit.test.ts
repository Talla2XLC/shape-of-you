import { describe, expect, it, vi } from "vitest";

import { DailyProjectionService } from "../src/daily-projections/daily-projection.service.js";

describe("DailyProjectionService", () => {
  it("composes current facts without a day lifecycle state", async () => {
    const service = new DailyProjectionService(
      { listForLocalDate: vi.fn().mockResolvedValue([]) } as never,
      { listForLocalDate: vi.fn().mockResolvedValue([]) } as never,
      {
        dailyTotals: vi.fn().mockResolvedValue({
          mealCount: 0,
          totals: { caloriesKcal: null, proteinG: null, fatG: null, carbsG: null },
          nutritionCompleteness: "complete",
          incompleteMealCount: 0
        }),
        listMealsForLocalDate: vi.fn().mockResolvedValue([])
      } as never,
      { listWorkoutSessionsForLocalDate: vi.fn().mockResolvedValue([]) } as never,
      {
        listObservationsForLocalDate: vi.fn().mockResolvedValue([]),
        listAssessmentsForLocalDate: vi.fn().mockResolvedValue([])
      } as never,
      { listForLocalDate: vi.fn().mockResolvedValue({ items: [], nextCursor: null }) } as never,
      { listForLocalDate: vi.fn().mockResolvedValue([]) } as never
    );

    const projection = await service.projection({
      localDate: "2026-08-29",
      timezone: "Europe/Moscow"
    });

    expect(projection).toMatchObject({
      localDate: "2026-08-29",
      timezone: "Europe/Moscow",
      snapshot: {
        physical: { weightMeasurements: [], bodyMeasurementSessions: [] },
        nutrition: { totals: { mealCount: 0, caloriesKcal: null }, meals: [] },
        training: { workoutSessions: [] },
        recovery: { observations: [], assessments: [] },
        coaching: { recommendations: [] }
      }
    });
    expect(projection).not.toHaveProperty("state");
    expect(projection).not.toHaveProperty("closure");
    expect(Number.isNaN(Date.parse(projection.asOf))).toBe(false);
  });
});
