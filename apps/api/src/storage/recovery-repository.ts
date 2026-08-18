import { createHash } from "node:crypto";

import {
  and,
  asc,
  desc,
  eq,
  gte,
  isNull,
  lte,
  notExists,
  or,
  sql
} from "drizzle-orm";
import { alias } from "drizzle-orm/pg-core";

import type {
  CorrectRecoveryObservation,
  CreateRecoveryAssessment,
  CreateRecoveryConnection,
  CreateRecoveryObservation,
  GrantRecoveryConsent,
  ListRecoveryObservationsQuery,
  RecoveryAssessment,
  RecoveryAssessmentList,
  RecoveryConnection,
  RecoveryConsent,
  RecoveryDeviceModelVersion,
  RecoveryObservation,
  RecoveryObservationDetail,
  RecoveryObservationHistory,
  RecoveryObservationList,
  RevokeRecoveryConsent
} from "@shape-of-you/contracts";

import type { DatabaseContext } from "../database/context.js";
import {
  performedExercises,
  performedSets,
  recoveryAssessmentObservationEvidence,
  recoveryAssessmentPolicies,
  recoveryAssessmentPolicyVersions,
  recoveryAssessments,
  recoveryAssessmentTrainingEvidence,
  recoveryConnections,
  recoveryConsentKinds,
  recoveryConsents,
  recoveryDeviceCapabilities,
  recoveryDeviceModels,
  recoveryDeviceModelVersions,
  recoveryDevices,
  recoveryMetricDetails,
  recoveryObservations,
  recoveryProviders,
  recoverySleepDetails,
  recoverySubjectiveDetails,
  sourceReferences,
  workoutSessions,
  type RecoveryAssessmentRow,
  type RecoveryObservationRow,
  type SourceReferenceRow
} from "../database/schema.js";
import {
  evaluateRecovery,
  validateRecoveryObservation,
  type RecoveryObservationEvidence,
  type RecoveryPolicyParameters
} from "../domain/recovery.js";
import { ConflictError, DomainValidationError, NotFoundError } from "../domain/errors.js";
import { toSourceReference } from "../domain/source-reference.js";
import { deriveLocalDate } from "../domain/weight-measurement.js";
import {
  discardUnusedSourceReference,
  ensureSourceReference,
  type DatabaseTransaction
} from "./source-reference-repository.js";

/** Internal source-neutral definition used to seed shared device knowledge. */
export interface RegisterRecoveryDeviceModel {
  readonly providerKey: string;
  readonly providerName: string;
  readonly modelKey: string;
  readonly version: number;
  readonly name: string;
  readonly capabilities: readonly ("sleep" | "metric" | "subjective")[];
}

/** Typed parameters for one shared immutable synthetic policy revision. */
export interface RegisterRecoveryPolicyVersion extends RecoveryPolicyParameters {
  readonly policyKey: string;
  readonly policyName: string;
  readonly version: number;
  readonly effectiveFrom: string;
  readonly effectiveUntil: string | null;
}

export interface CreatedRecoveryObservation {
  readonly created: boolean;
  readonly observation: RecoveryObservation;
}

export interface CreatedRecoveryAssessment {
  readonly created: boolean;
  readonly assessment: RecoveryAssessment;
}

/** Persistence boundary for Recovery definitions, facts, consent and decisions. */
export interface RecoveryStore {
  registerDeviceModel(input: RegisterRecoveryDeviceModel): Promise<RecoveryDeviceModelVersion>;
  createConnection(personId: string, input: CreateRecoveryConnection): Promise<RecoveryConnection>;
  grantConsent(personId: string, connectionId: string, input: GrantRecoveryConsent): Promise<RecoveryConsent>;
  revokeConsent(personId: string, consentId: string, input: RevokeRecoveryConsent): Promise<RecoveryConsent>;
  createObservation(personId: string, input: CreateRecoveryObservation): Promise<CreatedRecoveryObservation>;
  correctObservation(personId: string, id: string, input: CorrectRecoveryObservation): Promise<CreatedRecoveryObservation>;
  findObservation(personId: string, id: string): Promise<RecoveryObservation | null>;
  listObservations(personId: string, query: ListRecoveryObservationsQuery): Promise<RecoveryObservationList>;
  /** Reads every current observation for one exact Person-local calendar date. */
  listObservationsForLocalDate(personId: string, localDate: string): Promise<readonly RecoveryObservation[]>;
  listObservationsForLocalDateRange(personId: string, from: string, to: string): Promise<readonly RecoveryObservation[]>;
  observationHistory(personId: string, id: string): Promise<RecoveryObservationHistory | null>;
  registerPolicyVersion(input: RegisterRecoveryPolicyVersion): Promise<string>;
  createAssessment(personId: string, input: CreateRecoveryAssessment): Promise<CreatedRecoveryAssessment>;
  findAssessment(personId: string, id: string): Promise<RecoveryAssessment | null>;
  listAssessments(personId: string, limit: number): Promise<RecoveryAssessmentList>;
  /** Reads every assessment for one exact Person-local calendar date. */
  listAssessmentsForLocalDate(personId: string, localDate: string): Promise<readonly RecoveryAssessment[]>;
  listAssessmentsForLocalDateRange(personId: string, from: string, to: string): Promise<readonly RecoveryAssessment[]>;
}

async function lockPerson(transaction: DatabaseTransaction, personId: string): Promise<void> {
  await transaction.execute(sql`select pg_advisory_xact_lock(hashtext(${personId}))`);
}

/** PostgreSQL implementation of the Recovery persistence boundary. */
export class RecoveryRepository implements RecoveryStore {
  public constructor(private readonly database: DatabaseContext) {}

  public registerDeviceModel(input: RegisterRecoveryDeviceModel): Promise<RecoveryDeviceModelVersion> {
    return this.database.db.transaction(async (transaction) => {
      const insertedProvider = await transaction
        .insert(recoveryProviders)
        .values({ key: input.providerKey, name: input.providerName })
        .onConflictDoNothing()
        .returning();
      const provider = insertedProvider[0] ?? await transaction.query.recoveryProviders.findFirst({
        where: eq(recoveryProviders.key, input.providerKey)
      });
      if (!provider) throw new Error("Recovery provider conflict did not resolve");

      const insertedModel = await transaction
        .insert(recoveryDeviceModels)
        .values({ providerId: provider.id, key: input.modelKey })
        .onConflictDoNothing()
        .returning();
      const model = insertedModel[0] ?? await transaction.query.recoveryDeviceModels.findFirst({
        where: and(eq(recoveryDeviceModels.providerId, provider.id), eq(recoveryDeviceModels.key, input.modelKey))
      });
      if (!model) throw new Error("Recovery device model conflict did not resolve");

      const insertedVersion = await transaction
        .insert(recoveryDeviceModelVersions)
        .values({ modelId: model.id, version: input.version, name: input.name })
        .onConflictDoNothing()
        .returning();
      const version = insertedVersion[0] ?? await transaction.query.recoveryDeviceModelVersions.findFirst({
        where: and(eq(recoveryDeviceModelVersions.modelId, model.id), eq(recoveryDeviceModelVersions.version, input.version))
      });
      if (!version) throw new Error("Recovery device version conflict did not resolve");
      if (insertedVersion[0]) {
        await transaction.insert(recoveryDeviceCapabilities).values(
          input.capabilities.map((kind) => ({ modelVersionId: version.id, kind }))
        );
      }
      return this.hydrateModelVersion(transaction, version.id);
    });
  }

  private async hydrateModelVersion(transaction: DatabaseTransaction, id: string): Promise<RecoveryDeviceModelVersion> {
    const rows = await transaction
      .select({ version: recoveryDeviceModelVersions, model: recoveryDeviceModels, provider: recoveryProviders })
      .from(recoveryDeviceModelVersions)
      .innerJoin(recoveryDeviceModels, eq(recoveryDeviceModelVersions.modelId, recoveryDeviceModels.id))
      .innerJoin(recoveryProviders, eq(recoveryDeviceModels.providerId, recoveryProviders.id))
      .where(eq(recoveryDeviceModelVersions.id, id))
      .limit(1);
    if (!rows[0]) throw new NotFoundError("Recovery device model version was not found");
    const capabilities = await transaction
      .select({ kind: recoveryDeviceCapabilities.kind })
      .from(recoveryDeviceCapabilities)
      .where(eq(recoveryDeviceCapabilities.modelVersionId, id))
      .orderBy(asc(recoveryDeviceCapabilities.kind));
    return {
      id: rows[0].version.id,
      modelId: rows[0].model.id,
      providerKey: rows[0].provider.key,
      providerName: rows[0].provider.name,
      version: rows[0].version.version,
      name: rows[0].version.name,
      capabilities: capabilities.map((row) => row.kind),
      createdAt: rows[0].version.createdAt.toISOString()
    };
  }

  public createConnection(personId: string, input: CreateRecoveryConnection): Promise<RecoveryConnection> {
    return this.database.db.transaction(async (transaction) => {
      await lockPerson(transaction, personId);
      const modelRows = await transaction
        .select({ version: recoveryDeviceModelVersions, model: recoveryDeviceModels })
        .from(recoveryDeviceModelVersions)
        .innerJoin(recoveryDeviceModels, eq(recoveryDeviceModelVersions.modelId, recoveryDeviceModels.id))
        .where(eq(recoveryDeviceModelVersions.id, input.deviceModelVersionId))
        .limit(1);
      if (!modelRows[0]) throw new NotFoundError("Recovery device model version was not found");
      const inserted = await transaction
        .insert(recoveryConnections)
        .values({ personId, providerId: modelRows[0].model.providerId, dedupeKey: input.dedupeKey })
        .onConflictDoNothing()
        .returning();
      const connection = inserted[0] ?? await transaction.query.recoveryConnections.findFirst({
        where: and(eq(recoveryConnections.personId, personId), eq(recoveryConnections.dedupeKey, input.dedupeKey))
      });
      if (!connection) throw new Error("Recovery connection conflict did not resolve");
      if (inserted[0]) {
        await transaction.insert(recoveryDevices).values({
          personId,
          connectionId: connection.id,
          modelVersionId: input.deviceModelVersionId,
          label: input.label
        });
      }
      return this.hydrateConnection(transaction, personId, connection.id);
    });
  }

  private async hydrateConnection(transaction: DatabaseTransaction, personId: string, id: string): Promise<RecoveryConnection> {
    const rows = await transaction
      .select({ connection: recoveryConnections, device: recoveryDevices })
      .from(recoveryConnections)
      .innerJoin(recoveryDevices, eq(recoveryConnections.id, recoveryDevices.connectionId))
      .where(and(eq(recoveryConnections.id, id), eq(recoveryConnections.personId, personId)))
      .limit(1);
    if (!rows[0]) throw new NotFoundError("Recovery connection was not found");
    return {
      id: rows[0].connection.id,
      personId,
      status: rows[0].connection.status,
      device: {
        id: rows[0].device.id,
        label: rows[0].device.label,
        modelVersion: await this.hydrateModelVersion(transaction, rows[0].device.modelVersionId)
      },
      dedupeKey: rows[0].connection.dedupeKey,
      connectedAt: rows[0].connection.connectedAt.toISOString(),
      disconnectedAt: rows[0].connection.disconnectedAt?.toISOString() ?? null
    };
  }

  public grantConsent(personId: string, connectionId: string, input: GrantRecoveryConsent): Promise<RecoveryConsent> {
    return this.database.db.transaction(async (transaction) => {
      await lockPerson(transaction, personId);
      const connection = await transaction.query.recoveryConnections.findFirst({
        where: and(eq(recoveryConnections.id, connectionId), eq(recoveryConnections.personId, personId), eq(recoveryConnections.status, "active"))
      });
      if (!connection) throw new NotFoundError("Active Recovery connection was not found");
      const consentRows = await transaction.insert(recoveryConsents).values({
        personId,
        connectionId,
        purpose: input.purpose,
        retentionMode: input.retentionMode,
        retainUntil: input.retainUntil ? new Date(input.retainUntil) : null
      }).returning();
      const consent = consentRows[0];
      if (!consent) throw new Error("Recovery consent insert failed");
      await transaction.insert(recoveryConsentKinds).values(
        input.allowedKinds.map((kind) => ({ consentId: consent.id, kind }))
      );
      return this.hydrateConsent(transaction, personId, consent.id);
    });
  }

  public revokeConsent(personId: string, consentId: string, input: RevokeRecoveryConsent): Promise<RecoveryConsent> {
    return this.database.db.transaction(async (transaction) => {
      await lockPerson(transaction, personId);
      const updated = await transaction.update(recoveryConsents).set({
        status: "revoked",
        revokedAt: new Date(),
        revocationReason: input.reason
      }).where(and(eq(recoveryConsents.id, consentId), eq(recoveryConsents.personId, personId), eq(recoveryConsents.status, "active"))).returning();
      if (!updated[0]) {
        const existing = await transaction.query.recoveryConsents.findFirst({
          where: and(eq(recoveryConsents.id, consentId), eq(recoveryConsents.personId, personId))
        });
        if (!existing) throw new NotFoundError("Recovery consent was not found");
      }
      return this.hydrateConsent(transaction, personId, consentId);
    });
  }

  private async hydrateConsent(transaction: DatabaseTransaction, personId: string, id: string): Promise<RecoveryConsent> {
    const consent = await transaction.query.recoveryConsents.findFirst({
      where: and(eq(recoveryConsents.id, id), eq(recoveryConsents.personId, personId))
    });
    if (!consent) throw new NotFoundError("Recovery consent was not found");
    const kinds = await transaction.select({ kind: recoveryConsentKinds.kind }).from(recoveryConsentKinds)
      .where(eq(recoveryConsentKinds.consentId, id)).orderBy(asc(recoveryConsentKinds.kind));
    return {
      id: consent.id,
      personId,
      connectionId: consent.connectionId,
      purpose: consent.purpose,
      allowedKinds: kinds.map((row) => row.kind),
      retentionMode: consent.retentionMode,
      retainUntil: consent.retainUntil?.toISOString() ?? null,
      status: consent.status,
      grantedAt: consent.grantedAt.toISOString(),
      revokedAt: consent.revokedAt?.toISOString() ?? null
    };
  }

  private async assertDeviceConsent(transaction: DatabaseTransaction, personId: string, input: CreateRecoveryObservation): Promise<void> {
    if (input.sourceReference.channel !== "device") return;
    const rows = await transaction
      .select({ consent: recoveryConsents })
      .from(recoveryConsents)
      .innerJoin(recoveryConnections, and(
        eq(recoveryConsents.connectionId, recoveryConnections.id),
        eq(recoveryConsents.personId, recoveryConnections.personId)
      ))
      .innerJoin(recoveryDevices, eq(recoveryConnections.id, recoveryDevices.connectionId))
      .innerJoin(recoveryDeviceCapabilities, eq(recoveryDevices.modelVersionId, recoveryDeviceCapabilities.modelVersionId))
      .innerJoin(recoveryConsentKinds, eq(recoveryConsents.id, recoveryConsentKinds.consentId))
      .where(and(
        eq(recoveryConsents.id, input.consentId!),
        eq(recoveryConsents.connectionId, input.connectionId!),
        eq(recoveryConsents.personId, personId),
        eq(recoveryConsents.status, "active"),
        eq(recoveryConnections.status, "active"),
        eq(recoveryConsentKinds.kind, input.kind),
        eq(recoveryDeviceCapabilities.kind, input.kind),
        or(isNull(recoveryConsents.retainUntil), gte(recoveryConsents.retainUntil, new Date(input.observedUntil)))
      )).limit(1);
    if (!rows[0]) {
      throw new ConflictError("Device observation is not permitted by active consent and retention");
    }
  }

  public createObservation(personId: string, input: CreateRecoveryObservation): Promise<CreatedRecoveryObservation> {
    return this.database.db.transaction(async (transaction) => {
      await lockPerson(transaction, personId);
      return this.insertObservation(transaction, personId, input);
    });
  }

  private async insertObservation(
    transaction: DatabaseTransaction,
    personId: string,
    input: CreateRecoveryObservation | CorrectRecoveryObservation,
    correction?: { readonly supersedesId: string; readonly reason: string }
  ): Promise<CreatedRecoveryObservation> {
    const time = validateRecoveryObservation(input);
    await this.assertDeviceConsent(transaction, personId, input);
    const source = await ensureSourceReference(transaction, personId, input.sourceReference);
    const inserted = await transaction.insert(recoveryObservations).values({
      personId,
      kind: input.kind,
      observedFrom: time.from,
      observedUntil: time.until,
      localDate: time.localDate,
      timezone: input.timezone,
      quality: input.quality,
      source: input.sourceReference.channel,
      sourceReferenceId: source.row.id,
      connectionId: input.connectionId,
      consentId: input.consentId,
      dedupeKey: input.dedupeKey,
      supersedesId: correction?.supersedesId ?? null,
      correctionReason: correction?.reason ?? null
    }).onConflictDoNothing().returning();
    if (!inserted[0]) {
      await discardUnusedSourceReference(transaction, source);
      const existing = await transaction.query.recoveryObservations.findFirst({
        where: and(
          eq(recoveryObservations.personId, personId),
          eq(recoveryObservations.source, input.sourceReference.channel),
          eq(recoveryObservations.dedupeKey, input.dedupeKey)
        )
      });
      if (!existing) throw new ConflictError("Recovery observation conflict did not resolve");
      if (correction && existing.supersedesId !== correction.supersedesId) {
        throw new ConflictError("Recovery observation correction conflicts with current state");
      }
      return { created: false, observation: await this.hydrateObservation(transaction, existing) };
    }
    await this.insertObservationDetail(transaction, inserted[0].id, input.detail);
    return { created: true, observation: await this.hydrateObservation(transaction, inserted[0], source.row) };
  }

  private async insertObservationDetail(transaction: DatabaseTransaction, observationId: string, detail: RecoveryObservationDetail): Promise<void> {
    if (detail.type === "sleep") {
      await transaction.insert(recoverySleepDetails).values({ observationId, totalSleepMinutes: detail.totalSleepMinutes, sleepQuality: detail.sleepQuality });
    } else if (detail.type === "metric") {
      await transaction.insert(recoveryMetricDetails).values({ observationId, metric: detail.metric, value: detail.value.toFixed(3), unit: detail.unit });
    } else {
      await transaction.insert(recoverySubjectiveDetails).values({
        observationId,
        energy: detail.energy,
        fatigue: detail.fatigue,
        muscleSoreness: detail.muscleSoreness,
        stress: detail.stress,
        sleepQuality: detail.sleepQuality,
        acuteIllness: detail.acuteIllness,
        injuryConcern: detail.injuryConcern
      });
    }
  }

  public correctObservation(personId: string, id: string, input: CorrectRecoveryObservation): Promise<CreatedRecoveryObservation> {
    return this.database.db.transaction(async (transaction) => {
      await lockPerson(transaction, personId);
      const original = await transaction.query.recoveryObservations.findFirst({
        where: and(eq(recoveryObservations.id, id), eq(recoveryObservations.personId, personId))
      });
      if (!original) throw new NotFoundError("Recovery observation was not found");
      const successor = await transaction.query.recoveryObservations.findFirst({
        where: eq(recoveryObservations.supersedesId, id)
      });
      if (successor) {
        if (successor.source === input.sourceReference.channel && successor.dedupeKey === input.dedupeKey) {
          return { created: false, observation: await this.hydrateObservation(transaction, successor) };
        }
        throw new ConflictError("Recovery observation was already superseded");
      }
      return this.insertObservation(transaction, personId, input, { supersedesId: id, reason: input.reason });
    });
  }

  public async findObservation(personId: string, id: string): Promise<RecoveryObservation | null> {
    const row = await this.database.db.query.recoveryObservations.findFirst({
      where: and(eq(recoveryObservations.id, id), eq(recoveryObservations.personId, personId))
    });
    return row ? this.database.db.transaction((tx) => this.hydrateObservation(tx, row)) : null;
  }

  public listObservations(personId: string, query: ListRecoveryObservationsQuery): Promise<RecoveryObservationList> {
    return this.database.db.transaction(async (transaction) => {
      const successor = alias(recoveryObservations, "recovery_observation_successor");
      const filters = [
        eq(recoveryObservations.personId, personId),
        notExists(transaction.select({ id: successor.id }).from(successor).where(eq(successor.supersedesId, recoveryObservations.id)))
      ];
      if (query.kind) filters.push(eq(recoveryObservations.kind, query.kind));
      if (query.localDate) filters.push(eq(recoveryObservations.localDate, query.localDate));
      const rows = await transaction.select().from(recoveryObservations)
        .where(and(...filters)).orderBy(desc(recoveryObservations.observedUntil), desc(recoveryObservations.id))
        .limit(query.limit ?? 50);
      return { items: await Promise.all(rows.map((row) => this.hydrateObservation(transaction, row))) };
    });
  }

  /** {@inheritDoc RecoveryStore.listObservationsForLocalDate} */
  public listObservationsForLocalDate(personId: string, localDate: string): Promise<readonly RecoveryObservation[]> {
    return this.database.db.transaction(async (transaction) => {
      const successor = alias(recoveryObservations, "daily_recovery_successor");
      const rows = await transaction.select().from(recoveryObservations).where(and(
        eq(recoveryObservations.personId, personId),
        eq(recoveryObservations.localDate, localDate),
        notExists(transaction.select({ id: successor.id }).from(successor).where(eq(successor.supersedesId, recoveryObservations.id)))
      )).orderBy(desc(recoveryObservations.observedUntil), desc(recoveryObservations.id));
      return Promise.all(rows.map((row) => this.hydrateObservation(transaction, row)));
    });
  }

  /** {@inheritDoc RecoveryStore.listObservationsForLocalDateRange} */
  public listObservationsForLocalDateRange(personId: string, from: string, to: string): Promise<readonly RecoveryObservation[]> {
    return this.database.db.transaction(async (transaction) => {
      const successor = alias(recoveryObservations, "range_recovery_successor");
      const rows = await transaction.select().from(recoveryObservations).where(and(
        eq(recoveryObservations.personId, personId),
        gte(recoveryObservations.localDate, from),
        lte(recoveryObservations.localDate, to),
        notExists(transaction.select({ id: successor.id }).from(successor).where(eq(successor.supersedesId, recoveryObservations.id)))
      )).orderBy(desc(recoveryObservations.localDate), desc(recoveryObservations.observedUntil), desc(recoveryObservations.id));
      return Promise.all(rows.map((row) => this.hydrateObservation(transaction, row)));
    });
  }

  public observationHistory(personId: string, id: string): Promise<RecoveryObservationHistory | null> {
    return this.database.db.transaction(async (transaction) => {
      const all = await transaction.select().from(recoveryObservations)
        .where(eq(recoveryObservations.personId, personId)).orderBy(asc(recoveryObservations.createdAt));
      const byId = new Map(all.map((row) => [row.id, row]));
      let current = byId.get(id);
      if (!current) return null;
      while (current.supersedesId && byId.has(current.supersedesId)) current = byId.get(current.supersedesId)!;
      const chain: RecoveryObservationRow[] = [];
      while (current) {
        chain.push(current);
        current = all.find((row) => row.supersedesId === current!.id);
      }
      return { items: await Promise.all(chain.map((row) => this.hydrateObservation(transaction, row))) };
    });
  }

  private async hydrateObservation(transaction: DatabaseTransaction, row: RecoveryObservationRow, knownSource?: SourceReferenceRow): Promise<RecoveryObservation> {
    const source = knownSource ?? await transaction.query.sourceReferences.findFirst({ where: eq(sourceReferences.id, row.sourceReferenceId) });
    if (!source) throw new Error("Recovery observation source reference is missing");
    let detail: RecoveryObservationDetail;
    if (row.kind === "sleep") {
      const item = await transaction.query.recoverySleepDetails.findFirst({ where: eq(recoverySleepDetails.observationId, row.id) });
      if (!item) throw new Error("Recovery sleep detail is missing");
      detail = { type: "sleep", totalSleepMinutes: item.totalSleepMinutes, sleepQuality: item.sleepQuality };
    } else if (row.kind === "metric") {
      const item = await transaction.query.recoveryMetricDetails.findFirst({ where: eq(recoveryMetricDetails.observationId, row.id) });
      if (!item) throw new Error("Recovery metric detail is missing");
      detail = { type: "metric", metric: item.metric, value: Number(item.value), unit: item.unit };
    } else {
      const item = await transaction.query.recoverySubjectiveDetails.findFirst({ where: eq(recoverySubjectiveDetails.observationId, row.id) });
      if (!item) throw new Error("Recovery subjective detail is missing");
      detail = { type: "subjective", energy: item.energy, fatigue: item.fatigue, muscleSoreness: item.muscleSoreness, stress: item.stress, sleepQuality: item.sleepQuality, acuteIllness: item.acuteIllness, injuryConcern: item.injuryConcern };
    }
    return {
      id: row.id,
      personId: row.personId,
      kind: row.kind,
      observedFrom: row.observedFrom.toISOString(),
      observedUntil: row.observedUntil.toISOString(),
      localDate: row.localDate,
      timezone: row.timezone,
      quality: row.quality,
      connectionId: row.connectionId,
      consentId: row.consentId,
      dedupeKey: row.dedupeKey,
      sourceReference: toSourceReference(source),
      detail,
      supersedesId: row.supersedesId,
      correctionReason: row.correctionReason,
      createdAt: row.createdAt.toISOString()
    };
  }

  public registerPolicyVersion(input: RegisterRecoveryPolicyVersion): Promise<string> {
    return this.database.db.transaction(async (transaction) => {
      const insertedPolicy = await transaction.insert(recoveryAssessmentPolicies).values({ key: input.policyKey, name: input.policyName }).onConflictDoNothing().returning();
      const policy = insertedPolicy[0] ?? await transaction.query.recoveryAssessmentPolicies.findFirst({ where: eq(recoveryAssessmentPolicies.key, input.policyKey) });
      if (!policy) throw new Error("Recovery policy conflict did not resolve");
      const inserted = await transaction.insert(recoveryAssessmentPolicyVersions).values({
        policyId: policy.id,
        version: input.version,
        effectiveFrom: new Date(input.effectiveFrom),
        effectiveUntil: input.effectiveUntil ? new Date(input.effectiveUntil) : null,
        analysisWindowDays: input.analysisWindowDays,
        minimumObservations: input.minimumObservations,
        sufficientObservations: input.sufficientObservations,
        insufficientConfidenceCap: input.insufficientConfidenceCap.toFixed(3),
        poorQualityConfidenceCap: input.poorQualityConfidenceCap.toFixed(3),
        targetSleepMinutes: input.targetSleepMinutes,
        fatigueWeight: input.fatigueWeight.toFixed(3),
        sorenessWeight: input.sorenessWeight.toFixed(3),
        stressWeight: input.stressWeight.toFixed(3),
        lowEnergyWeight: input.lowEnergyWeight.toFixed(3),
        lowSleepQualityWeight: input.lowSleepQualityWeight.toFixed(3),
        sleepDeficitWeight: input.sleepDeficitWeight.toFixed(3),
        externalSetWeight: input.externalSetWeight.toFixed(3),
        bodyweightSetWeight: input.bodyweightSetWeight.toFixed(3),
        assistedSetWeight: input.assistedSetWeight.toFixed(3),
        moderateRiskThreshold: input.moderateRiskThreshold.toFixed(3),
        highRiskThreshold: input.highRiskThreshold.toFixed(3)
      }).onConflictDoNothing().returning();
      const row = inserted[0] ?? await transaction.query.recoveryAssessmentPolicyVersions.findFirst({
        where: and(eq(recoveryAssessmentPolicyVersions.policyId, policy.id), eq(recoveryAssessmentPolicyVersions.version, input.version))
      });
      if (!row) throw new Error("Recovery policy version conflict did not resolve");
      return row.id;
    });
  }

  public createAssessment(personId: string, input: CreateRecoveryAssessment): Promise<CreatedRecoveryAssessment> {
    return this.database.db.transaction(async (transaction) => {
      await lockPerson(transaction, personId);
      const asOf = new Date(input.asOf);
      if (Number.isNaN(asOf.valueOf())) throw new DomainValidationError("Assessment asOf is invalid");
      const policy = await transaction.query.recoveryAssessmentPolicyVersions.findFirst({
        where: and(
          eq(recoveryAssessmentPolicyVersions.id, input.policyVersionId),
          lte(recoveryAssessmentPolicyVersions.effectiveFrom, asOf),
          or(isNull(recoveryAssessmentPolicyVersions.effectiveUntil), gte(recoveryAssessmentPolicyVersions.effectiveUntil, asOf))
        )
      });
      if (!policy) throw new NotFoundError("Effective Recovery policy version was not found");
      const windowStart = new Date(asOf.valueOf() - policy.analysisWindowDays * 86_400_000);
      const successor = alias(recoveryObservations, "assessment_observation_successor");
      const roots = await transaction.select({ observation: recoveryObservations })
        .from(recoveryObservations)
        .leftJoin(recoveryConsents, eq(recoveryObservations.consentId, recoveryConsents.id))
        .where(and(
          eq(recoveryObservations.personId, personId),
          gte(recoveryObservations.observedUntil, windowStart),
          lte(recoveryObservations.observedUntil, asOf),
          notExists(transaction.select({ id: successor.id }).from(successor).where(eq(successor.supersedesId, recoveryObservations.id))),
          or(isNull(recoveryObservations.consentId), isNull(recoveryConsents.retainUntil), gte(recoveryConsents.retainUntil, asOf))
        )).orderBy(asc(recoveryObservations.observedUntil));
      const observations = await Promise.all(roots.map((item) => this.hydrateObservation(transaction, item.observation)));
      const observationEvidence: RecoveryObservationEvidence[] = observations.map((item) => ({ id: item.id, quality: item.quality, detail: item.detail }));

      const workoutSuccessor = alias(workoutSessions, "recovery_workout_successor");
      const trainingRows = await transaction.select({
        sessionId: workoutSessions.id,
        loadBasis: performedExercises.loadBasis,
        setCount: sql<number>`count(${performedSets.id})::int`
      }).from(workoutSessions)
        .innerJoin(performedExercises, eq(workoutSessions.id, performedExercises.sessionId))
        .innerJoin(performedSets, eq(performedExercises.id, performedSets.performedExerciseId))
        .where(and(
          eq(workoutSessions.personId, personId),
          gte(workoutSessions.occurredAt, windowStart),
          lte(workoutSessions.occurredAt, asOf),
          notExists(transaction.select({ id: workoutSuccessor.id }).from(workoutSuccessor).where(eq(workoutSuccessor.supersedesId, workoutSessions.id)))
        )).groupBy(workoutSessions.id, performedExercises.loadBasis);
      const sessionIds = [...new Set(trainingRows.map((row) => row.sessionId))].sort();
      const counts = (basis: "external_weight" | "body_weight" | "assisted") => trainingRows.filter((row) => row.loadBasis === basis).reduce((sum, row) => sum + Number(row.setCount), 0);
      const parameters = this.policyParameters(policy);
      const evaluation = evaluateRecovery(parameters, observationEvidence, {
        sessionIds,
        externalSetCount: counts("external_weight"),
        bodyweightSetCount: counts("body_weight"),
        assistedSetCount: counts("assisted")
      });
      const evidenceChecksum = createHash("sha256").update(JSON.stringify({
        policyVersionId: policy.id,
        observations: observations.map((item) => item.id).sort(),
        sessions: sessionIds,
        windowStart: windowStart.toISOString(),
        asOf: asOf.toISOString()
      })).digest("hex");
      const inserted = await transaction.insert(recoveryAssessments).values({
        personId,
        policyVersionId: policy.id,
        asOf,
        windowStart,
        windowEnd: asOf,
        localDate: deriveLocalDate(asOf, input.timezone),
        timezone: input.timezone,
        readinessScore: evaluation.readinessScore.toFixed(3),
        riskLevel: evaluation.riskLevel,
        confidence: evaluation.confidence.toFixed(3),
        dataQuality: evaluation.dataQuality,
        hardStop: evaluation.hardStop,
        evidenceChecksum,
        calculationSnapshot: evaluation.calculation,
        dedupeKey: input.dedupeKey
      }).onConflictDoNothing().returning();
      let assessment = inserted[0];
      if (!assessment) {
        assessment = await transaction.query.recoveryAssessments.findFirst({
          where: and(eq(recoveryAssessments.personId, personId), or(
            eq(recoveryAssessments.dedupeKey, input.dedupeKey),
            and(eq(recoveryAssessments.policyVersionId, policy.id), eq(recoveryAssessments.evidenceChecksum, evidenceChecksum))
          ))
        });
        if (!assessment) throw new ConflictError("Recovery assessment conflict did not resolve");
        return { created: false, assessment: await this.hydrateAssessment(transaction, assessment) };
      }
      if (observations.length) {
        await transaction.insert(recoveryAssessmentObservationEvidence).values(observations.map((item) => ({ assessmentId: assessment!.id, observationId: item.id, personId })));
      }
      if (sessionIds.length) {
        await transaction.insert(recoveryAssessmentTrainingEvidence).values(sessionIds.map((sessionId) => ({ assessmentId: assessment!.id, workoutSessionId: sessionId, personId })));
      }
      return { created: true, assessment: await this.hydrateAssessment(transaction, assessment) };
    });
  }

  private policyParameters(row: typeof recoveryAssessmentPolicyVersions.$inferSelect): RecoveryPolicyParameters {
    return {
      analysisWindowDays: row.analysisWindowDays,
      minimumObservations: row.minimumObservations,
      sufficientObservations: row.sufficientObservations,
      insufficientConfidenceCap: Number(row.insufficientConfidenceCap),
      poorQualityConfidenceCap: Number(row.poorQualityConfidenceCap),
      targetSleepMinutes: row.targetSleepMinutes,
      fatigueWeight: Number(row.fatigueWeight),
      sorenessWeight: Number(row.sorenessWeight),
      stressWeight: Number(row.stressWeight),
      lowEnergyWeight: Number(row.lowEnergyWeight),
      lowSleepQualityWeight: Number(row.lowSleepQualityWeight),
      sleepDeficitWeight: Number(row.sleepDeficitWeight),
      externalSetWeight: Number(row.externalSetWeight),
      bodyweightSetWeight: Number(row.bodyweightSetWeight),
      assistedSetWeight: Number(row.assistedSetWeight),
      moderateRiskThreshold: Number(row.moderateRiskThreshold),
      highRiskThreshold: Number(row.highRiskThreshold)
    };
  }

  public async findAssessment(personId: string, id: string): Promise<RecoveryAssessment | null> {
    const row = await this.database.db.query.recoveryAssessments.findFirst({ where: and(eq(recoveryAssessments.id, id), eq(recoveryAssessments.personId, personId)) });
    return row ? this.database.db.transaction((tx) => this.hydrateAssessment(tx, row)) : null;
  }

  public listAssessments(personId: string, limit: number): Promise<RecoveryAssessmentList> {
    return this.database.db.transaction(async (transaction) => {
      const rows = await transaction.select().from(recoveryAssessments).where(eq(recoveryAssessments.personId, personId)).orderBy(desc(recoveryAssessments.asOf), desc(recoveryAssessments.id)).limit(limit);
      return { items: await Promise.all(rows.map((row) => this.hydrateAssessment(transaction, row))) };
    });
  }

  /** {@inheritDoc RecoveryStore.listAssessmentsForLocalDate} */
  public listAssessmentsForLocalDate(personId: string, localDate: string): Promise<readonly RecoveryAssessment[]> {
    return this.database.db.transaction(async (transaction) => {
      const rows = await transaction.select().from(recoveryAssessments).where(and(
        eq(recoveryAssessments.personId, personId),
        eq(recoveryAssessments.localDate, localDate)
      )).orderBy(desc(recoveryAssessments.asOf), desc(recoveryAssessments.id));
      return Promise.all(rows.map((row) => this.hydrateAssessment(transaction, row)));
    });
  }

  /** {@inheritDoc RecoveryStore.listAssessmentsForLocalDateRange} */
  public listAssessmentsForLocalDateRange(personId: string, from: string, to: string): Promise<readonly RecoveryAssessment[]> {
    return this.database.db.transaction(async (transaction) => {
      const rows = await transaction.select().from(recoveryAssessments).where(and(
        eq(recoveryAssessments.personId, personId),
        gte(recoveryAssessments.localDate, from),
        lte(recoveryAssessments.localDate, to)
      )).orderBy(desc(recoveryAssessments.localDate), desc(recoveryAssessments.asOf), desc(recoveryAssessments.id));
      return Promise.all(rows.map((row) => this.hydrateAssessment(transaction, row)));
    });
  }

  private async hydrateAssessment(transaction: DatabaseTransaction, row: RecoveryAssessmentRow): Promise<RecoveryAssessment> {
    const observationIds = await transaction.select({ id: recoveryAssessmentObservationEvidence.observationId }).from(recoveryAssessmentObservationEvidence).where(eq(recoveryAssessmentObservationEvidence.assessmentId, row.id)).orderBy(asc(recoveryAssessmentObservationEvidence.observationId));
    const sessionIds = await transaction.select({ id: recoveryAssessmentTrainingEvidence.workoutSessionId }).from(recoveryAssessmentTrainingEvidence).where(eq(recoveryAssessmentTrainingEvidence.assessmentId, row.id)).orderBy(asc(recoveryAssessmentTrainingEvidence.workoutSessionId));
    return {
      id: row.id,
      personId: row.personId,
      policyVersionId: row.policyVersionId,
      asOf: row.asOf.toISOString(),
      windowStart: row.windowStart.toISOString(),
      windowEnd: row.windowEnd.toISOString(),
      localDate: row.localDate,
      timezone: row.timezone,
      readinessScore: Number(row.readinessScore),
      riskLevel: row.riskLevel,
      confidence: Number(row.confidence),
      dataQuality: row.dataQuality,
      hardStop: row.hardStop,
      evidenceChecksum: row.evidenceChecksum,
      observationIds: observationIds.map((item) => item.id),
      workoutSessionIds: sessionIds.map((item) => item.id),
      calculation: row.calculationSnapshot,
      dedupeKey: row.dedupeKey,
      createdAt: row.createdAt.toISOString()
    };
  }
}
