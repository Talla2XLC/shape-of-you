import { describe, expect, it } from "vitest";
import { bodyBatteryPoint, bodyMeasurements, connectedDay, dailyMetrics, naps, nutritionIntake, sleepDetails } from "../src/integrations/garmin-personal/normalizers.js";

const date = "2026-01-20";
const timezone = "Europe/Moscow";
const stamp = Date.parse("2026-01-20T12:00:00Z");
const descriptors = [
  { bodyBatteryValueDescriptorKey: "bodyBatteryLevel", bodyBatteryValueDescriptorIndex: 0 },
  { bodyBatteryValueDescriptorKey: "timestamp", bodyBatteryValueDescriptorIndex: 2 }
];

describe("Garmin typed normalization", () => {
  it("preserves stage and verified sleep-need minutes with the provider qualifier", () => {
    expect(sleepDetails({ sleepTimeSeconds: 24000, deepSleepSeconds: 3600, lightSleepSeconds: 12000, remSleepSeconds: 8400,
      awakeSleepSeconds: 1200, sleepNeed: { actual: 480 }, nextSleepNeed: { actual: 490, baseline: 470 }, sleepAlignment: { sleepNeedBaselineMins: 470 }, breathingDisruptionSeverity: "LOW" }))
      .toEqual({ type: "sleep", sleepKind: "main_sleep", totalSleepMinutes: 400, sleepQuality: null, deepSleepMinutes: 60, lightSleepMinutes: 200,
        remSleepMinutes: 140, awakeSleepMinutes: 20, sleepNeedBaselineMinutes: 470, sleepNeedMinutes: 480, nextSleepNeedMinutes: 490, nextSleepNeedBaselineMinutes: 470, breathingDisruptionSeverity: "LOW" });
    expect(sleepDetails({ napTimeSeconds: 900 })).toBeNull();
    expect(() => sleepDetails({ sleepTimeSeconds: 86401 })).toThrow();
  });

  it("keeps real nap intervals separate and skips duration-only naps", () => {
    const interval = { calendarDate: date, napTimeSec: 1200, napStartTimestampGMT: `${date}T12:00:00`, napEndTimestampGMT: `${date}T12:20:00` };
    expect(naps({ dailyNapDTOS: [interval, { calendarDate: date, napTimeSec: 600 }] }, date, timezone)).toEqual([
      { identity: `${date}T12:00:00.000Z`, observedFrom: `${date}T12:00:00.000Z`, observedUntil: `${date}T12:20:00.000Z`, totalSleepMinutes: 20 }
    ]);
    expect(() => naps({ dailyNapDTOS: [interval, interval] }, date, timezone)).toThrow();
  });

  it("uses descriptor indices and the real latest sample rather than extrema or fetch time", () => {
    const point = bodyBatteryPoint([{ date, bodyBatteryValueDescriptorDTOList: descriptors, bodyBatteryValuesArray: [[70, "x", stamp], [65, "x", stamp + 60000]] }], date, timezone);
    expect(point).toEqual({ value: 65, observedAt: "2026-01-20T12:01:00.000Z" });
    expect(bodyBatteryPoint(null, date, timezone)).toBeNull();
  });

  it("refuses malformed, descending, or mislabeled Body Battery series", () => {
    const row = { date, bodyBatteryValueDescriptorDTOList: descriptors };
    expect(() => bodyBatteryPoint([{ ...row, bodyBatteryValuesArray: [[50, "x", stamp], [55, "x", stamp - 1]] }], date, timezone)).toThrow();
    expect(() => bodyBatteryPoint([{ ...row, bodyBatteryValuesArray: [[101, "x", stamp]] }], date, timezone)).toThrow();
    expect(() => bodyBatteryPoint([{ ...row, date: "2026-01-19", bodyBatteryValuesArray: [] }], date, timezone)).toThrow();
    expect(bodyBatteryPoint([{ ...row, bodyBatteryValuesArray: [[50, "x", Date.parse("2026-01-20T22:00:00Z")]] }], date, timezone)).toBeNull();
  });

  it("keeps objective stress, daily oxygen and accumulated battery independent", () => {
    expect(dailyMetrics({ stress: { avgLevel: 20, maxLevel: 80, restDurationInMillis: 90000, lowStressDurationInMillis: 0 },
      bodyBattery: { chargedValue: 130, drainedValue: 125 }, respiration: { avgValue: 14 }, pulseOx: { avgValue: 97, minValue: 91 } }))
      .toEqual(expect.arrayContaining([
        { type: "metric", metric: "stress_rest_minutes", value: 1.5, unit: "minute" },
        { type: "metric", metric: "stress_low_minutes", value: 0, unit: "minute" },
        { type: "metric", metric: "body_battery_charged", value: 130, unit: "score" },
        { type: "metric", metric: "daily_respiration_rate", value: 14, unit: "breaths_per_minute" },
        { type: "metric", metric: "daily_minimum_oxygen_saturation", value: 91, unit: "percent" }
      ]));
    expect(dailyMetrics({})).toEqual([]);
    expect(() => dailyMetrics({ stress: { avgLevel: -1 } })).toThrow();
  });

  it("uses the primary hydration source once and leaves expenditure separate from intake", () => {
    const day = connectedDay({ calories: { burnedTotal: 2100, burnedActive: 500 }, hydration: { consumedInFractionalMl: 1250.5 }, movement: { steps: { distanceInMeters: 4000 }, floorsAscended: { value: 7 } } }, date, timezone);
    expect(day.nutrition).toEqual({ hydration: { consumedFluidMl: 1250.5 } });
    expect(day.fitness?.energyMovement).toMatchObject({ activeExpenditureKcal: 500, totalExpenditureKcal: 2100, restingExpenditureKcal: null, movementDistanceMeters: 4000, floorsUp: 7 });
    expect(day.nutrition).not.toHaveProperty("intake");
  });

  it("does not treat empty logs or goals as measured intake zero", () => {
    expect(nutritionIntake({ mealDate: date, dailyNutritionContent: { calories: 0, protein: 0, fat: 0, carbs: 0 }, dailyNutritionGoals: { calories: 2000 }, loggedFoodsWithServingSizes: [] }, date)).toBeNull();
    expect(nutritionIntake({ mealDate: date, dailyNutritionContent: { calories: 300, protein: 10 } }, date))
      .toEqual({ consumedCaloriesKcal: 300, proteinGrams: 10, fatGrams: null, carbohydrateGrams: null });
    expect(() => nutritionIntake({ mealDate: "2026-01-19" }, date)).toThrow();
  });

  it("uses documented kg without legacy division and blocks unknown composition units", () => {
    expect(bodyMeasurements([{ calendarDate: date, timestampGMT: stamp, weight: 80.125, bmi: 24, bodyFat: 20, bodyWater: 55, muscleMass: 42000, boneMass: 3000 }], [date], timezone))
      .toEqual([{ identity: "2026-01-20T12:00:00.000Z", localDate: date, timezone, measuredAt: "2026-01-20T12:00:00.000Z", weightKg: 80.125,
        composition: { bmi: 24, bodyFatPercent: null, bodyWaterPercent: null, muscleMassKg: null, boneMassKg: null } }]);
    expect(() => bodyMeasurements([{ calendarDate: date, weight: 80125 }], [date], timezone)).toThrow();
    expect(bodyMeasurements([{ calendarDate: date, bmi: 24 }], [date], timezone)[0]).toMatchObject({ weightKg: null, measuredAt: null });
    expect(bodyMeasurements([], [date], timezone)).toEqual([]);
  });
});
