import type { MetricObservationDetail, ProviderConnectedDayRecord, ProviderBodyMeasurementRecord, SleepObservationDetail } from "@shape-of-you/contracts";
import type { ProviderWellnessRecord } from "../provider.js";
import { IntegrationProviderError } from "../provider.js";

type Row = Record<string, unknown>;
/** Validates a JSON object without retaining provider payloads in errors. */
export function record(value: unknown): Row {
  if (!value || typeof value !== "object" || Array.isArray(value)) invalid();
  return value as Row;
}
/** Missing optional objects are empty, rather than fabricated numeric measurements. */
export function optionalRecord(value: unknown): Row { return value == null ? {} : record(value); }
/** Reads one documented numeric field; zero is distinct from absent. */
export function numeric(value: unknown, min = 0, max = 1_000_000): number | null {
  if (value == null) return null;
  if (typeof value !== "number" || !Number.isFinite(value) || value < min || value > max) invalid();
  return value;
}
/** Converts a declared GMT timestamp (including official offset-free strings) to an instant. */
export function instant(value: unknown): string {
  if (typeof value === "number") {
    if (!Number.isSafeInteger(value) || value <= 0 || value > 8_640_000_000_000_000) invalid();
    return new Date(value).toISOString();
  }
  if (typeof value !== "string" || !/^\d{4}-\d\d-\d\d[T ]\d\d:\d\d:\d\d(?:\.\d{1,9})?(?:Z|[+-]\d\d:\d\d)?$/.test(value)) invalid();
  const date = new Date(value.replace(" ", "T") + (/(?:Z|[+-]\d\d:\d\d)$/.test(value) ? "" : "Z"));
  if (!Number.isFinite(date.valueOf())) invalid();
  return date.toISOString();
}
/** Computes ownership date in the snapshot timezone, never the server timezone. */
export function localDateAt(value: string, timezone: string): string {
  const parts = new Intl.DateTimeFormat("en", { timeZone: timezone, year: "numeric", month: "2-digit", day: "2-digit" }).formatToParts(new Date(value));
  const part = (type: string) => parts.find((p) => p.type === type)!.value;
  return `${part("year")}-${part("month")}-${part("day")}`;
}
const minutes = (value: unknown) => { const n = numeric(value, 0, 86_400); return n === null ? null : Math.round(n / 60); };
/** Extracts only named sleep fields, keeping optional recommendations and naps separate. */
export function sleepDetails(sleep: Row): SleepObservationDetail | null {
  const total = minutes(sleep.sleepTimeSeconds);
  if (total === null) return null;
  const qualifier = sleep.breathingDisruptionSeverity;
  if (qualifier != null && !["NONE", "LOW", "MEDIUM", "HIGH", "UNMEASURABLE"].includes(String(qualifier))) invalid();
  // SleepAlignment names minutes explicitly. The approved metadata-only audit found
  // SleepNeed.baseline equal to alignment minutes across all 14 comparable days;
  // actual and next-day values use the same DTO unit (bounded minutes).
  const alignment = optionalRecord(sleep.sleepAlignment), need = optionalRecord(sleep.sleepNeed), nextNeed = optionalRecord(sleep.nextSleepNeed);
  return { type: "sleep", sleepKind: "main_sleep", totalSleepMinutes: total, sleepQuality: null,
    deepSleepMinutes: minutes(sleep.deepSleepSeconds), lightSleepMinutes: minutes(sleep.lightSleepSeconds),
    remSleepMinutes: minutes(sleep.remSleepSeconds), awakeSleepMinutes: minutes(sleep.awakeSleepSeconds),
    sleepNeedBaselineMinutes: numeric(need.baseline ?? alignment.sleepNeedBaselineMins, 0, 1440),
    sleepNeedMinutes: numeric(need.actual, 0, 1440), nextSleepNeedMinutes: numeric(nextNeed.actual, 0, 1440),
    nextSleepNeedBaselineMinutes: numeric(nextNeed.baseline, 0, 1440),
    breathingDisruptionSeverity: qualifier == null ? null : qualifier as NonNullable<SleepObservationDetail["breathingDisruptionSeverity"]> };
}
/** Validates real nap intervals; no interval is inferred from a daily duration. */
export function naps(sleep: Row, date: string, timezone: string): NonNullable<ProviderWellnessRecord["naps"]> {
  if (sleep.dailyNapDTOS == null) return [];
  if (!Array.isArray(sleep.dailyNapDTOS) || sleep.dailyNapDTOS.length > 100) invalid();
  const seen = new Set<string>();
  return sleep.dailyNapDTOS.flatMap((value) => {
    const nap = record(value);
    if (nap.calendarDate != null && nap.calendarDate !== date) invalid();
    if (nap.napStartTimestampGMT == null || nap.napEndTimestampGMT == null) return [];
    const start = instant(nap.napStartTimestampGMT), end = instant(nap.napEndTimestampGMT);
    const totalSleepMinutes = minutes(nap.napTimeSec);
    if (Date.parse(end) <= Date.parse(start) || Date.parse(end) - Date.parse(start) > 86_400_000 || localDateAt(start, timezone) !== date || seen.has(start)) invalid();
    seen.add(start);
    if (totalSleepMinutes === null) return [];
    return [{ identity: start, observedFrom: start, observedUntil: end, totalSleepMinutes }];
  });
}
/** Projects objective daily metrics without substituting them for overnight or subjective values. */
export function dailyMetrics(summary: Row): readonly MetricObservationDetail[] {
  const result: MetricObservationDetail[] = [];
  const add = (metric: MetricObservationDetail["metric"], unit: MetricObservationDetail["unit"], value: unknown, max: number, divisor = 1) => {
    const n = numeric(value, 0, max * divisor);
    if (n !== null) result.push({ type: "metric", metric, unit, value: n / divisor });
  };
  const stress = optionalRecord(summary.stress), battery = optionalRecord(summary.bodyBattery), respiration = optionalRecord(summary.respiration), oxygen = optionalRecord(summary.pulseOx);
  add("stress_average", "score", stress.avgLevel, 100); add("stress_maximum", "score", stress.maxLevel, 100);
  for (const [key, field] of [["rest", "restDurationInMillis"], ["low", "lowStressDurationInMillis"], ["medium", "mediumStressDurationInMillis"], ["high", "highStressDurationInMillis"], ["activity", "activityDurationInMillis"], ["uncategorized", "uncategorizedDurationInMillis"]] as const) {
    add(`stress_${key}_minutes`, "minute", stress[field], 1440, 60_000);
  }
  add("body_battery_charged", "score", battery.chargedValue, 1000); add("body_battery_drained", "score", battery.drainedValue, 1000);
  for (const [metric, field] of [["daily_respiration_rate", "avgValue"], ["daily_respiration_rate_minimum", "minValue"], ["daily_respiration_rate_maximum", "maxValue"]] as const) {
    if (respiration[field] != null && respiration[field] !== 0) add(metric, "breaths_per_minute", respiration[field], 100);
  }
  add("daily_oxygen_saturation", "percent", oxygen.avgValue, 100); add("daily_minimum_oxygen_saturation", "percent", oxygen.minValue, 100);
  return result;
}
/** Reads the final genuine sample by documented descriptor indices, with no fetch-time replacement. */
export function bodyBatteryPoint(report: unknown, date: string, timezone: string): Exclude<ProviderWellnessRecord["bodyBatteryInstant"], undefined> {
  if (report == null) return null;
  if (!Array.isArray(report) || report.length > 31) invalid();
  let latest: { observedAt: string; value: number } | null = null;
  for (const raw of report) {
    const row = record(raw);
    if (row.date !== date) invalid();
    const descriptors = row.bodyBatteryValueDescriptorDTOList, values = row.bodyBatteryValuesArray;
    if (descriptors == null && values == null) continue;
    if (!Array.isArray(descriptors) || !Array.isArray(values) || values.length > 10000) invalid();
    const indices = new Map<string, number>();
    for (const rawDescriptor of descriptors) {
      const d = record(rawDescriptor), key = d.bodyBatteryValueDescriptorKey, index = d.bodyBatteryValueDescriptorIndex;
      if (typeof key !== "string" || !Number.isInteger(index) || (index as number) < 0 || (index as number) > 100 || indices.has(key)) invalid();
      indices.set(key, index as number);
    }
    const ti = indices.get("timestamp"), vi = indices.get("bodyBatteryLevel");
    if (ti === undefined || vi === undefined) { if (values.length) invalid(); continue; }
    let previous = -Infinity;
    for (const sample of values) {
      if (!Array.isArray(sample)) invalid();
      if (sample[ti] == null || sample[vi] == null) continue;
      const timestamp = sample[ti];
      if (typeof timestamp !== "number" || !Number.isSafeInteger(timestamp) || timestamp < previous) invalid();
      previous = timestamp;
      const observedAt = instant(timestamp), value = numeric(sample[vi], 0, 100);
      if (value === null || localDateAt(observedAt, timezone) !== date) continue;
      if (!latest || observedAt > latest.observedAt) latest = { observedAt, value };
    }
  }
  return latest;
}
/** Builds independent authoritative groups from the primary v2 daily source. */
export function connectedDay(summary: Row, date: string, timezone: string): ProviderConnectedDayRecord {
  const energy = optionalRecord(summary.calories), movement = optionalRecord(summary.movement), intensity = optionalRecord(summary.intensityMinutes), hydration = optionalRecord(summary.hydration);
  return { identity: date, localDate: date, timezone,
    fitness: { energyMovement: {
      restingExpenditureKcal: numeric(energy.burnedResting), activeExpenditureKcal: numeric(energy.burnedActive), totalExpenditureKcal: numeric(energy.burnedTotal),
      movementDistanceMeters: numeric(optionalRecord(movement.steps).distanceInMeters), floorsUp: numeric(optionalRecord(movement.floorsAscended).value), floorsDown: numeric(optionalRecord(movement.floorsDescended).value),
      moderateMinutes: numeric(intensity.moderate, 0, 1440), vigorousMinutes: numeric(intensity.vigorous, 0, 1440) } },
    nutrition: { hydration: { consumedFluidMl: numeric(hydration.consumedInFractionalMl) } } };
}
/** Only measured intake is imported; goals and empty food logs do not imply zero consumption. */
export function nutritionIntake(value: unknown, date: string): Exclude<NonNullable<ProviderConnectedDayRecord["nutrition"]>["intake"], undefined> {
  if (value == null) return null;
  const row = record(value);
  if (row.mealDate != null && row.mealDate !== date) invalid();
  const content = optionalRecord(row.dailyNutritionContent);
  const values = { consumedCaloriesKcal: numeric(content.calories), proteinGrams: numeric(content.protein), fatGrams: numeric(content.fat), carbohydrateGrams: numeric(content.carbs) };
  if (!Object.values(values).some((v) => v !== null)) return null;
  const foods = row.loggedFoodsWithServingSizes, meals = row.mealDetails;
  if ((foods != null && !Array.isArray(foods)) || (meals != null && !Array.isArray(meals))) invalid();
  const hasFood = Array.isArray(foods) && foods.length > 0 || Array.isArray(meals) && meals.some((m) => Array.isArray(record(m).loggedFoods) && (record(m).loggedFoods as unknown[]).length > 0);
  return hasFood || Object.values(values).some((v) => v !== null && v > 0) ? values : null;
}
/** Imports official kg weight and composition with verified units only; mass units are deliberately not guessed. */
export function bodyMeasurements(value: unknown, dates: readonly string[], timezone: string): readonly ProviderBodyMeasurementRecord[] {
  if (value == null) return [];
  if (!Array.isArray(value) || value.length > 10000) invalid();
  const seen = new Set<string>();
  return value.flatMap((raw) => {
    const row = record(raw), measuredAt = row.timestampGMT == null ? null : instant(row.timestampGMT);
    const localDate = measuredAt ? localDateAt(measuredAt, timezone) : row.calendarDate;
    if (typeof localDate !== "string" || !dates.includes(localDate)) invalid();
    const weightKg = numeric(row.weight, 0.5, 700);
    // The public DTO does not declare units for bodyFat/bodyWater/muscleMass/boneMass.
    const composition = { bodyFatPercent: null, bodyWaterPercent: null, muscleMassKg: null, boneMassKg: null, bmi: numeric(row.bmi, 0, 200) };
    if (weightKg === null && composition.bmi === null) return [];
    const identity = measuredAt ?? `date:${localDate}`;
    if (seen.has(identity)) invalid(); seen.add(identity);
    return [{ identity, localDate, timezone, measuredAt, weightKg, composition: composition.bmi === null ? null : composition }];
  });
}
function invalid(): never { throw new IntegrationProviderError("provider_response_invalid"); }
