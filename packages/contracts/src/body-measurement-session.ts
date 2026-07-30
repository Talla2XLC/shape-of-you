import type { FromSchema } from "json-schema-to-ts";

import {
  SourceReferenceInputSchema,
  SourceReferenceSchema
} from "./source-reference.js";

const nullableUuidSchema = {
  anyOf: [
    { type: "string", format: "uuid" },
    { type: "null" }
  ]
} as const;

const nullableStringSchema = {
  anyOf: [
    { type: "string", minLength: 1, maxLength: 4096 },
    { type: "null" }
  ]
} as const;

const nullableConfidenceSchema = {
  anyOf: [
    { type: "number", minimum: 0, maximum: 1, multipleOf: 0.001 },
    { type: "null" }
  ]
} as const;

export const BodyMeasurementMetricSchema = {
  type: "string",
  enum: ["waist", "chest", "hips", "thigh", "biceps"]
} as const;

export const BodyMeasurementValueInputSchema = {
  type: "object",
  additionalProperties: false,
  required: ["metric", "value", "unit"],
  properties: {
    metric: BodyMeasurementMetricSchema,
    value: {
      type: "number",
      minimum: 1,
      maximum: 500,
      multipleOf: 0.01
    },
    unit: { type: "string", enum: ["cm"] }
  }
} as const;

export type BodyMeasurementValueInput = FromSchema<
  typeof BodyMeasurementValueInputSchema
>;

export const BodyMeasurementSessionSchema = {
  $id: "BodyMeasurementSession",
  type: "object",
  additionalProperties: false,
  required: [
    "id",
    "personId",
    "measuredAt",
    "localDate",
    "timezone",
    "values",
    "sourceReference",
    "dedupeKey",
    "confidence",
    "photoMediaId",
    "note",
    "supersedesId",
    "correctionReason",
    "createdAt"
  ],
  properties: {
    id: { type: "string", format: "uuid" },
    personId: { type: "string", format: "uuid" },
    measuredAt: { type: "string", format: "date-time" },
    localDate: { type: "string", format: "date" },
    timezone: { type: "string", minLength: 1, maxLength: 64 },
    values: {
      type: "array",
      minItems: 1,
      maxItems: 5,
      items: BodyMeasurementValueInputSchema
    },
    sourceReference: SourceReferenceSchema,
    dedupeKey: { type: "string", minLength: 1, maxLength: 256 },
    confidence: nullableConfidenceSchema,
    photoMediaId: nullableUuidSchema,
    note: nullableStringSchema,
    supersedesId: nullableUuidSchema,
    correctionReason: {
      anyOf: [
        { type: "string", minLength: 1, maxLength: 512 },
        { type: "null" }
      ]
    },
    createdAt: { type: "string", format: "date-time" }
  }
} as const;

/** Immutable aggregate representing one body measurement session. */
export type BodyMeasurementSession = FromSchema<
  typeof BodyMeasurementSessionSchema
>;

const bodyMeasurementSessionInputProperties = {
  measuredAt: { type: "string", format: "date-time" },
  timezone: { type: "string", minLength: 1, maxLength: 64 },
  values: {
    type: "array",
    minItems: 1,
    maxItems: 5,
    items: BodyMeasurementValueInputSchema
  },
  sourceReference: SourceReferenceInputSchema,
  dedupeKey: { type: "string", minLength: 1, maxLength: 256 },
  confidence: nullableConfidenceSchema,
  photoMediaId: nullableUuidSchema,
  note: nullableStringSchema
} as const;

export const CreateBodyMeasurementSessionSchema = {
  $id: "CreateBodyMeasurementSession",
  type: "object",
  additionalProperties: false,
  required: [
    "measuredAt",
    "timezone",
    "values",
    "sourceReference",
    "dedupeKey"
  ],
  properties: bodyMeasurementSessionInputProperties
} as const;

/** Command for idempotent creation of a body measurement session. */
export type CreateBodyMeasurementSession = FromSchema<
  typeof CreateBodyMeasurementSessionSchema
>;

export const CorrectBodyMeasurementSessionSchema = {
  $id: "CorrectBodyMeasurementSession",
  type: "object",
  additionalProperties: false,
  required: [
    "measuredAt",
    "timezone",
    "values",
    "sourceReference",
    "dedupeKey",
    "reason"
  ],
  properties: {
    ...bodyMeasurementSessionInputProperties,
    reason: { type: "string", minLength: 1, maxLength: 512 }
  }
} as const;

/** Full replacement snapshot used for append-only session correction. */
export type CorrectBodyMeasurementSession = FromSchema<
  typeof CorrectBodyMeasurementSessionSchema
>;

export const BodyMeasurementSessionIdParamsSchema = {
  $id: "BodyMeasurementSessionIdParams",
  type: "object",
  additionalProperties: false,
  required: ["id"],
  properties: {
    id: { type: "string", format: "uuid" }
  }
} as const;

export type BodyMeasurementSessionIdParams = FromSchema<
  typeof BodyMeasurementSessionIdParamsSchema
>;

export const ListBodyMeasurementSessionsQuerySchema = {
  $id: "ListBodyMeasurementSessionsQuery",
  type: "object",
  additionalProperties: false,
  properties: {
    limit: { type: "integer", minimum: 1, maximum: 100, default: 50 },
    cursor: { type: "string", minLength: 1, maxLength: 1024 },
    metric: BodyMeasurementMetricSchema
  }
} as const;

export type ListBodyMeasurementSessionsQuery = FromSchema<
  typeof ListBodyMeasurementSessionsQuerySchema
>;

export const BodyMeasurementSessionListSchema = {
  $id: "BodyMeasurementSessionList",
  type: "object",
  additionalProperties: false,
  required: ["items", "nextCursor"],
  properties: {
    items: {
      type: "array",
      items: BodyMeasurementSessionSchema
    },
    nextCursor: {
      anyOf: [
        { type: "string", minLength: 1 },
        { type: "null" }
      ]
    }
  }
} as const;

export type BodyMeasurementSessionList = FromSchema<
  typeof BodyMeasurementSessionListSchema
>;

export const BodyMeasurementSessionHistorySchema = {
  $id: "BodyMeasurementSessionHistory",
  type: "object",
  additionalProperties: false,
  required: ["items"],
  properties: {
    items: {
      type: "array",
      minItems: 1,
      items: BodyMeasurementSessionSchema
    }
  }
} as const;

export type BodyMeasurementSessionHistory = FromSchema<
  typeof BodyMeasurementSessionHistorySchema
>;
