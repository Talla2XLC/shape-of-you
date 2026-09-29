import type { FromSchema } from "json-schema-to-ts";

const localDate = { type: "string", format: "date" } as const;
const nullableInstant = { anyOf: [{ type: "string", format: "date-time" }, { type: "null" }] } as const;
const nullableUuid = { anyOf: [{ type: "string", format: "uuid" }, { type: "null" }] } as const;

export const PersonFactTimelineQuerySchema = {
  $id: "PersonFactTimelineQuery",
  type: "object",
  additionalProperties: false,
  required: ["from", "to", "timezone"],
  properties: {
    from: localDate,
    to: localDate,
    timezone: { type: "string", minLength: 1, maxLength: 64 }
  }
} as const;

/** Inclusive Person-local range of at most 32 calendar days. */
export type PersonFactTimelineQuery = FromSchema<typeof PersonFactTimelineQuerySchema>;

export const PersonFactTimelineEntrySchema = {
  type: "object",
  additionalProperties: false,
  required: ["kind", "id", "localDate", "occurredAt", "temporalPrecision", "title", "numericValue", "unit", "supersedesId", "linkedExternalActivityId", "detailPath", "historyPath"],
  properties: {
    kind: { enum: ["weight", "body_measurements", "meal", "workout_session", "external_activity", "recovery_observation"] },
    id: { type: "string", format: "uuid" },
    localDate,
    occurredAt: nullableInstant,
    temporalPrecision: { enum: ["instant", "local_date"] },
    title: { type: "string", minLength: 1, maxLength: 256 },
    numericValue: { anyOf: [{ type: "number" }, { type: "null" }] },
    unit: { anyOf: [{ type: "string", minLength: 1, maxLength: 32 }, { type: "null" }] },
    supersedesId: nullableUuid,
    linkedExternalActivityId: nullableUuid,
    detailPath: { anyOf: [{ type: "string", pattern: "^/v1/" }, { type: "null" }] },
    historyPath: { anyOf: [{ type: "string", pattern: "^/v1/" }, { type: "null" }] }
  }
} as const;

/** Safe summary of one current owner-owned fact, never a Coach decision. */
export type PersonFactTimelineEntry = FromSchema<typeof PersonFactTimelineEntrySchema>;

export const PersonFactTimelineSchema = {
  $id: "PersonFactTimeline",
  type: "object",
  additionalProperties: false,
  required: ["from", "to", "timezone", "scope", "items"],
  properties: {
    from: localDate,
    to: localDate,
    timezone: { type: "string" },
    scope: { const: "current_recorded_facts_only" },
    items: { type: "array", items: PersonFactTimelineEntrySchema }
  }
} as const;

/** Current recorded Person facts; unpersisted Coach advice is outside scope. */
export type PersonFactTimeline = FromSchema<typeof PersonFactTimelineSchema>;
