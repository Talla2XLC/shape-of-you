import type { SourceReference, SourceReferenceInput } from "./source-reference.js";
import { EmbeddedSourceReferenceSchema, SourceReferenceInputSchema } from "./source-reference.js";

const uuid = { type: "string", format: "uuid" } as const;
const dateTime = { type: "string", format: "date-time" } as const;
const localDate = { type: "string", format: "date" } as const;
const nullableString = (maxLength: number) => ({
  anyOf: [
    { type: "string", minLength: 1, maxLength },
    { type: "null" }
  ]
} as const);

export const RecoveryObservationKindSchema = {
  type: "string",
  enum: ["sleep", "metric", "subjective"]
} as const;

export const RecoveryObservationQualitySchema = {
  type: "string",
  enum: ["reliable", "estimated", "poor"]
} as const;

export const RecoveryMetricSchema = {
  type: "string",
  enum: [
    "hrv_rmssd",
    "resting_heart_rate",
    "night_heart_rate",
    "oxygen_saturation",
    "minimum_oxygen_saturation",
    "temperature_deviation",
    "respiration_rate",
    "body_battery",
    "sleep_score"
  ]
} as const;

export const RecoveryMetricUnitSchema = {
  type: "string",
  enum: ["ms", "bpm", "percent", "celsius", "breaths_per_minute", "score"]
} as const;

export const RecoveryRiskLevelSchema = {
  type: "string",
  enum: ["low", "moderate", "high", "blocked"]
} as const;

export const RecoveryAssessmentDataQualitySchema = {
  type: "string",
  enum: ["insufficient", "limited", "sufficient"]
} as const;

export type RecoveryObservationKind = "sleep" | "metric" | "subjective";
export type RecoveryObservationQuality = "reliable" | "estimated" | "poor";
export type RecoveryMetric =
  | "hrv_rmssd"
  | "resting_heart_rate"
  | "night_heart_rate"
  | "oxygen_saturation"
  | "minimum_oxygen_saturation"
  | "temperature_deviation"
  | "respiration_rate"
  | "body_battery"
  | "sleep_score";
export type RecoveryMetricUnit =
  | "ms"
  | "bpm"
  | "percent"
  | "celsius"
  | "breaths_per_minute"
  | "score";
export type RecoveryRiskLevel = "low" | "moderate" | "high" | "blocked";
export type RecoveryAssessmentDataQuality = "insufficient" | "limited" | "sufficient";

export type RecoverySourceReferenceInput = Omit<SourceReferenceInput, "channel"> & {
  readonly channel: "manual" | "google_sheets" | "import" | "device";
};

export const RecoverySourceReferenceInputSchema = {
  ...SourceReferenceInputSchema,
  $id: "RecoverySourceReferenceInput",
  properties: {
    ...SourceReferenceInputSchema.properties,
    channel: { type: "string", enum: ["manual", "google_sheets", "import", "device"] }
  }
} as const;

export interface RecoveryDeviceModelVersion {
  readonly id: string;
  readonly modelId: string;
  readonly providerKey: string;
  readonly providerName: string;
  readonly version: number;
  readonly name: string;
  readonly capabilities: readonly RecoveryObservationKind[];
  readonly createdAt: string;
}

export const RecoveryDeviceModelVersionSchema = {
  $id: "RecoveryDeviceModelVersion",
  type: "object",
  additionalProperties: false,
  required: ["id", "modelId", "providerKey", "providerName", "version", "name", "capabilities", "createdAt"],
  properties: {
    id: uuid,
    modelId: uuid,
    providerKey: { type: "string", minLength: 1, maxLength: 128 },
    providerName: { type: "string", minLength: 1, maxLength: 256 },
    version: { type: "integer", minimum: 1 },
    name: { type: "string", minLength: 1, maxLength: 256 },
    capabilities: {
      type: "array",
      minItems: 1,
      uniqueItems: true,
      items: RecoveryObservationKindSchema
    },
    createdAt: dateTime
  }
} as const;

export interface CreateRecoveryConnection {
  readonly deviceModelVersionId: string;
  readonly label: string | null;
  readonly dedupeKey: string;
}

export const CreateRecoveryConnectionSchema = {
  $id: "CreateRecoveryConnection",
  type: "object",
  additionalProperties: false,
  required: ["deviceModelVersionId", "label", "dedupeKey"],
  properties: {
    deviceModelVersionId: uuid,
    label: nullableString(256),
    dedupeKey: { type: "string", minLength: 1, maxLength: 256 }
  }
} as const;

export interface RecoveryConnection {
  readonly id: string;
  readonly personId: string;
  readonly status: "active" | "disconnected";
  readonly device: {
    readonly id: string;
    readonly label: string | null;
    readonly modelVersion: RecoveryDeviceModelVersion;
  };
  readonly dedupeKey: string;
  readonly connectedAt: string;
  readonly disconnectedAt: string | null;
}

export const RecoveryConnectionSchema = {
  $id: "RecoveryConnection",
  type: "object",
  additionalProperties: false,
  required: ["id", "personId", "status", "device", "dedupeKey", "connectedAt", "disconnectedAt"],
  properties: {
    id: uuid,
    personId: uuid,
    status: { type: "string", enum: ["active", "disconnected"] },
    device: {
      type: "object",
      additionalProperties: false,
      required: ["id", "label", "modelVersion"],
      properties: {
        id: uuid,
        label: nullableString(256),
        modelVersion: RecoveryDeviceModelVersionSchema
      }
    },
    dedupeKey: { type: "string" },
    connectedAt: dateTime,
    disconnectedAt: { anyOf: [dateTime, { type: "null" }] }
  }
} as const;

export interface GrantRecoveryConsent {
  readonly purpose: string;
  readonly allowedKinds: readonly RecoveryObservationKind[];
  readonly retentionMode: "indefinite" | "until";
  readonly retainUntil: string | null;
}

export const GrantRecoveryConsentSchema = {
  $id: "GrantRecoveryConsent",
  type: "object",
  additionalProperties: false,
  required: ["purpose", "allowedKinds", "retentionMode", "retainUntil"],
  properties: {
    purpose: { type: "string", minLength: 1, maxLength: 512 },
    allowedKinds: {
      type: "array",
      minItems: 1,
      uniqueItems: true,
      items: RecoveryObservationKindSchema
    },
    retentionMode: { type: "string", enum: ["indefinite", "until"] },
    retainUntil: { anyOf: [dateTime, { type: "null" }] }
  },
  allOf: [
    {
      if: { properties: { retentionMode: { const: "until" } } },
      then: { properties: { retainUntil: dateTime } },
      else: { properties: { retainUntil: { type: "null" } } }
    }
  ]
} as const;

export interface RecoveryConsent {
  readonly id: string;
  readonly personId: string;
  readonly connectionId: string;
  readonly purpose: string;
  readonly allowedKinds: readonly RecoveryObservationKind[];
  readonly retentionMode: "indefinite" | "until";
  readonly retainUntil: string | null;
  readonly status: "active" | "revoked";
  readonly grantedAt: string;
  readonly revokedAt: string | null;
}

export const RecoveryConsentSchema = {
  $id: "RecoveryConsent",
  type: "object",
  additionalProperties: false,
  required: ["id", "personId", "connectionId", "purpose", "allowedKinds", "retentionMode", "retainUntil", "status", "grantedAt", "revokedAt"],
  properties: {
    id: uuid,
    personId: uuid,
    connectionId: uuid,
    purpose: { type: "string" },
    allowedKinds: { type: "array", items: RecoveryObservationKindSchema },
    retentionMode: { type: "string", enum: ["indefinite", "until"] },
    retainUntil: { anyOf: [dateTime, { type: "null" }] },
    status: { type: "string", enum: ["active", "revoked"] },
    grantedAt: dateTime,
    revokedAt: { anyOf: [dateTime, { type: "null" }] }
  }
} as const;

export interface RevokeRecoveryConsent {
  readonly reason: string;
}

export const RevokeRecoveryConsentSchema = {
  $id: "RevokeRecoveryConsent",
  type: "object",
  additionalProperties: false,
  required: ["reason"],
  properties: { reason: { type: "string", minLength: 1, maxLength: 512 } }
} as const;

export interface SleepObservationDetail {
  readonly type: "sleep";
  readonly totalSleepMinutes: number;
  readonly deepSleepMinutes?: number | null;
  readonly remSleepMinutes?: number | null;
  readonly lightSleepMinutes?: number | null;
  readonly sleepQuality: number | null;
}

export interface MetricObservationDetail {
  readonly type: "metric";
  readonly metric: RecoveryMetric;
  readonly value: number;
  readonly unit: RecoveryMetricUnit;
}

export interface SubjectiveObservationDetail {
  readonly type: "subjective";
  readonly energy: number;
  readonly fatigue: number;
  readonly muscleSoreness: number;
  readonly stress: number;
  readonly sleepQuality: number;
  readonly acuteIllness: boolean;
  readonly injuryConcern: boolean;
}

export type RecoveryObservationDetail = SleepObservationDetail | MetricObservationDetail | SubjectiveObservationDetail;

export const SleepObservationDetailSchema = {
  type: "object",
  additionalProperties: false,
  required: ["type", "totalSleepMinutes", "sleepQuality"],
  properties: {
    type: { const: "sleep" },
    totalSleepMinutes: { type: "integer", minimum: 0, maximum: 1440 },
    deepSleepMinutes: { anyOf: [{ type: "integer", minimum: 0, maximum: 1440 }, { type: "null" }] },
    remSleepMinutes: { anyOf: [{ type: "integer", minimum: 0, maximum: 1440 }, { type: "null" }] },
    lightSleepMinutes: { anyOf: [{ type: "integer", minimum: 0, maximum: 1440 }, { type: "null" }] },
    sleepQuality: { anyOf: [{ type: "integer", minimum: 1, maximum: 5 }, { type: "null" }] }
  },
  allOf: [{
    if: {
      required: ["deepSleepMinutes", "remSleepMinutes", "lightSleepMinutes"],
      properties: {
        deepSleepMinutes: { type: "integer" },
        remSleepMinutes: { type: "integer" },
        lightSleepMinutes: { type: "integer" }
      }
    },
    then: {
      properties: {
        totalSleepMinutes: { type: "integer", minimum: 0, maximum: 1440 }
      }
    }
  }]
} as const;

export const MetricObservationDetailSchema = {
  type: "object",
  additionalProperties: false,
  required: ["type", "metric", "value", "unit"],
  properties: {
    type: { const: "metric" },
    metric: RecoveryMetricSchema,
    value: { type: "number", minimum: -100, maximum: 1000 },
    unit: RecoveryMetricUnitSchema
  },
  allOf: [
    { if: { properties: { metric: { const: "hrv_rmssd" } } }, then: { properties: { value: { exclusiveMinimum: 0 }, unit: { const: "ms" } } } },
    { if: { properties: { metric: { enum: ["resting_heart_rate", "night_heart_rate"] } } }, then: { properties: { value: { exclusiveMinimum: 0 }, unit: { const: "bpm" } } } },
    { if: { properties: { metric: { enum: ["oxygen_saturation", "minimum_oxygen_saturation"] } } }, then: { properties: { value: { minimum: 0, maximum: 100 }, unit: { const: "percent" } } } },
    { if: { properties: { metric: { const: "temperature_deviation" } } }, then: { properties: { value: { minimum: -20, maximum: 20 }, unit: { const: "celsius" } } } },
    { if: { properties: { metric: { const: "respiration_rate" } } }, then: { properties: { value: { exclusiveMinimum: 0, maximum: 100 }, unit: { const: "breaths_per_minute" } } } },
    { if: { properties: { metric: { enum: ["body_battery", "sleep_score"] } } }, then: { properties: { value: { minimum: 0, maximum: 100 }, unit: { const: "score" } } } }
  ]
} as const;

export const SubjectiveObservationDetailSchema = {
  type: "object",
  additionalProperties: false,
  required: ["type", "energy", "fatigue", "muscleSoreness", "stress", "sleepQuality", "acuteIllness", "injuryConcern"],
  properties: {
    type: { const: "subjective" },
    energy: { type: "integer", minimum: 1, maximum: 5 },
    fatigue: { type: "integer", minimum: 1, maximum: 5 },
    muscleSoreness: { type: "integer", minimum: 1, maximum: 5 },
    stress: { type: "integer", minimum: 1, maximum: 5 },
    sleepQuality: { type: "integer", minimum: 1, maximum: 5 },
    acuteIllness: { type: "boolean" },
    injuryConcern: { type: "boolean" }
  }
} as const;

const observationInputProperties = {
  kind: RecoveryObservationKindSchema,
  observedFrom: { anyOf: [dateTime, { type: "null" }] },
  observedUntil: { anyOf: [dateTime, { type: "null" }] },
  temporalPrecision: { type: "string", enum: ["instant", "local_date"] },
  localDate: { anyOf: [localDate, { type: "null" }] },
  timezone: { type: "string", minLength: 1, maxLength: 64 },
  quality: RecoveryObservationQualitySchema,
  connectionId: { anyOf: [uuid, { type: "null" }] },
  consentId: { anyOf: [uuid, { type: "null" }] },
  dedupeKey: { type: "string", minLength: 1, maxLength: 256 },
  sourceReference: RecoverySourceReferenceInputSchema,
  detail: {
    oneOf: [SleepObservationDetailSchema, MetricObservationDetailSchema, SubjectiveObservationDetailSchema]
  }
} as const;

export interface CreateRecoveryObservation {
  readonly kind: RecoveryObservationKind;
  readonly observedFrom: string | null;
  readonly observedUntil: string | null;
  readonly temporalPrecision?: "instant" | "local_date";
  readonly localDate?: string | null;
  readonly timezone: string;
  readonly quality: RecoveryObservationQuality;
  readonly connectionId: string | null;
  readonly consentId: string | null;
  readonly dedupeKey: string;
  readonly sourceReference: RecoverySourceReferenceInput;
  readonly detail: RecoveryObservationDetail;
}

export const CreateRecoveryObservationSchema = {
  $id: "CreateRecoveryObservation",
  type: "object",
  additionalProperties: false,
  required: ["kind", "observedFrom", "observedUntil", "timezone", "quality", "connectionId", "consentId", "dedupeKey", "sourceReference", "detail"],
  properties: observationInputProperties
} as const;

export interface CorrectRecoveryObservation extends CreateRecoveryObservation {
  readonly reason: string;
}

export const CorrectRecoveryObservationSchema = {
  $id: "CorrectRecoveryObservation",
  type: "object",
  additionalProperties: false,
  required: [...CreateRecoveryObservationSchema.required, "reason"],
  properties: {
    ...observationInputProperties,
    reason: { type: "string", minLength: 1, maxLength: 512 }
  }
} as const;

export interface RecoveryObservation extends Omit<
  CreateRecoveryObservation,
  "sourceReference" | "temporalPrecision" | "localDate"
> {
  readonly id: string;
  readonly personId: string;
  readonly localDate: string;
  readonly temporalPrecision: "instant" | "local_date";
  readonly sourceReference: SourceReference;
  readonly supersedesId: string | null;
  readonly correctionReason: string | null;
  readonly createdAt: string;
}

export const RecoveryObservationSchema = {
  $id: "RecoveryObservation",
  type: "object",
  additionalProperties: false,
  required: ["id", "personId", "kind", "observedFrom", "observedUntil", "temporalPrecision", "localDate", "timezone", "quality", "connectionId", "consentId", "dedupeKey", "sourceReference", "detail", "supersedesId", "correctionReason", "createdAt"],
  properties: {
    id: uuid,
    personId: uuid,
    ...observationInputProperties,
    localDate,
    sourceReference: EmbeddedSourceReferenceSchema,
    supersedesId: { anyOf: [uuid, { type: "null" }] },
    correctionReason: nullableString(512),
    createdAt: dateTime
  }
} as const;

export const RecoveryIdParamsSchema = {
  $id: "RecoveryIdParams",
  type: "object",
  additionalProperties: false,
  required: ["id"],
  properties: { id: uuid }
} as const;

export interface RecoveryIdParams { readonly id: string; }

export const ListRecoveryObservationsQuerySchema = {
  $id: "ListRecoveryObservationsQuery",
  type: "object",
  additionalProperties: false,
  properties: {
    limit: { type: "integer", minimum: 1, maximum: 100, default: 50 },
    kind: RecoveryObservationKindSchema,
    localDate
  }
} as const;

export interface ListRecoveryObservationsQuery {
  readonly limit?: number;
  readonly kind?: RecoveryObservationKind;
  readonly localDate?: string;
}

export interface RecoveryObservationList { readonly items: readonly RecoveryObservation[]; }
export interface RecoveryObservationHistory { readonly items: readonly RecoveryObservation[]; }

export const RecoveryObservationListSchema = {
  $id: "RecoveryObservationList",
  type: "object",
  additionalProperties: false,
  required: ["items"],
  properties: { items: { type: "array", items: RecoveryObservationSchema } }
} as const;

export const RecoveryObservationHistorySchema = {
  $id: "RecoveryObservationHistory",
  type: "object",
  additionalProperties: false,
  required: ["items"],
  properties: { items: { type: "array", items: RecoveryObservationSchema } }
} as const;

export interface CreateRecoveryAssessment {
  readonly policyVersionId: string;
  readonly asOf: string;
  readonly timezone: string;
  readonly dedupeKey: string;
}

export const CreateRecoveryAssessmentSchema = {
  $id: "CreateRecoveryAssessment",
  type: "object",
  additionalProperties: false,
  required: ["policyVersionId", "asOf", "timezone", "dedupeKey"],
  properties: {
    policyVersionId: uuid,
    asOf: dateTime,
    timezone: { type: "string", minLength: 1, maxLength: 64 },
    dedupeKey: { type: "string", minLength: 1, maxLength: 256 }
  }
} as const;

export interface RecoveryAssessment {
  readonly id: string;
  readonly personId: string;
  readonly policyVersionId: string;
  readonly asOf: string;
  readonly windowStart: string;
  readonly windowEnd: string;
  readonly localDate: string;
  readonly timezone: string;
  readonly readinessScore: number;
  readonly riskLevel: RecoveryRiskLevel;
  readonly confidence: number;
  readonly dataQuality: RecoveryAssessmentDataQuality;
  readonly hardStop: boolean;
  readonly evidenceChecksum: string;
  readonly observationIds: readonly string[];
  readonly workoutSessionIds: readonly string[];
  readonly calculation: Record<string, unknown>;
  readonly dedupeKey: string;
  readonly createdAt: string;
}

export const RecoveryAssessmentSchema = {
  $id: "RecoveryAssessment",
  type: "object",
  additionalProperties: false,
  required: ["id", "personId", "policyVersionId", "asOf", "windowStart", "windowEnd", "localDate", "timezone", "readinessScore", "riskLevel", "confidence", "dataQuality", "hardStop", "evidenceChecksum", "observationIds", "workoutSessionIds", "calculation", "dedupeKey", "createdAt"],
  properties: {
    id: uuid,
    personId: uuid,
    policyVersionId: uuid,
    asOf: dateTime,
    windowStart: dateTime,
    windowEnd: dateTime,
    localDate,
    timezone: { type: "string" },
    readinessScore: { type: "number", minimum: 0, maximum: 100 },
    riskLevel: RecoveryRiskLevelSchema,
    confidence: { type: "number", minimum: 0, maximum: 1 },
    dataQuality: RecoveryAssessmentDataQualitySchema,
    hardStop: { type: "boolean" },
    evidenceChecksum: { type: "string", minLength: 1, maxLength: 128 },
    observationIds: { type: "array", items: uuid },
    workoutSessionIds: { type: "array", items: uuid },
    calculation: { type: "object", additionalProperties: true },
    dedupeKey: { type: "string" },
    createdAt: dateTime
  }
} as const;

export interface RecoveryAssessmentList { readonly items: readonly RecoveryAssessment[]; }
export interface ListRecoveryAssessmentsQuery { readonly limit?: number; }
export const ListRecoveryAssessmentsQuerySchema = {
  $id: "ListRecoveryAssessmentsQuery",
  type: "object",
  additionalProperties: false,
  properties: { limit: { type: "integer", minimum: 1, maximum: 100, default: 50 } }
} as const;
export const RecoveryAssessmentListSchema = {
  $id: "RecoveryAssessmentList",
  type: "object",
  additionalProperties: false,
  required: ["items"],
  properties: { items: { type: "array", items: RecoveryAssessmentSchema } }
} as const;
