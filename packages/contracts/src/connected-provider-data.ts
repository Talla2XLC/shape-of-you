import type { FromSchema } from "json-schema-to-ts";
const nullableNumber = { anyOf: [{ type: "number", minimum: 0, maximum: 1000000 }, { type: "null" }] } as const;
const nullableBoundedNumber = (maximum: number) => ({ anyOf: [{ type: "number", minimum: 0, maximum }, { type: "null" }] } as const);
const nullableInstant = { anyOf: [{ type: "string", format: "date-time" }, { type: "null" }] } as const;
const nullableUuid = { anyOf: [{ type: "string", format: "uuid" }, { type: "null" }] } as const;
/** Canonical typed FitnessDay values; null denotes an unavailable measurement. */
export const FitnessDayValuesSchema = {
    type: "object", additionalProperties: false,
    required: ["restingExpenditureKcal", "activeExpenditureKcal", "totalExpenditureKcal", "movementDistanceMeters", "floorsUp", "floorsDown", "moderateMinutes", "vigorousMinutes", "fitnessAgeYears", "achievableFitnessAgeYears", "vo2Max", "vo2MaxCycling", "vo2MaxRowing", "fitnessAgeAsOf", "fitnessAgeComputedAt"],
    properties: {
        restingExpenditureKcal: nullableNumber,
        activeExpenditureKcal: nullableNumber,
        totalExpenditureKcal: nullableNumber,
        movementDistanceMeters: nullableNumber,
        floorsUp: nullableNumber,
        floorsDown: nullableNumber,
        moderateMinutes: nullableBoundedNumber(1440),
        vigorousMinutes: nullableBoundedNumber(1440),
        fitnessAgeYears: nullableBoundedNumber(150),
        achievableFitnessAgeYears: nullableBoundedNumber(150),
        vo2Max: nullableBoundedNumber(150),
        vo2MaxCycling: nullableBoundedNumber(150),
        vo2MaxRowing: nullableBoundedNumber(150),
        fitnessAgeAsOf: { anyOf: [{ type: "string", format: "date" }, { type: "null" }] },
        fitnessAgeComputedAt: nullableInstant,
    }
} as const;
/** Canonical FitnessDay values, distinct from user-entered facts. */
export type FitnessDayValues = FromSchema<typeof FitnessDayValuesSchema>;
/** Canonical typed NutritionDay values; null denotes an unavailable measurement. */
export const NutritionDayValuesSchema = {
    type: "object", additionalProperties: false,
    required: ["consumedCaloriesKcal", "proteinGrams", "fatGrams", "carbohydrateGrams", "consumedFluidMl"],
    properties: {
        consumedCaloriesKcal: nullableNumber,
        proteinGrams: nullableNumber,
        fatGrams: nullableNumber,
        carbohydrateGrams: nullableNumber,
        consumedFluidMl: nullableNumber,
    }
} as const;
/** Canonical NutritionDay values, distinct from user-entered facts. */
export type NutritionDayValues = FromSchema<typeof NutritionDayValuesSchema>;
/** Canonical typed BodyComposition values; null denotes an unavailable measurement. */
export const BodyCompositionValuesSchema = {
    type: "object", additionalProperties: false,
    required: ["bodyFatPercent", "bodyWaterPercent", "muscleMassKg", "boneMassKg", "bmi"],
    properties: {
        bodyFatPercent: nullableBoundedNumber(100),
        bodyWaterPercent: nullableBoundedNumber(100),
        muscleMassKg: nullableBoundedNumber(700),
        boneMassKg: nullableBoundedNumber(700),
        bmi: nullableBoundedNumber(200),
    }
} as const;
/** Canonical BodyComposition values, distinct from user-entered facts. */
export type BodyCompositionValues = FromSchema<typeof BodyCompositionValuesSchema>;
/** Complete primary-source groups; an omitted group preserves prior data, null explicitly clears that group. */
export interface ProviderConnectedDayRecord {
    readonly identity: string;
    readonly localDate: string;
    readonly timezone: string;
    readonly fitness?: {
        readonly energyMovement?: Pick<FitnessDayValues, "restingExpenditureKcal" | "activeExpenditureKcal" | "totalExpenditureKcal" | "movementDistanceMeters" | "floorsUp" | "floorsDown" | "moderateMinutes" | "vigorousMinutes"> | null;
        readonly fitnessAge?: Pick<FitnessDayValues, "fitnessAgeYears" | "achievableFitnessAgeYears" | "fitnessAgeAsOf" | "fitnessAgeComputedAt"> | null;
        readonly vo2Max?: Pick<FitnessDayValues, "vo2Max" | "vo2MaxCycling" | "vo2MaxRowing"> | null;
    };
    readonly nutrition?: {
        readonly intake?: Pick<NutritionDayValues, "consumedCaloriesKcal" | "proteinGrams" | "fatGrams" | "carbohydrateGrams"> | null;
        readonly hydration?: Pick<NutritionDayValues, "consumedFluidMl"> | null;
    };
}
/** A real provider measurement, never a fabricated instant or implicit zero. */
export interface ProviderBodyMeasurementRecord {
    readonly identity: string;
    readonly localDate: string;
    readonly timezone: string;
    readonly measuredAt: string | null;
    readonly weightKg: number | null;
    readonly composition: BodyCompositionValues | null;
}
const provenance = {
    id: { type: "string", format: "uuid" }, personId: { type: "string", format: "uuid" }, provider: { type: "string", minLength: 1, maxLength: 64 },
    connectionId: { type: "string", format: "uuid" }, consentId: { type: "string", format: "uuid" }, sourceIdentity: { type: "string", minLength: 1, maxLength: 256 },
    localDate: { type: "string", format: "date" }, timezone: { type: "string", minLength: 1, maxLength: 64 },
    version: { type: "integer", minimum: 1 }, supersedesId: nullableUuid, withdrawn: { type: "boolean" }, createdAt: { type: "string", format: "date-time" }
} as const;
const requiredProvenance = ["id", "personId", "provider", "connectionId", "consentId", "sourceIdentity", "localDate", "timezone", "version", "supersedesId", "withdrawn", "createdAt"] as const;
/** Training-owned immutable provider daily summary. */
export const ConnectedDailyFitnessSummarySchema = {
    $id: "ConnectedDailyFitnessSummary", type: "object", additionalProperties: false,
    required: [...requiredProvenance, "values"], properties: { ...provenance, values: FitnessDayValuesSchema }
} as const;
/** Training-owned immutable provider daily summary. */
export type ConnectedDailyFitnessSummary = FromSchema<typeof ConnectedDailyFitnessSummarySchema>;
/** Nutrition totals remain separate from Meal ledger totals. */
export const ConnectedNutritionDaySchema = {
    $id: "ConnectedNutritionDay", type: "object", additionalProperties: false,
    required: [...requiredProvenance, "values"], properties: { ...provenance, values: NutritionDayValuesSchema }
} as const;
/** Nutrition totals remain separate from Meal ledger totals. */
export type ConnectedNutritionDay = FromSchema<typeof ConnectedNutritionDaySchema>;
/** Physical State observation; linked weight is optional. */
export const BodyCompositionObservationSchema = {
    $id: "BodyCompositionObservation", type: "object", additionalProperties: false,
    required: [...requiredProvenance, "measuredAt", "temporalPrecision", "weightMeasurementId", "values"],
    properties: { ...provenance, measuredAt: nullableInstant, temporalPrecision: { enum: ["instant", "local_date"] }, weightMeasurementId: nullableUuid, values: BodyCompositionValuesSchema }
} as const;
/** Physical State observation; linked weight is optional. */
export type BodyCompositionObservation = FromSchema<typeof BodyCompositionObservationSchema>;
/** Bounded Training day-summary read. */
export const ConnectedDailyFitnessSummaryListSchema = { $id: "ConnectedDailyFitnessSummaryList", type: "object", additionalProperties: false, required: ["items"], properties: { items: { type: "array", maxItems: 366, items: ConnectedDailyFitnessSummarySchema } } } as const;
/** Bounded Physical State read. */
export const BodyCompositionObservationListSchema = { $id: "BodyCompositionObservationList", type: "object", additionalProperties: false, required: ["items"], properties: { items: { type: "array", maxItems: 100, items: BodyCompositionObservationSchema } } } as const;
/** Separately identified external Nutrition total for one day. */
export const ConnectedNutritionDayResultSchema = { $id: "ConnectedNutritionDayResult", type: "object", additionalProperties: false, required: ["item"], properties: { item: { anyOf: [ConnectedNutritionDaySchema, { type: "null" }] } } } as const;
/** Query for a bounded provider history. */
export const ConnectedProviderDateQuerySchema = { $id: "ConnectedProviderDateQuery", type: "object", additionalProperties: false, properties: { fromDate: { type: "string", format: "date" }, toDate: { type: "string", format: "date" }, limit: { type: "integer", minimum: 1, maximum: 100 } } } as const;
/** Bounded connected-provider history query. */
export type ConnectedProviderDateQuery = FromSchema<typeof ConnectedProviderDateQuerySchema>;
