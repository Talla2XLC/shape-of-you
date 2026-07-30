import type {
  CorrectWeightMeasurement,
  CreateWeightMeasurement,
  WeightMeasurement
} from "@shape-of-you/contracts";

import type {
  NewWeightMeasurementRow,
  SourceReferenceRow,
  WeightMeasurementRow
} from "../database/schema.js";
import { DomainValidationError } from "./errors.js";
import { toSourceReference } from "./source-reference.js";

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
 * @param personId - UUID of the Person that owns the fact.
 * @param sourceReferenceId - UUID of the persisted provenance record.
 * @param input - Validated WeightMeasurement creation contract.
 * @param correction - Optional supersession link and mandatory correction reason.
 * @returns Insertable row with derived local date and normalized numerics.
 * @throws DomainValidationError when the measurement instant is invalid.
 */
export function toNewWeightMeasurement(
  personId: string,
  sourceReferenceId: string,
  input: CreateWeightMeasurement | CorrectWeightMeasurement,
  correction?: {
    readonly supersedesId: string;
    readonly reason: string;
  }
): NewWeightMeasurementRow {
  const measuredAt = new Date(input.measuredAt);

  if (Number.isNaN(measuredAt.valueOf())) {
    throw new DomainValidationError("measuredAt must be a valid instant");
  }

  return {
    personId,
    measuredAt,
    localDate: deriveLocalDate(measuredAt, input.timezone),
    timezone: input.timezone,
    weightKg: input.weightKg.toFixed(3),
    source: input.sourceReference.channel,
    sourceReferenceId,
    dedupeKey: input.dedupeKey,
    confidence:
      input.confidence == null ? null : input.confidence.toFixed(3),
    supersedesId: correction?.supersedesId ?? null,
    correctionReason: correction?.reason ?? null
  };
}

/**
 * Converts a persisted WeightMeasurement row into its public API contract.
 *
 * @param row - Row read from the API-owned PostgreSQL schema.
 * @param sourceReference - Typed provenance owned by the same Person.
 * @returns Serialized immutable WeightMeasurement.
 */
export function toWeightMeasurement(
  row: WeightMeasurementRow,
  sourceReference: SourceReferenceRow
): WeightMeasurement {
  return {
    id: row.id,
    personId: row.personId,
    measuredAt: row.measuredAt.toISOString(),
    localDate: row.localDate,
    timezone: row.timezone,
    weightKg: Number(row.weightKg),
    sourceReference: toSourceReference(sourceReference),
    dedupeKey: row.dedupeKey,
    confidence: row.confidence === null ? null : Number(row.confidence),
    supersedesId: row.supersedesId,
    correctionReason: row.correctionReason,
    createdAt: row.createdAt.toISOString()
  };
}
