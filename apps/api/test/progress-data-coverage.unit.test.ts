import { describe, expect, it, vi } from "vitest";

import type { DataCoverageEvidence } from "../src/domain/data-coverage.js";
import { buildCoverageDirection, shiftLocalDate } from "../src/progress-overview/progress-data-coverage.policy.js";
import { ProgressDataCoverageService } from "../src/progress-overview/progress-data-coverage.service.js";

function dailyEvidence(localDate: string, count: number, usable = true): DataCoverageEvidence {
  const days = Array.from({ length: count }, (_, index) => ({
    localDate: shiftLocalDate(localDate, -(index + 1)),
    usable
  }));
  return {
    firstDataDate: days.at(-1)?.localDate ?? null,
    lastDataDate: days[0]?.localDate ?? null,
    days
  };
}

describe("profile data coverage policy", () => {
  it("keeps history, completed-day windows, and readiness separate", () => {
    const direction = buildCoverageDirection("sleep", "2026-09-13", dailyEvidence("2026-09-13", 21));
    expect(direction).toMatchObject({
      firstDataDate: "2026-08-23",
      lastDataDate: "2026-09-12",
      freshnessDays: 1,
      coverage28: { from: "2026-08-16", to: "2026-09-12", recordedDays: 21, usableDays: 21 },
      status: "good"
    });
    expect(direction.coverage28.to).not.toBe("2026-09-13");
  });

  it("does not let partial daily records satisfy readiness", () => {
    const direction = buildCoverageDirection("body_battery", "2026-09-13", dailyEvidence("2026-09-13", 28, false));
    expect(direction.coverage28).toMatchObject({ recordedDays: 28, usableDays: 0 });
    expect(direction.status).toBe("sparse");
    expect(direction.reasons).toContain("partial_records");
  });

  it("uses today's usable evidence for freshness but not completed-day coverage", () => {
    const direction = buildCoverageDirection("hrv", "2026-09-13", {
      firstDataDate: "2026-08-20",
      lastDataDate: "2026-09-13",
      days: [
        "2026-08-20", "2026-08-21", "2026-08-22", "2026-08-23",
        "2026-08-24", "2026-08-25", "2026-08-26", "2026-09-13"
      ].map((localDate) => ({ localDate, usable: true }))
    });

    expect(direction.freshnessDays).toBe(0);
    expect(direction.coverage28.usableDays).toBe(7);
    expect(direction.status).toBe("partial");
  });

  it("uses weekly cadence for weight instead of a daily denominator", () => {
    const direction = buildCoverageDirection("weight", "2026-09-13", {
      firstDataDate: "2026-08-18",
      lastDataDate: "2026-09-11",
      days: ["2026-08-18", "2026-08-27", "2026-09-04", "2026-09-11"].map((localDate) => ({ localDate, usable: true }))
    });
    expect(direction.coverage28.usableDays).toBe(4);
    expect(direction.status).toBe("good");
  });

  it("returns an explicit empty state without synthetic dates", () => {
    const direction = buildCoverageDirection("hrv", "2026-09-13", { firstDataDate: null, lastDataDate: null, days: [] });
    expect(direction).toMatchObject({ freshnessDays: null, status: "sparse", reasons: ["no_data"] });
    expect(direction.coverage90).toMatchObject({ recordedDays: 0, usableDays: 0 });
  });
});

describe("ProgressDataCoverageService", () => {
  it("coordinates one read per owner and preserves the explicit Person-local context", async () => {
    const empty = { firstDataDate: null, lastDataDate: null, days: [] };
    const weight = vi.fn().mockResolvedValue(empty);
    const nutrition = vi.fn().mockResolvedValue(empty);
    const training = vi.fn().mockResolvedValue(empty);
    const recovery = vi.fn().mockResolvedValue({ sleep: empty, hrv: empty, restingHeartRate: empty, bodyBattery: empty });
    const service = new ProgressDataCoverageService(
      { getDataCoverage: weight } as never,
      { getDataCoverage: nutrition } as never,
      { getDataCoverage: training } as never,
      { getDataCoverage: recovery } as never
    );

    const result = await service.read({ localDate: "2026-09-13", timezone: "Europe/Moscow" });

    expect(result).toMatchObject({
      localDate: "2026-09-13",
      completedThrough: "2026-09-12",
      timezone: "Europe/Moscow",
      policyVersion: "profile-data-coverage-v1"
    });
    expect(result.directions.map((direction) => direction.key)).toEqual([
      "sleep", "hrv", "resting_heart_rate", "body_battery", "training", "weight", "nutrition"
    ]);
    for (const read of [weight, nutrition, training, recovery]) {
      expect(read).toHaveBeenCalledOnce();
      expect(read).toHaveBeenCalledWith("2026-06-15", "2026-09-13", "2026-09-13");
    }
  });

  it.each([
    [{ localDate: "2026-02-30", timezone: "UTC" }, "valid calendar date"],
    [{ localDate: "2026-09-13", timezone: "Mars/Olympus" }, "IANA timezone"]
  ])("rejects invalid context before reading owners %#", async (query, message) => {
    const read = vi.fn();
    const service = new ProgressDataCoverageService(
      { getDataCoverage: read } as never,
      { getDataCoverage: read } as never,
      { getDataCoverage: read } as never,
      { getDataCoverage: read } as never
    );
    await expect(service.read(query)).rejects.toThrow(message);
    expect(read).not.toHaveBeenCalled();
  });
});
