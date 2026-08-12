import { createHash } from "node:crypto";

import type {
  DayClosureReference,
  DaySnapshot
} from "@shape-of-you/contracts";

import { DomainValidationError } from "./errors.js";

/** Current version of the deterministic daily-projection composition policy. */
export const DAY_CLOSURE_POLICY_VERSION = "daily-projection-v1";

/** Validates an explicit ISO calendar date without converting it through UTC. */
export function assertLocalDate(value: string): void {
  if (!/^\d{4}-\d{2}-\d{2}$/.test(value)) {
    throw new DomainValidationError("localDate must be an ISO calendar date");
  }
  const parts = value.split("-");
  const year = Number(parts[0]);
  const month = Number(parts[1]);
  const day = Number(parts[2]);
  if (![year, month, day].every(Number.isInteger)) {
    throw new DomainValidationError("localDate must be a valid calendar date");
  }
  const candidate = new Date(Date.UTC(year, month - 1, day));
  if (
    candidate.getUTCFullYear() !== year ||
    candidate.getUTCMonth() !== month - 1 ||
    candidate.getUTCDate() !== day
  ) {
    throw new DomainValidationError("localDate must be a valid calendar date");
  }
}

/** Validates that a timezone is an IANA name supported by the running runtime. */
export function assertIanaTimezone(value: string): void {
  try {
    new Intl.DateTimeFormat("en-US", { timeZone: value }).format();
  } catch {
    throw new DomainValidationError("timezone must be a valid IANA timezone");
  }
}

/** Produces a stable SHA-256 fingerprint independent of object key insertion order. */
export function fingerprint(value: unknown): string {
  return createHash("sha256")
    .update(JSON.stringify(normalize(value)))
    .digest("hex");
}

/** Collects typed fact and decision references from a fully typed snapshot. */
export function snapshotReferences(
  snapshot: DaySnapshot
): readonly DayClosureReference[] {
  return [
    ...snapshot.physical.weightMeasurements.map((item) => ({
      kind: "weight_measurement" as const,
      id: item.id
    })),
    ...snapshot.physical.bodyMeasurementSessions.map((item) => ({
      kind: "body_measurement_session" as const,
      id: item.id
    })),
    ...snapshot.nutrition.meals.map((item) => ({ kind: "meal" as const, id: item.id })),
    ...snapshot.training.workoutSessions.map((item) => ({
      kind: "workout_session" as const,
      id: item.id
    })),
    ...snapshot.recovery.observations.map((item) => ({
      kind: "recovery_observation" as const,
      id: item.id
    })),
    ...snapshot.recovery.assessments.map((item) => ({
      kind: "recovery_assessment" as const,
      id: item.id
    })),
    ...snapshot.coaching.recommendations.map((item) => ({
      kind: "coaching_recommendation" as const,
      id: item.id
    }))
  ];
}

function normalize(value: unknown): unknown {
  if (Array.isArray(value)) {
    return value.map(normalize);
  }
  if (value !== null && typeof value === "object") {
    return Object.fromEntries(
      Object.entries(value as Record<string, unknown>)
        .sort(([left], [right]) => left.localeCompare(right))
        .map(([key, item]) => [key, normalize(item)])
    );
  }
  return value;
}
