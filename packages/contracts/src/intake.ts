import type { FromSchema } from "json-schema-to-ts";

import {
  SourceReferenceInputSchema,
  SourceReferenceSchema
} from "./source-reference.js";

const nullableStringSchema = {
  anyOf: [{ type: "string" }, { type: "null" }]
} as const;

const nullableUuidSchema = {
  anyOf: [{ type: "string", format: "uuid" }, { type: "null" }]
} as const;

const nullableConfidenceSchema = {
  anyOf: [
    { type: "number", minimum: 0, maximum: 1, multipleOf: 0.001 },
    { type: "null" }
  ]
} as const;

export const CreateIntakeRequestSchema = {
  $id: "CreateIntakeRequest",
  type: "object",
  additionalProperties: false,
  required: [
    "text",
    "locale",
    "timezone",
    "sourceReference",
    "idempotencyKey"
  ],
  properties: {
    text: { type: "string", minLength: 1, maxLength: 10_000 },
    locale: { type: "string", minLength: 2, maxLength: 35 },
    timezone: { type: "string", minLength: 1, maxLength: 64 },
    sourceReference: SourceReferenceInputSchema,
    idempotencyKey: { type: "string", minLength: 1, maxLength: 256 }
  }
} as const;

/** Command that durably accepts one natural-language intake message. */
export type CreateIntakeRequest = FromSchema<
  typeof CreateIntakeRequestSchema
>;

export const IntakeRequestIdParamsSchema = {
  $id: "IntakeRequestIdParams",
  type: "object",
  additionalProperties: false,
  required: ["id"],
  properties: {
    id: { type: "string", format: "uuid" }
  }
} as const;

/** Route parameters for one Person-owned intake request. */
export type IntakeRequestIdParams = FromSchema<
  typeof IntakeRequestIdParamsSchema
>;

export const IntakeItemParamsSchema = {
  $id: "IntakeItemParams",
  type: "object",
  additionalProperties: false,
  required: ["id", "itemId"],
  properties: {
    id: { type: "string", format: "uuid" },
    itemId: { type: "string", format: "uuid" }
  }
} as const;

/** Route parameters for an item inside one intake request. */
export type IntakeItemParams = FromSchema<typeof IntakeItemParamsSchema>;

export const ClarifyIntakeItemSchema = {
  $id: "ClarifyIntakeItem",
  type: "object",
  additionalProperties: false,
  required: ["answer", "idempotencyKey"],
  properties: {
    answer: { type: "string", minLength: 1, maxLength: 2_000 },
    idempotencyKey: { type: "string", minLength: 1, maxLength: 256 }
  }
} as const;

/** User answer that resumes parsing of one ambiguous item. */
export type ClarifyIntakeItem = FromSchema<
  typeof ClarifyIntakeItemSchema
>;

export const DecideIntakeItemSchema = {
  $id: "DecideIntakeItem",
  type: "object",
  additionalProperties: false,
  required: ["decision", "idempotencyKey"],
  properties: {
    decision: { type: "string", enum: ["confirm", "reject"] },
    idempotencyKey: { type: "string", minLength: 1, maxLength: 256 }
  }
} as const;

/** Explicit user decision for one parsed intake item. */
export type DecideIntakeItem = FromSchema<typeof DecideIntakeItemSchema>;

const IntakeWeightDetailSchema = {
  type: "object",
  additionalProperties: false,
  required: [
    "measuredAt",
    "timezone",
    "weightKg",
    "dedupeKey",
    "measurementId"
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
    dedupeKey: { type: "string", minLength: 1, maxLength: 256 },
    measurementId: nullableUuidSchema
  }
} as const;

const IntakeItemSchema = {
  type: "object",
  additionalProperties: false,
  required: [
    "id",
    "position",
    "kind",
    "status",
    "confidence",
    "clarificationQuestion",
    "detail",
    "createdAt",
    "updatedAt"
  ],
  properties: {
    id: { type: "string", format: "uuid" },
    position: { type: "integer", minimum: 0 },
    kind: { type: "string", enum: ["weight_measurement"] },
    status: {
      type: "string",
      enum: [
        "needs_clarification",
        "awaiting_confirmation",
        "queued",
        "processing",
        "completed",
        "rejected",
        "failed"
      ]
    },
    confidence: nullableConfidenceSchema,
    clarificationQuestion: {
      anyOf: [
        { type: "string", minLength: 1, maxLength: 2_000 },
        { type: "null" }
      ]
    },
    detail: {
      anyOf: [IntakeWeightDetailSchema, { type: "null" }]
    },
    createdAt: { type: "string", format: "date-time" },
    updatedAt: { type: "string", format: "date-time" }
  }
} as const;

export const IntakeRequestSchema = {
  $id: "IntakeRequest",
  type: "object",
  additionalProperties: false,
  required: [
    "id",
    "personId",
    "text",
    "locale",
    "timezone",
    "sourceReference",
    "idempotencyKey",
    "parsingStatus",
    "status",
    "failureCode",
    "items",
    "receivedAt"
  ],
  properties: {
    id: { type: "string", format: "uuid" },
    personId: { type: "string", format: "uuid" },
    text: { type: "string", minLength: 1, maxLength: 10_000 },
    locale: { type: "string", minLength: 2, maxLength: 35 },
    timezone: { type: "string", minLength: 1, maxLength: 64 },
    sourceReference: SourceReferenceSchema,
    idempotencyKey: { type: "string", minLength: 1, maxLength: 256 },
    parsingStatus: {
      type: "string",
      enum: ["queued", "processing", "parsed", "failed"]
    },
    status: {
      type: "string",
      enum: [
        "queued",
        "processing",
        "awaiting_action",
        "partial",
        "completed",
        "failed"
      ]
    },
    failureCode: nullableStringSchema,
    items: { type: "array", items: IntakeItemSchema },
    receivedAt: { type: "string", format: "date-time" }
  }
} as const;

/** Current projection of one intake request and its independently owned items. */
export type IntakeRequest = FromSchema<typeof IntakeRequestSchema>;

/** One item returned inside an IntakeRequest projection. */
export type IntakeItem = FromSchema<typeof IntakeItemSchema>;
