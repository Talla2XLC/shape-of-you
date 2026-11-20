import type { FromSchema } from "json-schema-to-ts";

import { CheckGarminPersonalKeySchema } from "./integration-connection.js";

const localDate = { type: "string", format: "date" } as const;
const instant = { type: "string", format: "date-time" } as const;
const acceptedGaps = {
  type: "array", uniqueItems: true, maxItems: 5,
  items: {
    type: "string",
    enum: ["recovery.hrv_rmssd", "recovery.sleep_score", "training.normalized_load", "training.device_attribution", "training.original_fit"]
  }
} as const;

/** Closed capability names whose known limitations require individual consent. */
export const GarminCutoverCapabilitySchema = acceptedGaps.items;
/** Capability key, never an arbitrary field name or external account identifier. */
export type GarminCutoverCapability = FromSchema<typeof GarminCutoverCapabilitySchema>;

/** A mapping limitation, distinct from absent data on one calendar day. */
export const GarminCutoverGapSchema = {
  type: "object", additionalProperties: false,
  required: ["capability", "status", "description"],
  properties: {
    capability: GarminCutoverCapabilitySchema,
    status: { type: "string", enum: ["unsupported", "unverified"] },
    description: { type: "string", minLength: 1, maxLength: 1000 }
  }
} as const;
/** Safe description of one capability requiring an explicit waiver. */
export type GarminCutoverGap = FromSchema<typeof GarminCutoverGapSchema>;

/** Read-only request for the nearest valid boundary or one selected local date. */
export const PreviewGarminCutoverSchema = {
  $id: "PreviewGarminCutover", type: "object", additionalProperties: false,
  properties: { startsOn: localDate }
} as const;
/** Preview input; omission asks the server to select the nearest admissible date. */
export type PreviewGarminCutover = FromSchema<typeof PreviewGarminCutoverSchema>;

/** Current safe boundary and capability matrix; preview never stores a credential. */
export const GarminCutoverPreviewSchema = {
  $id: "GarminCutoverPreview", type: "object", additionalProperties: false,
  required: ["expectedRevision", "startsOn", "timezone", "startsAt", "sourceDrainsUntil", "sourceTailFromDate", "capabilityVersion", "gaps"],
  properties: {
    expectedRevision: { type: "string", minLength: 1, maxLength: 512 },
    startsOn: localDate,
    timezone: { type: "string", minLength: 1, maxLength: 100 },
    startsAt: instant,
    sourceDrainsUntil: instant,
    sourceTailFromDate: localDate,
    capabilityVersion: { type: "string", minLength: 1, maxLength: 128 },
    gaps: { type: "array", maxItems: 5, items: GarminCutoverGapSchema }
  }
} as const;
/** Safe preflight data bound to an opaque stale-state revision. */
export type GarminCutoverPreview = FromSchema<typeof GarminCutoverPreviewSchema>;

/** Controlled pre-persistence conflict containing only an updated safe preview. */
export const GarminCutoverCoverageChangedSchema = {
  $id: "GarminCutoverCoverageChanged", type: "object", additionalProperties: false,
  required: ["statusCode", "error", "message", "details"],
  properties: {
    statusCode: { const: 409 },
    error: { const: "coverage_changed" },
    message: { type: "string", minLength: 1, maxLength: 256 },
    details: {
      type: "object", additionalProperties: false,
      required: ["preview"],
      properties: { preview: GarminCutoverPreviewSchema }
    }
  }
} as const;
/** Safe coverage conflict; no credential, external identity or provider diagnostic fields. */
export type GarminCutoverCoverageChanged = FromSchema<typeof GarminCutoverCoverageChangedSchema>;

/** Input for a future transition; every shown gap must be explicitly accepted. */
export const ScheduleGarminCutoverSchema = {
  $id: "ScheduleGarminCutover", type: "object", additionalProperties: false,
  required: ["startsOn", "expectedRevision", "apiKey", "consent", "acceptedCoverageGaps", "dedupeKey"],
  properties: {
    startsOn: localDate,
    expectedRevision: GarminCutoverPreviewSchema.properties.expectedRevision,
    apiKey: CheckGarminPersonalKeySchema.properties.apiKey,
    consent: { const: true },
    acceptedCoverageGaps: acceptedGaps,
    dedupeKey: { type: "string", minLength: 1, maxLength: 200 }
  }
} as const;
/** Person-authorized schedule command; API key must never be returned or logged. */
export type ScheduleGarminCutover = FromSchema<typeof ScheduleGarminCutoverSchema>;

/** Safe retry uses the encrypted pending key unless the owner supplies a replacement. */
export const RetryGarminCutoverSchema = {
  $id: "RetryGarminCutover", type: "object", additionalProperties: false,
  required: ["startsOn", "expectedRevision", "expectedVersion", "acceptedCoverageGaps", "dedupeKey"],
  properties: {
    startsOn: localDate,
    expectedRevision: GarminCutoverPreviewSchema.properties.expectedRevision,
    expectedVersion: { type: "integer", minimum: 1 },
    apiKey: CheckGarminPersonalKeySchema.properties.apiKey,
    acceptedCoverageGaps: acceptedGaps,
    dedupeKey: ScheduleGarminCutoverSchema.properties.dedupeKey
  }
} as const;
/** Version-fenced retry without mandatory key re-entry. */
export type RetryGarminCutover = FromSchema<typeof RetryGarminCutoverSchema>;

/** Cancels only a transition that has not acquired active import permissions. */
export const CancelGarminCutoverSchema = {
  $id: "CancelGarminCutover", type: "object", additionalProperties: false,
  required: ["expectedVersion", "reason"],
  properties: {
    expectedVersion: { type: "integer", minimum: 1 },
    reason: { type: "string", minLength: 1, maxLength: 256 }
  }
} as const;
/** Explicit, version-fenced cancellation; never an automatic rollback after activation. */
export type CancelGarminCutover = FromSchema<typeof CancelGarminCutoverSchema>;

/** Bounded operational failures, without raw transport or credential details. */
export const GarminCutoverFailureSchema = {
  type: "string",
  enum: ["authorization_required", "provider_rate_limited", "provider_timeout", "provider_unavailable", "provider_response_invalid", "timezone_changed", "consent_changed", "erasure_pending", "coverage_changed", "source_conflict", "restore_suppressed", "journal_not_ready"]
} as const;
/** Failure code for safe cutover status. */
export type GarminCutoverFailure = FromSchema<typeof GarminCutoverFailureSchema>;

/** Person-owned transition projection excluding connection and external-account IDs. */
export const GarminCutoverSchema = {
  type: "object", additionalProperties: false,
  required: ["id", "version", "state", "startsOn", "timezone", "startsAt", "sourceDrainsUntil", "capabilityVersion", "acceptedCoverageGaps", "failureCode", "sourceRevocationUnconfirmed", "lastAttemptAt"],
  properties: {
    id: { type: "string", format: "uuid" },
    version: { type: "integer", minimum: 1 },
    state: { type: "string", enum: ["scheduled", "draining", "active", "failed", "cancelled"] },
    startsOn: localDate,
    timezone: GarminCutoverPreviewSchema.properties.timezone,
    startsAt: instant,
    sourceDrainsUntil: instant,
    capabilityVersion: GarminCutoverPreviewSchema.properties.capabilityVersion,
    acceptedCoverageGaps: acceptedGaps,
    failureCode: { anyOf: [GarminCutoverFailureSchema, { type: "null" }] },
    sourceRevocationUnconfirmed: { type: "boolean" },
    lastAttemptAt: { anyOf: [instant, { type: "null" }] }
  }
} as const;
/** Immutable policy plus safe operational state; version is a compare-and-swap guard. */
export type GarminCutover = FromSchema<typeof GarminCutoverSchema>;

/** Null means no transition has been configured; a cancelled record remains inspectable. */
export const GarminCutoverStatusSchema = {
  $id: "GarminCutoverStatus", type: "object", additionalProperties: false,
  required: ["cutover"],
  properties: { cutover: { anyOf: [GarminCutoverSchema, { type: "null" }] } }
} as const;
/** Safe status returned by status and successful cutover mutations. */
export type GarminCutoverStatus = FromSchema<typeof GarminCutoverStatusSchema>;
