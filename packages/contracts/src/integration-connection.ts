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
  enum: ["authorization_required", "provider_rate_limited", "provider_timeout", "provider_unavailable", "provider_response_invalid", "cutover_source_stopped"]
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
    failureCode: { anyOf: [IntegrationSyncFailureSchema, { type: "null" }] },
    scopeFromDate: { type: "string", format: "date", description: "Earliest date covered by this history job; legacy projections imply 2000-01-01." }
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

/** Browser-safe projection for direct Garmin Personal API access. */
export const GarminPersonalConnectionSchema = {
  ...GarminIntervalsConnectionSchema,
  $id: "GarminPersonalConnection",
  properties: {
    ...GarminIntervalsConnectionSchema.properties,
    provider: { const: "garmin_personal" },
    displayName: { const: "Garmin" }
  }
} as const;

/** Person-owned direct Garmin connection, excluding credentials and account identifiers. */
export type GarminPersonalConnection = FromSchema<typeof GarminPersonalConnectionSchema>;

/** Supported public projections; provider discriminator preserves existing Intervals clients. */
export type IntegrationConnection = GarminIntervalsConnection | GarminPersonalConnection;

/** Secret input accepted only over the authenticated, CSRF-protected API. */
export const CheckGarminPersonalKeySchema = {
  $id: "CheckGarminPersonalKey", type: "object", additionalProperties: false,
  required: ["apiKey"],
  properties: { apiKey: { type: "string", minLength: 1, maxLength: 4096, pattern: "^[^\\s\\x00-\\x1f\\x7f]+$" } }
} as const;

/** Explicit consent activates automatic read-only imports for the authenticated Person. */
export const ConnectGarminPersonalSchema = {
  ...CheckGarminPersonalKeySchema, $id: "ConnectGarminPersonal", required: ["apiKey", "consent"],
  properties: { ...CheckGarminPersonalKeySchema.properties, consent: { const: true } }
} as const;

/** Successful credential check; no account metadata or import side effect. */
export const GarminPersonalKeyCheckSchema = {
  $id: "GarminPersonalKeyCheck", type: "object", additionalProperties: false,
  required: ["verified"], properties: { verified: { const: true } }
} as const;

/** Transient personal key check input. */
export type CheckGarminPersonalKey = FromSchema<typeof CheckGarminPersonalKeySchema>;
/** Direct connection activation and key rotation input. */
export type ConnectGarminPersonal = FromSchema<typeof ConnectGarminPersonalSchema>;
