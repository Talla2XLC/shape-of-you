import type { FromSchema } from "json-schema-to-ts";

import {
  SourceReferenceInputSchema,
  SourceReferenceSchema
} from "./source-reference.js";

const uuidSchema = { type: "string", format: "uuid" } as const;
const localDateSchema = { type: "string", format: "date" } as const;
const nullableConfidenceSchema = {
  anyOf: [
    { type: "number", minimum: 0, maximum: 1, multipleOf: 0.001 },
    { type: "null" }
  ]
} as const;

const noteInputProperties = {
  localDate: localDateSchema,
  timezone: { type: "string", minLength: 1, maxLength: 64 },
  text: { type: "string", minLength: 1, maxLength: 4_000 },
  sourceReference: SourceReferenceInputSchema,
  dedupeKey: { type: "string", minLength: 1, maxLength: 256 },
  confidence: nullableConfidenceSchema
} as const;

export const DailyContextNoteSchema = {
  $id: "DailyContextNote",
  type: "object",
  additionalProperties: false,
  required: [
    "id",
    "personId",
    "localDate",
    "timezone",
    "text",
    "sourceReference",
    "dedupeKey",
    "confidence",
    "supersedesId",
    "correctionReason",
    "createdAt"
  ],
  properties: {
    id: uuidSchema,
    personId: uuidSchema,
    ...noteInputProperties,
    sourceReference: SourceReferenceSchema,
    supersedesId: { anyOf: [uuidSchema, { type: "null" }] },
    correctionReason: {
      anyOf: [
        { type: "string", minLength: 1, maxLength: 512 },
        { type: "null" }
      ]
    },
    createdAt: { type: "string", format: "date-time" }
  }
} as const;

/** Immutable Person-owned context note for one local calendar date. */
export type DailyContextNote = FromSchema<typeof DailyContextNoteSchema>;

export const CreateDailyContextNoteSchema = {
  $id: "CreateDailyContextNote",
  type: "object",
  additionalProperties: false,
  required: [
    "localDate",
    "timezone",
    "text",
    "sourceReference",
    "dedupeKey"
  ],
  properties: noteInputProperties
} as const;

/** Idempotent command creating one DailyContextNote. */
export type CreateDailyContextNote = FromSchema<
  typeof CreateDailyContextNoteSchema
>;

export const CorrectDailyContextNoteSchema = {
  $id: "CorrectDailyContextNote",
  type: "object",
  additionalProperties: false,
  required: [
    "localDate",
    "timezone",
    "text",
    "sourceReference",
    "dedupeKey",
    "reason"
  ],
  properties: {
    ...noteInputProperties,
    reason: { type: "string", minLength: 1, maxLength: 512 }
  }
} as const;

/** Full replacement command for append-only DailyContextNote correction. */
export type CorrectDailyContextNote = FromSchema<
  typeof CorrectDailyContextNoteSchema
>;

export const ListDailyContextNotesQuerySchema = {
  $id: "ListDailyContextNotesQuery",
  type: "object",
  additionalProperties: false,
  required: ["localDate"],
  properties: { localDate: localDateSchema }
} as const;

/** Exact Person-local date query for current context notes. */
export type ListDailyContextNotesQuery = FromSchema<
  typeof ListDailyContextNotesQuerySchema
>;

export const DailyContextNoteListSchema = {
  $id: "DailyContextNoteList",
  type: "object",
  additionalProperties: false,
  required: ["items"],
  properties: {
    items: { type: "array", items: DailyContextNoteSchema }
  }
} as const;

/** Current context notes for one Person-local date. */
export type DailyContextNoteList = FromSchema<
  typeof DailyContextNoteListSchema
>;

export const DailyContextNoteIdParamsSchema = {
  $id: "DailyContextNoteIdParams",
  type: "object",
  additionalProperties: false,
  required: ["id"],
  properties: { id: uuidSchema }
} as const;

/** Path parameters selecting one DailyContextNote. */
export type DailyContextNoteIdParams = FromSchema<
  typeof DailyContextNoteIdParamsSchema
>;

export const DailyContextNoteHistorySchema = {
  $id: "DailyContextNoteHistory",
  type: "object",
  additionalProperties: false,
  required: ["items"],
  properties: {
    items: { type: "array", minItems: 1, items: DailyContextNoteSchema }
  }
} as const;

/** Original-to-current append-only DailyContextNote correction chain. */
export type DailyContextNoteHistory = FromSchema<
  typeof DailyContextNoteHistorySchema
>;
