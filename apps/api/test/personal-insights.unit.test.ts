import Ajv from "ajv";
import addFormats from "ajv-formats";
import { describe, expect, it, vi } from "vitest";

import { PersonalInsightsResultSchema } from "@shape-of-you/contracts";

import { evaluatePersonalInsights, type PersonalInsightInputs } from "../src/domain/personal-insights.js";
import { PersonalInsightsService } from "../src/progress-overview/personal-insights.service.js";

const target = "2026-09-29";
function day(offset: number): string {
  const date = new Date(`${target}T00:00:00.000Z`);
  date.setUTCDate(date.getUTCDate() + offset);
  return date.toISOString().slice(0, 10);
}

function input(overrides: Partial<PersonalInsightInputs> = {}): PersonalInsightInputs {
  return { localDate: target, timezone: "Europe/Belgrade", weights: [], trainingDays: [], sleeps: [], excludedDates: new Set(), trainingHistoryComplete: true, ...overrides };
}

describe("personal-insights-v1", () => {
  it("suppresses all candidates on sparse evidence and validates the closed response", () => {
    const result = evaluatePersonalInsights(input());
    expect(result.insights).toEqual([]);
    expect(result.suppressed.map((item) => item.reason)).toEqual(["insufficient_data", "insufficient_data", "insufficient_data"]);
    const AjvConstructor = Ajv as unknown as new (options: { strict: boolean }) => { validate: (schema: unknown, data: unknown) => boolean };
    const installFormats = addFormats as unknown as (instance: unknown) => unknown;
    const ajv = new AjvConstructor({ strict: false });
    installFormats(ajv);
    expect(ajv.validate(PersonalInsightsResultSchema, result)).toBe(true);
  });

  it("uses one current same-day weight representative and hides an unstable series", () => {
    const weights = [-27, -24, -21, -18, -15, -13, -10, -7, -4, -1].map((offset, index) => ({
      id: `w${index}`, localDate: day(offset), measuredAt: `${day(offset)}T08:00:00.000Z`, weightKg: index < 5 ? 80 : 79
    }));
    weights.push({ id: "replacement", localDate: day(-1), measuredAt: `${day(-1)}T20:00:00.000Z`, weightKg: 79 });
    const result = evaluatePersonalInsights(input({ weights }));
    const weight = result.insights.find((item) => item.kind === "weight_direction");
    expect(weight?.statement).toContain("lower");
    expect(weight?.evidence.weightMeasurementIds).toContain("replacement");
    expect(weight?.evidence.weightMeasurementIds).not.toContain("w9");
    const unstable = evaluatePersonalInsights(input({ weights: weights.map((item, index) => ({ ...item, weightKg: index % 2 ? 75 : 85 })) }));
    expect(unstable.insights.some((item) => item.kind === "weight_direction")).toBe(false);
  });

  it("compares only recorded training dates and never calls an empty date a rest day", () => {
    const trainingDays = [-52, -42, -20, -16, -12, -8, -4].map((offset, index) => ({
      localDate: day(offset), workoutSessionIds: [`s${index}`], externalActivityIds: []
    }));
    const result = evaluatePersonalInsights(input({ trainingDays }));
    const rhythm = result.insights.find((item) => item.kind === "training_rhythm");
    expect(rhythm?.statement).toContain("5 days with recorded training, compared with 2");
    expect(rhythm?.limitation).toContain("not a confirmed rest day");
    const incomplete = evaluatePersonalInsights(input({ trainingDays, trainingHistoryComplete: false }));
    expect(incomplete.suppressed).toContainEqual({ kind: "training_rhythm", reason: "ambiguous_evidence" });
  });

  it("keeps the sleep comparison hidden below its paired-day gate and observational when eligible", () => {
    const trainingDays = Array.from({ length: 55 }, (_, index) => index).filter((index) => index % 3 === 0).map((index) => ({
      localDate: day(-56 + index), workoutSessionIds: [`s${index}`], externalActivityIds: []
    }));
    const trainingDates = new Set(trainingDays.map((item) => item.localDate));
    const sleeps = Array.from({ length: 55 }, (_, index) => ({
      id: `r${index}`, localDate: day(-55 + index), quality: "reliable" as const,
      totalSleepMinutes: trainingDates.has(day(-56 + index)) ? 390 : 460
    }));
    const sparse = evaluatePersonalInsights(input({ trainingDays, sleeps: sleeps.slice(0, 3) }));
    expect(sparse.suppressed.find((item) => item.kind === "post_training_sleep_association")?.reason).toBe("insufficient_data");
    const result = evaluatePersonalInsights(input({ trainingDays, sleeps }));
    const association = result.insights.find((item) => item.kind === "post_training_sleep_association");
    expect(association?.statement).toContain("In these records");
    expect(association?.limitation).toContain("not an effect of training");
    expect(association?.evidence.recoveryObservationIds).toHaveLength(55);
    const incomplete = evaluatePersonalInsights(input({ trainingDays, sleeps, trainingHistoryComplete: false }));
    expect(incomplete.suppressed).toContainEqual({ kind: "post_training_sleep_association", reason: "ambiguous_evidence" });
  });

  it("rejects a future local date before reading owner evidence", async () => {
    const next = new Date(Date.now() + 3 * 86_400_000).toISOString().slice(0, 10);
    const trainingRead = vi.fn();
    const service = new PersonalInsightsService(
      { listForLocalDateRange: vi.fn() } as never,
      { listTrainingFactsForLocalDateRange: trainingRead } as never,
      { listObservationsForLocalDateRange: vi.fn() } as never,
      { listForLocalDateRange: vi.fn() } as never
    );
    await expect(service.read({ localDate: next, timezone: "UTC" })).rejects.toThrow("future");
    expect(trainingRead).not.toHaveBeenCalled();
  });

  it("composes exact linked training only once and excludes a short imported activity", async () => {
    const first = {
      sessions: [
        { id: "session-linked", localDate: day(-45), externalActivityId: "activity-linked", exercises: [{ sets: [{}] }] },
        { id: "empty-session", localDate: day(-44), externalActivityId: null, exercises: [{ sets: [] }] }
      ],
      externalActivities: [
        { id: "activity-linked", localDate: day(-45), durationSeconds: 1800, trainingLoad: 20, sessionCovered: true },
        { id: "short", localDate: day(-43), durationSeconds: 300, trainingLoad: 10, sessionCovered: false },
        { id: "covered-outside-slice", localDate: day(-40), durationSeconds: 1800, trainingLoad: 20, sessionCovered: true },
        { id: "prior", localDate: day(-35), durationSeconds: 1800, trainingLoad: 20, sessionCovered: false }
      ]
    };
    const second = { sessions: [], externalActivities: [-20, -16, -12, -8, -4].map((offset) => ({
      id: `a${offset}`, localDate: day(offset), durationSeconds: 1800, trainingLoad: 20, sessionCovered: false
    })) };
    const trainingRead = vi.fn().mockResolvedValueOnce(first).mockResolvedValueOnce(second);
    const service = new PersonalInsightsService(
      { listForLocalDateRange: vi.fn().mockResolvedValue([]) } as never,
      { listTrainingFactsForLocalDateRange: trainingRead, hasCompleteConnectedActivityHistory: vi.fn().mockResolvedValue(true) } as never,
      { listObservationsForLocalDateRange: vi.fn().mockResolvedValue([]) } as never,
      { listForLocalDateRange: vi.fn().mockResolvedValue({ items: [] }) } as never
    );
    const result = await service.read({ localDate: target, timezone: "Europe/Belgrade" });
    const rhythm = result.insights.find((item) => item.kind === "training_rhythm");
    expect(rhythm?.comparisonDays).toBe(2);
    expect(rhythm?.evidence.externalActivityIds).not.toContain("activity-linked");
    expect(rhythm?.evidence.externalActivityIds).not.toContain("short");
    expect(rhythm?.evidence.externalActivityIds).not.toContain("covered-outside-slice");
    expect(rhythm?.evidence.workoutSessionIds).toContain("session-linked");
    expect(trainingRead).toHaveBeenCalledTimes(2);
  });
});
