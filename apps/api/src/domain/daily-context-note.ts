import type {
  CorrectDailyContextNote,
  CreateDailyContextNote,
  DailyContextNote
} from "@shape-of-you/contracts";

import type {
  DailyContextNoteRow,
  NewDailyContextNoteRow,
  SourceReferenceRow
} from "../database/schema.js";
import { assertIanaTimezone, assertLocalDate } from "./date-context.js";
import { DomainValidationError } from "./errors.js";
import { toSourceReference } from "./source-reference.js";

/** Converts a validated command into an insertable DailyContextNote row. */
export function toNewDailyContextNote(
  personId: string,
  sourceReferenceId: string,
  input: CreateDailyContextNote | CorrectDailyContextNote,
  correction?: { readonly supersedesId: string; readonly reason: string }
): NewDailyContextNoteRow {
  assertLocalDate(input.localDate);
  assertIanaTimezone(input.timezone);
  const contextKind = input.contextKind ?? "general";
  const baselineEligibility =
    input.baselineEligibility ?? (contextKind === "travel" ? "exclude" : "include");
  if (
    (contextKind === "travel" && baselineEligibility !== "exclude") ||
    (contextKind === "general" && baselineEligibility !== "include")
  ) {
    throw new DomainValidationError(
      "DailyContextNote baseline eligibility is incompatible with context kind"
    );
  }
  return {
    personId,
    localDate: input.localDate,
    timezone: input.timezone,
    text: input.text,
    contextKind,
    baselineEligibility,
    source: input.sourceReference.channel,
    sourceReferenceId,
    dedupeKey: input.dedupeKey,
    confidence: input.confidence == null ? null : input.confidence.toFixed(3),
    supersedesId: correction?.supersedesId ?? null,
    correctionReason: correction?.reason ?? null
  };
}

/** Serializes one DailyContextNote and its Person-owned provenance. */
export function toDailyContextNote(
  row: DailyContextNoteRow,
  sourceReference: SourceReferenceRow
): DailyContextNote {
  return {
    id: row.id,
    personId: row.personId,
    localDate: row.localDate,
    timezone: row.timezone,
    text: row.text,
    contextKind: row.contextKind,
    baselineEligibility: row.baselineEligibility,
    sourceReference: toSourceReference(sourceReference),
    dedupeKey: row.dedupeKey,
    confidence: row.confidence === null ? null : Number(row.confidence),
    supersedesId: row.supersedesId,
    correctionReason: row.correctionReason,
    createdAt: row.createdAt.toISOString()
  };
}
