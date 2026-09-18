import { describe, expect, it } from "vitest";

import type { DailyNextAction } from "@shape-of-you/contracts";

import { applyConservativePersonalOverlay } from "../src/domain/daily-assessment-personal-overlay.js";
import {
  evaluatePersonalizedDailyAssessment,
  evaluatePersonalizedDailyAssessmentV3,
  type PersonalAssessmentEvidenceDay
} from "../src/domain/personalized-daily-assessment.js";

const readyAction: DailyNextAction = {
  type: "follow_active_program",
  text: "Follow the active program.",
  trainingProgramVersionId: "00000000-0000-4000-8000-000000000101"
};

function localDate(offset: number): string {
  const date = new Date("2026-08-01T00:00:00.000Z");
  date.setUTCDate(date.getUTCDate() + offset);
  return date.toISOString().slice(0, 10);
}

function day(
  offset: number,
  values: PersonalAssessmentEvidenceDay["values"],
  overrides: Partial<PersonalAssessmentEvidenceDay> = {}
): PersonalAssessmentEvidenceDay {
  return {
    localDate: localDate(offset),
    values,
    baselineExcluded: false,
    recoveryHardStop: false,
    trainingLoadIncompatible: false,
    trainingLoadSeriesKey: values.training_load === undefined
      ? null
      : "relative_training_stress:test-v1",
    recoveryObservationIds: [],
    recoveryAssessmentIds: [],
    externalActivityIds: [],
    ...overrides
  };
}

describe("authoritative personal daily assessment", () => {
  it("explains adverse current values relative to enough personal history", () => {
    const history = Array.from({ length: 14 }, (_, index) => day(index, {
      sleep_minutes: 480,
      hrv_rmssd: 60,
      resting_heart_rate: 50
    }));
    const target = day(14, {
      sleep_minutes: 480,
      hrv_rmssd: 40,
      resting_heart_rate: 62
    });

    const result = evaluatePersonalizedDailyAssessment(target.localDate, [...history, target]);
    const overlay = applyConservativePersonalOverlay("ready", readyAction, result.signals);

    expect(result.publicBaseline.status).toBe("partial");
    expect(result.publicBaseline.summary).toContain("HRV ниже твоего обычного уровня");
    expect(result.publicBaseline.summary).toContain("пульс покоя выше обычного");
    expect(result.reasons).toEqual(expect.arrayContaining([
      "hrv_below_usual",
      "resting_heart_rate_above_usual"
    ]));
    expect(overlay.status).toBe("caution");
    expect(overlay.action.text).not.toMatch(/диагноз|болезн/i);
  });

  it("does not invent a personal comparison before fourteen eligible days", () => {
    const history = Array.from({ length: 13 }, (_, index) => day(index, {
      sleep_minutes: 480,
      hrv_rmssd: 60
    }));
    const target = day(13, { sleep_minutes: 300, hrv_rmssd: 30 });

    const result = evaluatePersonalizedDailyAssessment(target.localDate, [...history, target]);
    const overlay = applyConservativePersonalOverlay("ready", readyAction, result.signals);

    expect(result.publicBaseline.status).toBe("unavailable");
    expect(result.publicBaseline.comparisons.every(
      (comparison) => comparison.availability !== "available"
    )).toBe(true);
    expect(overlay.status).toBe("ready");
  });

  it("does not normalize a chronically unsafe sleep center into ready", () => {
    const history = Array.from({ length: 14 }, (_, index) => day(index, {
      sleep_minutes: 330
    }));
    const target = day(14, { sleep_minutes: 330 });

    const result = evaluatePersonalizedDailyAssessment(target.localDate, [...history, target]);
    const overlay = applyConservativePersonalOverlay("ready", readyAction, result.signals);

    expect(result.publicBaseline.comparisons.find(
      (comparison) => comparison.metric === "sleep_minutes"
    )).toMatchObject({ availability: "available", position: "within_usual" });
    expect(result.signals.adverseCenterPresent).toBe(true);
    expect(overlay.status).toBe("caution");
  });

  it("describes a favorable deviation instead of calling it within range", () => {
    const history = Array.from({ length: 14 }, (_, index) => day(index, {
      hrv_rmssd: 60
    }));
    const target = day(14, { hrv_rmssd: 85 });

    const result = evaluatePersonalizedDailyAssessment(target.localDate, [...history, target]);

    expect(result.publicBaseline.comparisons.find(
      (comparison) => comparison.metric === "hrv_rmssd"
    )).toMatchObject({ availability: "available", position: "above_usual" });
    expect(result.publicBaseline.summary).toContain("HRV выше твоего обычного уровня");
    expect(result.publicBaseline.summary).not.toContain("в пределах");
  });

  it("refuses to compare incompatible training-load semantics", () => {
    const history = Array.from({ length: 21 }, (_, index) => day(index, {
      training_load: 50
    }));
    const target = day(21, { training_load: 120 }, {
      trainingLoadIncompatible: true,
      trainingLoadSeriesKey: null
    });

    const result = evaluatePersonalizedDailyAssessment(target.localDate, [...history, target]);

    expect(result.publicBaseline.comparisons.find(
      (comparison) => comparison.metric === "training_load"
    )).toMatchObject({ availability: "incompatible", position: null });
    expect(result.reasons).not.toContain("training_load_above_usual");
  });

  it("counts direct, minimum and maximum Body Battery as one physiological signal", () => {
    const history = Array.from({ length: 14 }, (_, index) => day(index, {
      body_battery: 74 + (index % 3),
      body_battery_min: 24 + (index % 3),
      body_battery_max: 79 + (index % 3)
    }));
    const target = day(14, {
      body_battery: 20,
      body_battery_min: 5,
      body_battery_max: 25
    });

    const result = evaluatePersonalizedDailyAssessment(target.localDate, [...history, target]);
    const overlay = applyConservativePersonalOverlay("ready", readyAction, result.signals);

    expect(result.publicBaseline.comparisons.filter(
      (comparison) => comparison.metric.startsWith("body_battery") &&
        comparison.availability === "available" && comparison.severity === "marked"
    )).toHaveLength(3);
    expect(result.signals.markedPersonalSignalCount).toBe(1);
    expect(result.signals.adversePersonalSignalCount).toBe(1);
    expect(result.signals.persistentPersonalSignalCount).toBeLessThanOrEqual(1);
    expect(overlay.status).not.toBe("recovery_priority");
  });

  it("keeps an insufficient-data base decision unless a hard stop is present", () => {
    const unchanged = applyConservativePersonalOverlay("insufficient_data", {
      type: "record_recovery_check_in",
      text: "Record recovery data.",
      trainingProgramVersionId: null
    }, {
      hardStop: false,
      eligibleBeforeStability: true,
      markedPersonalSignalCount: 3,
      adversePersonalSignalCount: 3,
      persistentPersonalSignalCount: 2,
      adverseCenterPresent: true
    });

    expect(unchanged.status).toBe("insufficient_data");
  });

  it("uses a partial-day steps count only when it already exceeds the full-day range", () => {
    const history = Array.from({ length: 14 }, (_, index) => day(index, {
      steps: 7_800 + (index % 3) * 200
    }));
    const target = day(14, { steps: 12_000 }, { partialDayMetrics: ["steps"] });

    const result = evaluatePersonalizedDailyAssessmentV3(target.localDate, [...history, target]);
    const overlay = applyConservativePersonalOverlay("ready", readyAction, result.signals);

    expect(result.publicBaseline.policyVersion).toBe("personal-baseline-v2");
    expect(result.publicBaseline.comparisons).toHaveLength(8);
    expect(result.publicBaseline.comparisons.find((item) => item.metric === "steps"))
      .toMatchObject({ availability: "available", position: "above_usual" });
    expect(result.reasons).toContain("steps_above_usual");
    expect(overlay.status).toBe("ready");
  });

  it("does not call an incomplete lower steps count below usual", () => {
    const history = Array.from({ length: 14 }, (_, index) => day(index, {
      steps: 8_000 + (index % 3) * 200
    }));
    const target = day(14, { steps: 2_000 }, { partialDayMetrics: ["steps"] });

    const result = evaluatePersonalizedDailyAssessmentV3(target.localDate, [...history, target]);

    expect(result.publicBaseline.comparisons.find((item) => item.metric === "steps"))
      .toMatchObject({ availability: "available", position: "within_usual", severity: "usual" });
    expect(result.publicBaseline.summary).not.toContain("шагов пока меньше");
    expect(result.reasons).not.toContain("steps_above_usual");
  });

  it("allows high steps to strengthen a decision only with another adverse signal", () => {
    const history = Array.from({ length: 14 }, (_, index) => day(index, {
      hrv_rmssd: 60 + (index % 3),
      steps: 8_000 + (index % 3) * 200
    }));
    const target = day(14, { hrv_rmssd: 45, steps: 8_700 }, {
      partialDayMetrics: ["steps"]
    });

    const result = evaluatePersonalizedDailyAssessmentV3(target.localDate, [...history, target]);
    const overlay = applyConservativePersonalOverlay("ready", readyAction, result.signals);

    expect(result.signals.movementAboveUsual).toBe(true);
    expect(result.signals.adverseNonMovementSignalCount).toBe(1);
    expect(overlay.status).toBe("caution");
  });
});
