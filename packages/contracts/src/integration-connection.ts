import type { FromSchema } from "json-schema-to-ts";

const nullableDateTime = {
  anyOf: [{ type: "string", format: "date-time" }, { type: "null" }]
} as const;

export const IntegrationConnectionLifecycleSchema = {
  type: "string",
  enum: ["unavailable", "connecting", "active", "degraded", "disconnected"]
} as const;

export const IntegrationSyncFailureSchema = {
  type: "string",
  enum: ["authorization_required", "provider_rate_limited", "provider_timeout", "provider_unavailable", "provider_response_invalid"]
} as const;

/** Durable lifecycle of a Person-requested historical provider import. */
export const IntegrationHistoricalImportStatusSchema = {
  type: "string",
  enum: ["not_requested", "running", "completed", "failed"]
} as const;

/** Browser-safe progress projection without provider payloads or credentials. */
export const IntegrationHistoricalImportSchema = {
  type: "object",
  additionalProperties: false,
  required: ["status", "processedThroughDate", "requestedAt", "lastAttemptAt", "completedAt", "failureCode"],
  properties: {
    status: IntegrationHistoricalImportStatusSchema,
    processedThroughDate: { anyOf: [{ type: "string", format: "date" }, { type: "null" }] },
    requestedAt: nullableDateTime,
    lastAttemptAt: nullableDateTime,
    completedAt: nullableDateTime,
    failureCode: { anyOf: [IntegrationSyncFailureSchema, { type: "null" }] }
  }
} as const;

export const GarminIntervalsConnectionSchema = {
  $id: "GarminIntervalsConnection",
  type: "object",
  additionalProperties: false,
  required: [
    "provider", "displayName", "recoveryConnectionId", "lifecycle", "failureCode", "lastAttemptAt",
    "lastSuccessfulSyncAt", "lastDataAt", "connectedAt", "disconnectedAt", "historicalImport"
  ],
  properties: {
    provider: { const: "intervals_icu" },
    displayName: { const: "Garmin via Intervals.icu" },
    recoveryConnectionId: { anyOf: [{ type: "string", format: "uuid" }, { type: "null" }] },
    lifecycle: IntegrationConnectionLifecycleSchema,
    failureCode: { anyOf: [IntegrationSyncFailureSchema, { type: "null" }] },
    lastAttemptAt: nullableDateTime,
    lastSuccessfulSyncAt: nullableDateTime,
    lastDataAt: nullableDateTime,
    connectedAt: nullableDateTime,
    disconnectedAt: nullableDateTime,
    historicalImport: IntegrationHistoricalImportSchema
  }
} as const;

/** Safe browser projection for the Person's Garmin-via-Intervals connection. */
export type GarminIntervalsConnection = FromSchema<typeof GarminIntervalsConnectionSchema>;

export const StartGarminIntervalsAuthorizationSchema = {
  $id: "StartGarminIntervalsAuthorization",
  type: "object",
  additionalProperties: false,
  required: ["returnTo"],
  properties: {
    returnTo: { type: "string", pattern: "^/(?!/)", maxLength: 2048 }
  }
} as const;

/** Starts the server-owned Intervals.icu OAuth ceremony. */
export type StartGarminIntervalsAuthorization = FromSchema<typeof StartGarminIntervalsAuthorizationSchema>;

export const IntegrationAuthorizationStartSchema = {
  $id: "IntegrationAuthorizationStart",
  type: "object",
  additionalProperties: false,
  required: ["authorizationUrl"],
  properties: { authorizationUrl: { type: "string", format: "uri", maxLength: 4096 } }
} as const;

/** URL returned to the browser for top-level provider authorization. */
export type IntegrationAuthorizationStart = FromSchema<typeof IntegrationAuthorizationStartSchema>;

export const DisconnectIntegrationSchema = {
  $id: "DisconnectIntegration",
  type: "object",
  additionalProperties: false,
  required: ["reason"],
  properties: { reason: { type: "string", minLength: 1, maxLength: 256 } }
} as const;

/** Explicit local disconnect intent; imported facts are retained. */
export type DisconnectIntegration = FromSchema<typeof DisconnectIntegrationSchema>;
