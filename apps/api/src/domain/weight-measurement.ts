import type {
  CreateWeightMeasurement,
  WeightMeasurement
} from "@shape-of-you/contracts";

import type {
  NewWeightMeasurementRow,
  WeightMeasurementRow
} from "../database/schema.js";
import { DomainValidationError } from "./errors.js";

/**
 * Derives the calendar date of a measurement in its declared IANA timezone.
 *
 * @param measuredAt - Measurement instant.
 * @param timezone - IANA timezone used for the local calendar projection.
 * @returns Local date in `YYYY-MM-DD` format.
 * @throws DomainValidationError when the timezone or derived date is invalid.
 */
export function deriveLocalDate(
  measuredAt: Date,
  timezone: string
): string {
  let parts: Intl.DateTimeFormatPart[];

  try {
    parts = new Intl.DateTimeFormat("en-CA", {
      timeZone: timezone,
      year: "numeric",
      month: "2-digit",
      day: "2-digit"
    }).formatToParts(measuredAt);
  } catch {
    throw new DomainValidationError(
      `timezone must be a valid IANA timezone: ${timezone}`
    );
  }

  const values = Object.fromEntries(
    parts.map((part) => [part.type, part.value])
  );

  if (!values.year || !values.month || !values.day) {
    throw new DomainValidationError("localDate could not be derived");
  }

  return `${values.year}-${values.month}-${values.day}`;
}

/**
 * Converts validated API input into the row owned by the persistence layer.
 *
 * @param input - Validated WeightMeasurement creation contract.
 * @returns Insertable row with derived local date and normalized numerics.
 * @throws DomainValidationError when the measurement instant is invalid.
 */
export function toNewWeightMeasurement(
  input: CreateWeightMeasurement
): NewWeightMeasurementRow {
  const measuredAt = new Date(input.measuredAt);

  if (Number.isNaN(measuredAt.valueOf())) {
    throw new DomainValidationError("measuredAt must be a valid instant");
  }

  return {
    measuredAt,
    localDate: deriveLocalDate(measuredAt, input.timezone),
    timezone: input.timezone,
    weightKg: input.weightKg.toFixed(3),
    source: input.source,
    sourceRecordId: input.sourceRecordId ?? null,
    dedupeKey: input.dedupeKey,
    confidence:
      input.confidence == null ? null : input.confidence.toFixed(3),
    provenance: input.provenance
  };
}

/**
 * Converts a persisted WeightMeasurement row into its public API contract.
 *
 * @param row - Row read from the API-owned PostgreSQL schema.
 * @returns Serialized immutable WeightMeasurement.
 */
export function toWeightMeasurement(
  row: WeightMeasurementRow
): WeightMeasurement {
  return {
    id: row.id,
    measuredAt: row.measuredAt.toISOString(),
    localDate: row.localDate,
    timezone: row.timezone,
    weightKg: Number(row.weightKg),
    source: row.source,
    sourceRecordId: row.sourceRecordId,
    dedupeKey: row.dedupeKey,
    confidence: row.confidence === null ? null : Number(row.confidence),
    provenance: row.provenance,
    createdAt: row.createdAt.toISOString()
  };
}
