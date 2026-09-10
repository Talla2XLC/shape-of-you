import { createHash } from "node:crypto";

import type {
  ProviderActivityRecord,
  ProviderWellnessRecord
} from "../provider.js";
import { IntegrationProviderError } from "../provider.js";

type JsonRecord = Record<string, unknown>;

const datePattern = /^\d{4}-\d{2}-\d{2}$/u;

/** Deterministic checksum over one typed normalized fact, never raw transport JSON. */
export function normalizedChecksum(value: object): string {
  return createHash("sha256").update(stableJson(value)).digest("hex");
}

/** Validates and narrows one Intervals.icu wellness record. */
export function normalizeIntervalsWellness(value: unknown): ProviderWellnessRecord {
  const record = asRecord(value);
  const localDate = requiredString(record, "id", 10);
  if (!datePattern.test(localDate)) invalid();
  return {
    identity: localDate,
    localDate,
    timezone: optionalString(record, "timezone", 64) ?? "UTC",
    totalSleepMinutes: secondsToMinutes(optionalNumber(record, "sleepSecs", 0, 172_800)),
    sleepScore: optionalNumber(record, "sleepScore", 0, 100),
    restingHeartRate: optionalNumber(record, "restingHR", 0, 300),
    hrvRmssd: optionalNumber(record, "hrv", 0, 1_000),
    bodyBattery: optionalNumber(record, "bodyBattery", 0, 100)
  };
}

/** Validates and narrows one Intervals.icu activity summary. */
export function normalizeIntervalsActivity(value: unknown): ProviderActivityRecord {
  const record = asRecord(value);
  const identity = requiredString(record, "id", 128);
  const occurredAt = requiredString(record, "start_date", 64);
  const instant = new Date(occurredAt);
  if (Number.isNaN(instant.valueOf())) invalid();
  const localDateCandidate = optionalString(record, "start_date_local", 64)?.slice(0, 10);
  const localDate = localDateCandidate && datePattern.test(localDateCandidate)
    ? localDateCandidate
    : occurredAt.slice(0, 10);
  const deviceName = optionalString(record, "device_name", 256);
  return {
    identity,
    occurredAt: instant.toISOString(),
    localDate,
    timezone: optionalString(record, "timezone", 64) ?? "UTC",
    name: requiredString(record, "name", 256),
    durationSeconds: optionalNumber(record, "moving_time", 0, 604_800)
      ?? requiredNumber(record, "elapsed_time", 0, 604_800),
    distanceMeters: optionalNumber(record, "distance", 0, 10_000_000),
    trainingLoad: optionalNumber(record, "icu_training_load", 0, 100_000),
    averageHeartRate: optionalNumber(record, "average_heartrate", 0, 300),
    maximumHeartRate: optionalNumber(record, "max_heartrate", 0, 300),
    deviceName,
    garminAttributed: deviceName !== null && /\bgarmin(?:\s|$)/iu.test(deviceName)
  };
}

function stableJson(value: unknown): string {
  if (Array.isArray(value)) return `[${value.map(stableJson).join(",")}]`;
  if (value && typeof value === "object") {
    return `{${Object.entries(value as JsonRecord).sort(([a], [b]) => a.localeCompare(b)).map(([key, item]) => `${JSON.stringify(key)}:${stableJson(item)}`).join(",")}}`;
  }
  return JSON.stringify(value);
}

function asRecord(value: unknown): JsonRecord {
  if (!value || typeof value !== "object" || Array.isArray(value)) invalid();
  return value as JsonRecord;
}
function requiredString(record: JsonRecord, key: string, max: number): string {
  const value = record[key];
  if (typeof value !== "string" || value.length === 0 || value.length > max) invalid();
  return value;
}
function optionalString(record: JsonRecord, key: string, max: number): string | null {
  const value = record[key];
  if (value === undefined || value === null) return null;
  if (typeof value !== "string" || value.length === 0 || value.length > max) invalid();
  return value;
}
function requiredNumber(record: JsonRecord, key: string, min: number, max: number): number {
  const value = optionalNumber(record, key, min, max);
  if (value === null) invalid();
  return value;
}
function optionalNumber(record: JsonRecord, key: string, min: number, max: number): number | null {
  const value = record[key];
  if (value === undefined || value === null) return null;
  if (typeof value !== "number" || !Number.isFinite(value) || value < min || value > max) invalid();
  return value;
}
function secondsToMinutes(value: number | null): number | null {
  return value === null ? null : Math.round(value / 60);
}
function invalid(): never {
  throw new IntegrationProviderError("provider_response_invalid");
}
