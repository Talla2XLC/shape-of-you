import type {
  BodyMeasurementSession,
  BodyMeasurementValueInput,
  CorrectBodyMeasurementSession,
  CreateBodyMeasurementSession
} from "@shape-of-you/contracts";

import type {
  BodyMeasurementSessionRow,
  BodyMeasurementValueRow,
  NewBodyMeasurementSessionRow,
  SourceReferenceRow
} from "../database/schema.js";
import { DomainValidationError } from "./errors.js";
import { toSourceReference } from "./source-reference.js";
import { deriveLocalDate } from "./weight-measurement.js";

/**
 * Validates that a body session contains each controlled metric at most once.
 *
 * @param values - Validated transport values.
 * @throws DomainValidationError when a metric is duplicated.
 */
export function validateBodyMeasurementValues(
  values: readonly BodyMeasurementValueInput[]
): void {
  const metrics = new Set<string>();
  for (const value of values) {
    if (metrics.has(value.metric)) {
      throw new DomainValidationError(
        `body measurement metric is duplicated: ${value.metric}`
      );
    }
    metrics.add(value.metric);
  }
}

/**
 * Converts a session command into an insertable aggregate root.
 *
 * @param personId - UUID of the Person that owns the session.
 * @param sourceReferenceId - UUID of persisted typed provenance.
 * @param input - Validated creation or correction command.
 * @param correction - Optional supersession metadata.
 * @returns Insertable session root with derived local date.
 */
export function toNewBodyMeasurementSession(
  personId: string,
  sourceReferenceId: string,
  input: CreateBodyMeasurementSession | CorrectBodyMeasurementSession,
  correction?: {
    readonly supersedesId: string;
    readonly reason: string;
  }
): NewBodyMeasurementSessionRow {
  validateBodyMeasurementValues(input.values);
  const measuredAt = new Date(input.measuredAt);
  if (Number.isNaN(measuredAt.valueOf())) {
    throw new DomainValidationError("measuredAt must be a valid instant");
  }

  return {
    personId,
    measuredAt,
    localDate: deriveLocalDate(measuredAt, input.timezone),
    timezone: input.timezone,
    source: input.sourceReference.channel,
    sourceReferenceId,
    dedupeKey: input.dedupeKey,
    confidence:
      input.confidence == null ? null : input.confidence.toFixed(3),
    photoMediaId: input.photoMediaId ?? null,
    note: input.note ?? null,
    supersedesId: correction?.supersedesId ?? null,
    correctionReason: correction?.reason ?? null
  };
}

/**
 * Serializes one persisted body measurement aggregate.
 *
 * @param row - Persisted aggregate root.
 * @param values - Typed values owned by the root.
 * @param sourceReference - Typed provenance owned by the same Person.
 * @returns Public immutable body session.
 */
export function toBodyMeasurementSession(
  row: BodyMeasurementSessionRow,
  values: readonly BodyMeasurementValueRow[],
  sourceReference: SourceReferenceRow
): BodyMeasurementSession {
  return {
    id: row.id,
    personId: row.personId,
    measuredAt: row.measuredAt.toISOString(),
    localDate: row.localDate,
    timezone: row.timezone,
    values: values
      .slice()
      .sort((left, right) => left.metric.localeCompare(right.metric))
      .map((value) => ({
        metric: value.metric,
        value: Number(value.value),
        unit: value.unit
      })),
    sourceReference: toSourceReference(sourceReference),
    dedupeKey: row.dedupeKey,
    confidence: row.confidence === null ? null : Number(row.confidence),
    photoMediaId: row.photoMediaId,
    note: row.note,
    supersedesId: row.supersedesId,
    correctionReason: row.correctionReason,
    createdAt: row.createdAt.toISOString()
  };
}
