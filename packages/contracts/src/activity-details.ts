import type { FromSchema } from "json-schema-to-ts";

const nullableNumber = { anyOf: [{ type: "number" }, { type: "null" }] } as const;
const uuid = { type: "string", format: "uuid" } as const;
const instant = { type: "string", format: "date-time" } as const;
/** Closed safe diagnostic codes; absence is distinct from failed parsing and pending import. */
export const ActivityDetailsIssueSchema = { enum: ["invalid_fit", "unsupported_fit", "limit_exceeded", "provider_unavailable", "source_file_unavailable", "no_supported_measurements"] } as const;
/** Latest receipt diagnostic contains no provider payload or exception text. */
export type ActivityDetailsIssue = FromSchema<typeof ActivityDetailsIssueSchema>;

/** Closed measured channels; names encode canonical units, missing values are null. */
export const ActivityMetricsSchema = {
  type: "object", additionalProperties: false,
  required: ["heartRateBpm", "speedMps", "distanceM", "cadenceRpm", "powerW", "altitudeM", "temperatureC", "respirationPerMinute", "verticalOscillationMm", "stanceTimeMs", "stepLengthMm"],
  properties: {
    heartRateBpm: nullableNumber, speedMps: nullableNumber, distanceM: nullableNumber,
    cadenceRpm: nullableNumber, powerW: nullableNumber, altitudeM: nullableNumber,
    temperatureC: nullableNumber, respirationPerMinute: nullableNumber,
    verticalOscillationMm: nullableNumber, stanceTimeMs: nullableNumber, stepLengthMm: nullableNumber
  }
} as const;
/** Nullable values measured at one FIT record timestamp. */
export type ActivityMetrics = FromSchema<typeof ActivityMetricsSchema>;

/** A normalized record preserves its actual timestamp rather than invented one-second sampling. */
export const ActivityRecordSchema = {
  type: "object", additionalProperties: false,
  required: ["timestamp", "elapsedSeconds", "metrics"],
  properties: { timestamp: instant, elapsedSeconds: { type: "number", minimum: 0 }, metrics: ActivityMetricsSchema }
} as const;
/** One normalized FIT record within a session. */
export type ActivityRecord = FromSchema<typeof ActivityRecordSchema>;

const lapSchema = {
  type: "object", additionalProperties: false,
  required: ["startElapsedSeconds", "endElapsedSeconds", "timerSeconds", "distanceM", "averageHeartRateBpm", "maximumHeartRateBpm", "averageSpeedMps", "averagePowerW"],
  properties: {
    startElapsedSeconds: { type: "number", minimum: 0 }, endElapsedSeconds: { type: "number", minimum: 0 },
    timerSeconds: nullableNumber, distanceM: nullableNumber, averageHeartRateBpm: nullableNumber,
    maximumHeartRateBpm: nullableNumber, averageSpeedMps: nullableNumber, averagePowerW: nullableNumber
  }
} as const;
/** Closed normalized FIT storage shape; excludes raw messages, identifiers, and coordinates. */
export const ActivityDetailsPayloadSchema = {
  type: "object", additionalProperties: false, required: ["sessions"],
  properties: {
    sessions: {
      type: "array", maxItems: 100, items: {
        type: "object", additionalProperties: false,
        required: ["startTimestamp", "elapsedSeconds", "timerSeconds", "sport", "records", "laps", "timerEvents"],
        properties: {
          startTimestamp: instant, elapsedSeconds: { type: "number", minimum: 0, maximum: 604800 },
          timerSeconds: nullableNumber, sport: { anyOf: [{ type: "string", maxLength: 64 }, { type: "null" }] },
          records: { type: "array", maxItems: 200000, items: ActivityRecordSchema },
          laps: { type: "array", maxItems: 10000, items: lapSchema },
          timerEvents: { type: "array", maxItems: 10000, items: {
            type: "object", additionalProperties: false, required: ["elapsedSeconds", "active"],
            properties: { elapsedSeconds: { type: "number", minimum: 0 }, active: { type: "boolean" } }
          } }
        }
      }
    }
  }
} as const;
/** Training-owned immutable normalized details of one external activity. */
export type ActivityDetailsPayload = FromSchema<typeof ActivityDetailsPayloadSchema>;

/** Bounded person-scoped detail read; explicit analysis zones are not historical watch settings. */
export const GetExternalActivityDetailsSchema = {
  $id: "GetExternalActivityDetails", type: "object", additionalProperties: false, required: ["activityId"],
  properties: {
    activityId: uuid, session: { type: "integer", minimum: 0, maximum: 99 },
    fromElapsedSeconds: { type: "number", minimum: 0, maximum: 604800 },
    toElapsedSeconds: { type: "number", minimum: 0, maximum: 604800 },
    mode: { enum: ["buckets", "records", "laps"] }, bucketSeconds: { type: "integer", minimum: 1, maximum: 3600 },
    cursor: { type: "string", maxLength: 256 },
    zoneBoundariesBpm: { type: "array", minItems: 1, maxItems: 10, uniqueItems: true, items: { type: "number", minimum: 1, maximum: 300 } }
  }
} as const;
/** Detail query uses an internal ExternalActivity identity discovered in training context. */
export type GetExternalActivityDetails = FromSchema<typeof GetExternalActivityDetailsSchema>;

const channelStats = {
  type: "object", additionalProperties: false, required: ["average", "minimum", "maximum", "coveredSeconds"],
  properties: { average: nullableNumber, minimum: nullableNumber, maximum: nullableNumber, coveredSeconds: { type: "number", minimum: 0 } }
} as const;
const bucketSchema = {
  type: "object", additionalProperties: false,
  required: ["fromElapsedSeconds", "toElapsedSeconds", "activeSeconds", "channels", "zoneSeconds"],
  properties: {
    fromElapsedSeconds: { type: "number" }, toElapsedSeconds: { type: "number" }, activeSeconds: { type: "number" },
    channels: { type: "object", additionalProperties: channelStats },
    zoneSeconds: { anyOf: [{ type: "array", items: { type: "number", minimum: 0 } }, { type: "null" }] }
  }
} as const;
/** Read result distinguishes missing details, pinned-version conflict, and measured coverage. */
export const ExternalActivityDetailsResultSchema = {
  $id: "ExternalActivityDetailsResult", type: "object", additionalProperties: false,
  required: ["availability", "latestImportIssue", "activityId", "detailsVersion", "sourceActivityVersion", "normalizationVersion", "fileChecksum", "importedAt", "source", "sessions", "session", "records", "buckets", "laps", "nextCursor", "zoneBasis", "channels", "coveragePolicy", "timerEventsAvailable"],
  properties: {
    availability: { enum: ["available", "not_imported", "no_supported_data", "unavailable", "version_changed"] },
    latestImportIssue: { anyOf: [ActivityDetailsIssueSchema, { type: "null" }] },
    activityId: uuid, detailsVersion: { anyOf: [uuid, { type: "null" }] }, sourceActivityVersion: { anyOf: [uuid, { type: "null" }] },
    normalizationVersion: { anyOf: [{ type: "string" }, { type: "null" }] }, source: { const: "intervals_icu_original_fit" },
    fileChecksum: { anyOf: [{ type: "string", pattern: "^[0-9a-f]{64}$" }, { type: "null" }] }, importedAt: { anyOf: [instant, { type: "null" }] },
    sessions: { type: "array", maxItems: 100, items: {
      type: "object", additionalProperties: false, required: ["index", "startTimestamp", "elapsedSeconds", "timerSeconds", "sport", "recordCount", "lapCount"],
      properties: { index: { type: "integer" }, startTimestamp: instant, elapsedSeconds: { type: "number" }, timerSeconds: nullableNumber,
        sport: { anyOf: [{ type: "string" }, { type: "null" }] }, recordCount: { type: "integer" }, lapCount: { type: "integer" } }
    } },
    session: { type: "integer" }, records: { type: "array", maxItems: 1000, items: ActivityRecordSchema },
    buckets: { type: "array", maxItems: 200, items: bucketSchema }, laps: { type: "array", maxItems: 200, items: lapSchema },
    nextCursor: { anyOf: [{ type: "string" }, { type: "null" }] }, timerEventsAvailable: { type: "boolean" },
    zoneBasis: { enum: ["analysis_supplied", "unavailable"] },
    channels: { type: "array", items: { type: "string" } }, coveragePolicy: { const: "previous_record_max_10s_active_only_v1" }
  }
} as const;
/** Paged measured records or computed buckets; laps remain recorded summaries. */
export type ExternalActivityDetailsResult = FromSchema<typeof ExternalActivityDetailsResultSchema>;
