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

const nullableConfidenceSchema = {
  anyOf: [
    { type: "number", minimum: 0, maximum: 1, multipleOf: 0.001 },
    { type: "null" }
  ]
} as const;

const weightValueSchema = {
  type: "number",
  minimum: 0.5,
  maximum: 700,
  multipleOf: 0.001
} as const;

const nullableInstantSchema = {
  anyOf: [
    { type: "string", format: "date-time" },
    { type: "null" }
  ]
} as const;

export const WeightMeasurementSchema = {
  $id: "WeightMeasurement",
  type: "object",
  additionalProperties: false,
  required: [
    "id",
    "personId",
    "measuredAt",
    "temporalPrecision",
    "localDate",
    "timezone",
    "weightKg",
    "sourceReference",
    "dedupeKey",
    "confidence",
    "supersedesId",
    "correctionReason",
    "createdAt"
  ],
  properties: {
    id: { type: "string", format: "uuid" },
    personId: { type: "string", format: "uuid" },
    measuredAt: nullableInstantSchema,
    temporalPrecision: { enum: ["instant", "local_date"] },
    localDate: { type: "string", format: "date" },
    timezone: { type: "string", minLength: 1, maxLength: 64 },
    weightKg: weightValueSchema,
    sourceReference: SourceReferenceSchema,
    dedupeKey: { type: "string", minLength: 1, maxLength: 256 },
    confidence: nullableConfidenceSchema,
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

/** Immutable person-owned weight fact. */
export type WeightMeasurement = FromSchema<typeof WeightMeasurementSchema>;

export const CreateWeightMeasurementSchema = {
  $id: "CreateWeightMeasurement",
  type: "object",
  additionalProperties: false,
  required: [
    "measuredAt",
    "timezone",
    "weightKg",
    "sourceReference",
    "dedupeKey"
  ],
  properties: {
    measuredAt: { type: "string", format: "date-time" },
    timezone: { type: "string", minLength: 1, maxLength: 64 },
    weightKg: weightValueSchema,
    sourceReference: SourceReferenceInputSchema,
    dedupeKey: { type: "string", minLength: 1, maxLength: 256 },
    confidence: nullableConfidenceSchema
  }
} as const;

/** Command contract for idempotent weight fact creation. */
export type CreateWeightMeasurement = FromSchema<
  typeof CreateWeightMeasurementSchema
>;

export const CorrectWeightMeasurementSchema = {
  $id: "CorrectWeightMeasurement",
  type: "object",
  additionalProperties: false,
  required: [
    "measuredAt",
    "timezone",
    "weightKg",
    "sourceReference",
    "dedupeKey",
    "reason"
  ],
  properties: {
    measuredAt: { type: "string", format: "date-time" },
    timezone: { type: "string", minLength: 1, maxLength: 64 },
    weightKg: weightValueSchema,
    sourceReference: SourceReferenceInputSchema,
    dedupeKey: { type: "string", minLength: 1, maxLength: 256 },
    confidence: nullableConfidenceSchema,
    reason: { type: "string", minLength: 1, maxLength: 512 }
  }
} as const;

/** Full replacement snapshot used to correct an immutable weight fact. */
export type CorrectWeightMeasurement = FromSchema<
  typeof CorrectWeightMeasurementSchema
>;

export const WeightMeasurementIdParamsSchema = {
  $id: "WeightMeasurementIdParams",
  type: "object",
  additionalProperties: false,
  required: ["id"],
  properties: {
    id: { type: "string", format: "uuid" }
  }
} as const;

export type WeightMeasurementIdParams = FromSchema<
  typeof WeightMeasurementIdParamsSchema
>;

export const ListWeightMeasurementsQuerySchema = {
  $id: "ListWeightMeasurementsQuery",
  type: "object",
  additionalProperties: false,
  properties: {
    limit: { type: "integer", minimum: 1, maximum: 100, default: 50 },
    cursor: { type: "string", minLength: 1, maxLength: 1024 }
  }
} as const;

export type ListWeightMeasurementsQuery = FromSchema<
  typeof ListWeightMeasurementsQuerySchema
>;

export const WeightMeasurementListSchema = {
  $id: "WeightMeasurementList",
  type: "object",
  additionalProperties: false,
  required: ["items", "nextCursor"],
  properties: {
    items: {
      type: "array",
      items: WeightMeasurementSchema
    },
    nextCursor: {
      anyOf: [
        { type: "string", minLength: 1 },
        { type: "null" }
      ]
    }
  }
} as const;

export type WeightMeasurementList = FromSchema<
  typeof WeightMeasurementListSchema
>;

export const WeightMeasurementHistorySchema = {
  $id: "WeightMeasurementHistory",
  type: "object",
  additionalProperties: false,
  required: ["items"],
  properties: {
    items: {
      type: "array",
      minItems: 1,
      items: WeightMeasurementSchema
    }
  }
} as const;

/** Ordered complete supersession chain for a weight fact. */
export type WeightMeasurementHistory = FromSchema<
  typeof WeightMeasurementHistorySchema
>;
