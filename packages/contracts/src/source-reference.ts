import type { FromSchema } from "json-schema-to-ts";

export const SourceChannelSchema = {
  type: "string",
  enum: ["manual", "google_sheets", "import"]
} as const;

export const SourceReferenceInputSchema = {
  $id: "SourceReferenceInput",
  type: "object",
  additionalProperties: false,
  required: [
    "channel",
    "externalSystem",
    "externalRecordId",
    "occurredAt"
  ],
  properties: {
    channel: SourceChannelSchema,
    externalSystem: {
      anyOf: [
        { type: "string", minLength: 1, maxLength: 128 },
        { type: "null" }
      ]
    },
    externalRecordId: {
      anyOf: [
        { type: "string", minLength: 1, maxLength: 512 },
        { type: "null" }
      ]
    },
    occurredAt: {
      anyOf: [
        { type: "string", format: "date-time" },
        { type: "null" }
      ]
    }
  },
  allOf: [
    {
      if: {
        properties: {
          externalSystem: { type: "null" }
        }
      },
      then: {
        properties: {
          externalRecordId: { type: "null" }
        }
      },
      else: {
        properties: {
          externalRecordId: { type: "string" }
        }
      }
    }
  ]
} as const;

/** Public, typed provenance supplied with a domain command. */
export type SourceReferenceInput = FromSchema<
  typeof SourceReferenceInputSchema
>;

export const SourceReferenceSchema = {
  $id: "SourceReference",
  type: "object",
  additionalProperties: false,
  required: [
    "id",
    "channel",
    "externalSystem",
    "externalRecordId",
    "occurredAt",
    "ingestedAt"
  ],
  properties: {
    id: { type: "string", format: "uuid" },
    ...SourceReferenceInputSchema.properties,
    ingestedAt: { type: "string", format: "date-time" }
  }
} as const;

/** Persisted public provenance without a private raw source snapshot. */
export type SourceReference = FromSchema<typeof SourceReferenceSchema>;
