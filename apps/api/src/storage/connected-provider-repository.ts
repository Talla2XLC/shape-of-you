import { createHash } from "node:crypto";
import { and, eq, sql } from "drizzle-orm";
import type { BodyCompositionObservation, ConnectedDailyFitnessSummary, ConnectedNutritionDay, ProviderBodyMeasurementRecord, ProviderConnectedDayRecord } from "@shape-of-you/contracts";
import type { DatabaseContext } from "../database/context.js";
import { integrationConnections, recoveryConnections, recoveryConsents, recoveryErasureRequests, weightMeasurements } from "../database/schema.js";
import { integrationRecordAllowed, readIntegrationImportPolicy } from "./integration-cutover-policy.js";
import { ensureSourceReference, lockPersonEvidenceMutation, type DatabaseTransaction } from "./source-reference-repository.js";
/** Captured integration generation required by every connected-domain mutation. */
export interface ConnectedProviderConnection {
    readonly id: string;
    readonly personId: string;
    readonly consentId: string;
    readonly providerKey: string;
}
/** Explicit, immutable import permissions attached to a consent generation. */
export type IntegrationImportScope = "recovery" | "training" | "physical_state" | "nutrition";
/** Result of an idempotent, last-mile guarded provider publication. */
export type ConnectedImportOutcome = "created" | "corrected" | "unchanged" | "stopped";
const fitnessGroups = { energyMovement: ["restingExpenditureKcal", "activeExpenditureKcal", "totalExpenditureKcal", "movementDistanceMeters", "floorsUp", "floorsDown", "moderateMinutes", "vigorousMinutes"], fitnessAge: ["fitnessAgeYears", "achievableFitnessAgeYears", "fitnessAgeAsOf", "fitnessAgeComputedAt"], vo2Max: ["vo2Max", "vo2MaxCycling", "vo2MaxRowing"] } as const;
const nutritionGroups = { intake: ["consumedCaloriesKcal", "proteinGrams", "fatGrams", "carbohydrateGrams"], hydration: ["consumedFluidMl"] } as const;
const bodyFields = ["bodyFatPercent", "bodyWaterPercent", "muscleMassKg", "boneMassKg", "bmi"] as const;
const snake = (key: string) => key.replace(/[A-Z]/g, letter => `_${letter.toLowerCase()}`);
const camel = (key: string) => key.replace(/_([a-z])/g, (_, letter: string) => letter.toUpperCase());
const checksum = (value: unknown) => createHash("sha256").update(JSON.stringify(value)).digest("hex");
const dateInZone = (instant: string, timezone: string) => new Intl.DateTimeFormat("en-CA", { timeZone: timezone, year: "numeric", month: "2-digit", day: "2-digit" }).format(new Date(instant));
const measurementMaxima: Readonly<Record<string,number>> = {"bodyFatPercent": 100, "bodyWaterPercent": 100, "fitnessAgeYears": 150, "achievableFitnessAgeYears": 150, "vo2Max": 150, "vo2MaxCycling": 150, "vo2MaxRowing": 150, "moderateMinutes": 1440, "vigorousMinutes": 1440, "muscleMassKg": 700, "boneMassKg": 700, "bmi": 200};
type Raw = Record<string, unknown>;
/** Rechecks generation, explicit scope, retention and erasure while the caller holds the Person lock. */
export async function connectedImportAllowed(transaction: DatabaseTransaction, connection: ConnectedProviderConnection, scope: IntegrationImportScope, localDate: string, measuredAt?: string | null, kind: "wellness" | "activity" = "wellness"): Promise<boolean> {
    const current = await transaction.query.integrationConnections.findFirst({ where: and(eq(integrationConnections.id, connection.id), eq(integrationConnections.personId, connection.personId), eq(integrationConnections.providerKey, connection.providerKey), eq(integrationConnections.consentId, connection.consentId), eq(integrationConnections.importEnabled, true)) });
    if (!current)
        return false;
    const consent = await transaction.query.recoveryConsents.findFirst({ where: and(eq(recoveryConsents.id, connection.consentId), eq(recoveryConsents.personId, connection.personId), eq(recoveryConsents.connectionId, current.recoveryConnectionId), eq(recoveryConsents.status, "active")) });
    if (!consent?.integrationImportScopes.includes(scope))
        return false;
    const recovery = await transaction.query.recoveryConnections.findFirst({ where: and(eq(recoveryConnections.id, current.recoveryConnectionId), eq(recoveryConnections.personId, connection.personId), eq(recoveryConnections.status, "active")) });
    if (!recovery || recovery.erasureRequestedAt)
        return false;
    const erased = await transaction.query.recoveryErasureRequests.findFirst({ where: and(eq(recoveryErasureRequests.personId, connection.personId), eq(recoveryErasureRequests.connectionId, current.recoveryConnectionId)) });
    if (erased)
        return false;
    const now = await transaction.execute(sql `select clock_timestamp() as now`);
    if (consent.retainUntil && consent.retainUntil <= new Date(now.rows[0]!.now as string))
        return false;
    const policy = await readIntegrationImportPolicy(transaction, connection.id, connection.consentId);
    const admittedDate = measuredAt && policy ? dateInZone(measuredAt, policy.timezone) : localDate;
    return integrationRecordAllowed(policy, kind, { localDate: admittedDate, ...(measuredAt ? { occurredAt: measuredAt } : {}) });
}
/** Owns immutable connected Training/Nutrition/Physical State facts without mixing manual ledgers. */
export class ConnectedProviderRepository {
    constructor(private readonly database: DatabaseContext) {
    }
    /** Publishes the present primary-source Fitness groups, preserving omitted groups. */
    importFitnessDay(connection: ConnectedProviderConnection, record: ProviderConnectedDayRecord): Promise<ConnectedImportOutcome> {
        return this.importDay(connection, record, "connected_daily_fitness", "training", record.fitness, fitnessGroups);
    }
    /** Publishes intake and hydration independently; never changes Meal totals or goals. */
    importNutritionDay(connection: ConnectedProviderConnection, record: ProviderConnectedDayRecord): Promise<ConnectedImportOutcome> {
        return this.importDay(connection, record, "connected_nutrition_days", "nutrition", record.nutrition, nutritionGroups);
    }
    private importDay(connection: ConnectedProviderConnection, record: ProviderConnectedDayRecord, table: string, scope: IntegrationImportScope, groups: object | undefined, fields: Record<string, readonly string[]>): Promise<ConnectedImportOutcome> {
        if (!groups || !Object.keys(groups).length)
            return Promise.resolve("unchanged");
        return this.database.db.transaction(async (tx) => {
            await lockPersonEvidenceMutation(tx, connection.personId);
            if (!await connectedImportAllowed(tx, connection, scope, record.localDate))
                return "stopped";
            const prior = await this.current(tx, table, connection, record.localDate, false);
            const values: Raw = {};
            for (const key of Object.values(fields).flat())
                values[key] = prior?.[snake(key)] == null ? null : key.endsWith("At") ? new Date(prior[snake(key)] as string).toISOString() : key.endsWith("AsOf") ? (prior[snake(key)] instanceof Date ? new Date(prior[snake(key)] as string).toISOString().slice(0, 10) : prior[snake(key)]) : Number(prior[snake(key)]);
            for (const [group, keys] of Object.entries(fields))
                if (Object.prototype.hasOwnProperty.call(groups, group)) {
                    const supplied = (groups as Record<string, unknown>)[group];
                    if (supplied !== null && (typeof supplied !== "object" || supplied === undefined))
                        throw Error("Invalid provider field group");
                    for (const key of keys) {
                        const value = supplied === null ? null : (supplied as Raw)[key];
                        if (value === undefined)
                            throw Error("Incomplete provider field group");
                        values[key] = value;
                    }
                }
            return this.publish(tx, table, connection, record, prior, values);
        });
    }
    private async current(tx: DatabaseTransaction, table: string, connection: ConnectedProviderConnection, identity: string, byIdentity: boolean): Promise<Raw | undefined> {
        const rows = await tx.execute(sql `select c.*${table === "connected_daily_fitness" ? sql`,c.fitness_age_as_of::text as fitness_age_as_of` : sql``} from ${sql.identifier(table)} c where c.person_id=${connection.personId} and c.provider=${connection.providerKey} and ${byIdentity ? sql `c.source_identity=${identity}` : sql `c.local_date=${identity}::date`} and not exists(select 1 from ${sql.identifier(table)} successor where successor.supersedes_id=c.id) order by c.created_at desc limit 1`);
        return rows.rows[0];
    }
    private async publish(tx: DatabaseTransaction, table: string, connection: ConnectedProviderConnection, record: {
        identity: string;
        localDate: string;
        timezone: string;
    }, prior: Raw | undefined, values: Raw, metadata: Raw = {}): Promise<ConnectedImportOutcome> {
        for (const [key, value] of Object.entries(values))
            if (value !== null && !key.endsWith("At") && !key.endsWith("AsOf") && (typeof value !== "number" || !Number.isFinite(value) || value < 0 || value > (measurementMaxima[key] ?? 1000000)))
                throw Error("Invalid connected provider measurement");
        // PostgreSQL numeric returns strings; canonicalize both prior and incoming before hashing.
        const canonical: Raw = {};
        for (const [key, value] of Object.entries(values))
            canonical[key] = value === null ? null : key.endsWith("At") ? new Date(value as string).toISOString() : key.endsWith("AsOf") ? String(value).slice(0, 10) : Number(Number(value).toFixed(3));
        const withdrawn = Object.values(canonical).every(v => v === null);
        if (!prior && withdrawn)
            return "unchanged";
        const hash = checksum({ localDate: record.localDate, timezone: record.timezone, values: canonical, metadata });
        if (prior?.normalized_checksum === hash)
            return "unchanged";
        const row: Raw = { person_id: connection.personId, connection_id: connection.id, consent_id: connection.consentId, provider: connection.providerKey, source_identity: record.identity, local_date: record.localDate, timezone: record.timezone, normalized_checksum: hash, version: Number(prior?.version ?? 0) + 1, supersedes_id: prior?.id ?? null, withdrawn, ...metadata, ...Object.fromEntries(Object.entries(canonical).map(([k, v]) => [snake(k), v])) };
        await tx.execute(sql `insert into ${sql.identifier(table)} (${sql.join(Object.keys(row).map(sql.identifier), sql `,`)}) values (${sql.join(Object.values(row).map(v => sql `${v}`), sql `,`)})`);
        return prior ? "corrected" : "created";
    }
    /** Publishes a real instant/local-day body measurement, optionally linking an actual weight fact. */
    importBodyMeasurement(connection: ConnectedProviderConnection, record: ProviderBodyMeasurementRecord): Promise<ConnectedImportOutcome> {
        return this.database.db.transaction(async (tx) => {
            await lockPersonEvidenceMutation(tx, connection.personId);
            if (!await connectedImportAllowed(tx, connection, "physical_state", record.localDate, record.measuredAt))
                return "stopped";
            const policy = await readIntegrationImportPolicy(tx, connection.id, connection.consentId);
            record = { ...record, localDate: record.measuredAt ? dateInZone(record.measuredAt, policy?.timezone ?? record.timezone) : record.localDate, timezone: record.measuredAt ? policy?.timezone ?? record.timezone : record.timezone };
            const prior = await this.current(tx, "body_composition_observations", connection, record.identity, true);
            let weightId: string | null = null;
            let weightOutcome: ConnectedImportOutcome = "unchanged";
            if (record.weightKg !== null) {
                if (!Number.isFinite(record.weightKg) || record.weightKg < 0.5 || record.weightKg > 700)
                    throw Error("Invalid provider weight measurement");
                const canonicalKg = Number(record.weightKg.toFixed(3));
                record = {...record,weightKg:canonicalKg,measuredAt:record.measuredAt === null ? null : new Date(record.measuredAt).toISOString()};
                const rows = await tx.select().from(weightMeasurements).where(and(eq(weightMeasurements.personId, connection.personId), eq(weightMeasurements.integrationSourceIdentity, `${connection.providerKey}:${checksum(record.identity)}`), sql `not exists(select 1 from weight_measurements successor where successor.supersedes_id=${weightMeasurements.id})`)).orderBy(sql `${weightMeasurements.createdAt} desc`).limit(1);
                const current = rows[0];
                if (current && Number(current.weightKg) === record.weightKg && (current.measuredAt?.toISOString() ?? null) === record.measuredAt && current.localDate === record.localDate && current.timezone === record.timezone)
                    weightId = current.id;
                else {
                    const source = await ensureSourceReference(tx, connection.personId, { channel: "account", externalSystem: connection.providerKey, externalRecordId: `weight:${record.identity}:${checksum([record.measuredAt, record.weightKg])}`, occurredAt: record.measuredAt });
                    const inserted = await tx.insert(weightMeasurements).values({ personId: connection.personId, measuredAt: record.measuredAt ? new Date(record.measuredAt) : null, temporalPrecision: record.measuredAt ? "instant" : "local_date", localDate: record.localDate, timezone: record.timezone, weightKg: canonicalKg.toFixed(3), source: "account", sourceReferenceId: source.row.id, dedupeKey: `connected-weight:${checksum([connection.providerKey, record.identity, record.measuredAt, record.weightKg, current?.id ?? null])}`, integrationConnectionId: connection.id, integrationConsentId: connection.consentId, integrationSourceIdentity: `${connection.providerKey}:${checksum(record.identity)}`, supersedesId: current?.id ?? null, correctionReason: current ? "provider_record_changed" : null }).returning();
                    weightId = inserted[0]!.id;
                    weightOutcome = current ? "corrected" : "created";
                }
            }
            const values: Raw = Object.fromEntries(bodyFields.map(key => [key, record.composition?.[key] ?? null]));
            // Physical values share the same immutable publication rule, including authoritative withdrawal.
            const outcome = await this.publish(tx, "body_composition_observations", connection, record, prior, values, { measured_at: record.measuredAt, weight_measurement_id: weightId });
            return outcome === "unchanged" ? weightOutcome : outcome;
        });
    }
    /** Returns current non-withdrawn Training summaries in the inclusive local-date range. */
    async readFitnessDays(personId: string, fromDate: string, toDate: string): Promise<readonly ConnectedDailyFitnessSummary[]> {
        return this.read("connected_daily_fitness", personId, fromDate, toDate, 366) as Promise<ConnectedDailyFitnessSummary[]>;
    }
    /** Returns the separately identified external Nutrition day, without Meal aggregation. */
    async readNutritionDay(personId: string, date: string): Promise<ConnectedNutritionDay | null> {
        return (await this.read("connected_nutrition_days", personId, date, date, 1))[0] as ConnectedNutritionDay | undefined ?? null;
    }
    /** Lists latest Physical State body-composition observations; manual measurements remain separate. */
    async listBodyComposition(personId: string, query: {
        fromDate?: string;
        toDate?: string;
        limit?: number;
    } = {}): Promise<readonly BodyCompositionObservation[]> {
        return this.read("body_composition_observations", personId, query.fromDate ?? "0001-01-01", query.toDate ?? "9999-12-31", Math.min(query.limit ?? 50, 100)) as Promise<BodyCompositionObservation[]>;
    }
    private async read(table: string, personId: string, from: string, to: string, limit: number): Promise<unknown[]> {
        const result = await this.database.pool.query(`select c.*,c.local_date::text as local_date${table === "connected_daily_fitness" ? ",c.fitness_age_as_of::text as fitness_age_as_of" : ""} from ${table} c where person_id=$1 and local_date between $2 and $3 and not withdrawn and exists(select 1 from integration_connections owner
          join recovery_connections recovery on recovery.id=owner.recovery_connection_id and recovery.person_id=owner.person_id
          where owner.id=c.connection_id and owner.person_id=c.person_id and recovery.erasure_requested_at is null
            and not exists(select 1 from recovery_erasure_requests erasure where erasure.person_id=owner.person_id and erasure.connection_id=recovery.id))
          and not exists(select 1 from ${table} s where s.supersedes_id=c.id) order by c.local_date desc,c.created_at desc limit $4`, [personId, from, to, limit]);
        const keys = table === "connected_daily_fitness" ? Object.values(fitnessGroups).flat() : table === "connected_nutrition_days" ? Object.values(nutritionGroups).flat() : bodyFields;
        return result.rows.map((row: Raw) => {
            const item: Raw = {};
            for (const key of ["id", "person_id", "provider", "connection_id", "consent_id", "source_identity", "local_date", "timezone", "version", "supersedes_id", "withdrawn"])
                item[camel(key)] = row[key];
            item.createdAt = (row.created_at as Date).toISOString();
            item.values = Object.fromEntries(keys.map(key => {
                const value = row[snake(key)];
                return [key, value === null ? null : key.endsWith("At") ? new Date(value as string).toISOString() : key.endsWith("AsOf") ? value : Number(value)];
            }));
            if (table === "body_composition_observations") {
                item.measuredAt = (row.measured_at as Date | null)?.toISOString() ?? null;
                item.temporalPrecision = row.measured_at ? "instant" : "local_date";
                item.weightMeasurementId = row.weight_measurement_id;
            }
            return item;
        });
    }
}
