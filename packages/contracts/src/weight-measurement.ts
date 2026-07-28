import type { FromSchema } from "json-schema-to-ts";

export const WeightMeasurementSourceSchema = {
  type: "string",
  enum: ["manual", "google_sheets", "import"]
} as const;

export const WeightMeasurementSchema = {
  $id: "WeightMeasurement",
  type: "object",
  additionalProperties: false,
  required: [
    "id",
    "measuredAt",
    "localDate",
    "timezone",
    "weightKg",
    "source",
    "sourceRecordId",
    "dedupeKey",
    "confidence",
    "provenance",
    "createdAt"
  ],
  properties: {
    id: { type: "string", format: "uuid" },
    measuredAt: { type: "string", format: "date-time" },
    localDate: { type: "string", format: "date" },
    timezone: { type: "string", minLength: 1, maxLength: 64 },
    weightKg: {
      type: "number",
      minimum: 0.5,
      maximum: 700,
      multipleOf: 0.001
    },
    source: WeightMeasurementSourceSchema,
    sourceRecordId: {
      anyOf: [
        { type: "string", minLength: 1, maxLength: 512 },
        { type: "null" }
      ]
    },
    dedupeKey: { type: "string", minLength: 1, maxLength: 256 },
    confidence: {
      anyOf: [
        { type: "number", minimum: 0, maximum: 1, multipleOf: 0.001 },
        { type: "null" }
      ]
    },
    provenance: { type: "object", additionalProperties: true },
    createdAt: { type: "string", format: "date-time" }
  }
} as const;

export type WeightMeasurement = FromSchema<typeof WeightMeasurementSchema>;

export const CreateWeightMeasurementSchema = {
  $id: "CreateWeightMeasurement",
  type: "object",
  additionalProperties: false,
  required: [
    "measuredAt",
    "timezone",
    "weightKg",
    "source",
    "dedupeKey",
    "provenance"
  ],
  properties: {
    measuredAt: { type: "string", format: "date-time" },
    timezone: { type: "string", minLength: 1, maxLength: 64 },
    weightKg: {
      type: "number",
      minimum: 0.5,
      maximum: 700,
      multipleOf: 0.001
    },
    source: WeightMeasurementSourceSchema,
    sourceRecordId: {
      anyOf: [
        { type: "string", minLength: 1, maxLength: 512 },
        { type: "null" }
      ]
    },
    dedupeKey: { type: "string", minLength: 1, maxLength: 256 },
    confidence: {
      anyOf: [
        { type: "number", minimum: 0, maximum: 1, multipleOf: 0.001 },
        { type: "null" }
      ]
    },
    provenance: { type: "object", additionalProperties: true }
  }
} as const;

export type CreateWeightMeasurement = FromSchema<
  typeof CreateWeightMeasurementSchema
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
