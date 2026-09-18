import { and, asc, eq, isNull, sql } from "drizzle-orm";
import { createHash, randomUUID } from "node:crypto";

import type {
  DailyAssessmentAvailable,
  DailyAssessmentAvailableV1,
  DailyAssessmentPersonalBaseline,
  DailyAssessmentMovement,
  DailyAssessmentV2UsedFacts,
  CreateDailyRecommendationFeedback,
  DailyRecommendationFeedback,
  DailyRecommendationFeedbackList,
  PersonPreferences
} from "@shape-of-you/contracts";
import type { DailyAssessmentPersonalCalculation } from "../domain/personalized-daily-assessment.js";

import type { DatabaseContext } from "../database/context.js";
import {
  ConflictError,
  DailyAssessmentEvidenceChangedError,
  DomainValidationError,
  NotFoundError
} from "../domain/errors.js";
import {
  lockPersonEvidenceMutation,
  type DatabaseTransaction
} from "./source-reference-repository.js";
import {
  coachingDailyAssessmentAssessmentEvidence,
  coachingDailyAssessmentDetails,
  coachingDailyAssessmentRecoveryEvidence,
  coachingDailyAssessmentTrainingEvidence,
  coachingDailyRecommendationFeedback,
  coachingPolicies,
  coachingPolicyVersions,
  coachingRecommendations,
  persons
} from "../database/schema.js";

type DailyAssessmentSnapshotBase = Omit<
  DailyAssessmentAvailableV1,
  "snapshotId" | "createdAt" | "state" | "policyVersion"
>;

export type DailyAssessmentSnapshotInput = DailyAssessmentSnapshotBase & (
  | {
      readonly policyVersion: "daily-assessment-v1";
      readonly personalBaseline?: never;
      readonly personalBaselineCalculation?: never;
    }
  | {
      readonly policyVersion: "daily-assessment-v2";
      readonly usedFacts: DailyAssessmentV2UsedFacts;
      readonly personalBaseline: DailyAssessmentPersonalBaseline;
      readonly personalBaselineCalculation: DailyAssessmentPersonalCalculation;
    }
  | {
      readonly policyVersion: "daily-assessment-v3";
      readonly usedFacts: DailyAssessmentV2UsedFacts;
      readonly personalBaseline: DailyAssessmentPersonalBaseline & {
        readonly policyVersion: "personal-baseline-v2";
      };
      readonly personalBaselineCalculation: DailyAssessmentPersonalCalculation;
      readonly movement: DailyAssessmentMovement;
    }
);

export interface DailyAssessmentConsistencyGuard {
  readonly expectedRevision: string;
  readonly expectedTimezone: string;
  readonly expectedPreferencesUpdatedAt: string;
  readonly from: string;
  readonly to: string;
}

/** Result of an idempotent daily-recommendation feedback command. */
export interface CreatedDailyRecommendationFeedback {
  readonly created: boolean;
  readonly feedback: DailyRecommendationFeedback;
}

function evidenceRevisionQuery(personId: string, from: string, to: string) {
  return sql<{ revision: unknown }>`select jsonb_build_object(
    'person', (select jsonb_build_array(timezone, updated_at) from persons where id = ${personId}),
    'sources', (select md5(coalesce(string_agg(concat_ws('|', id::text, evidence_purpose::text), ',' order by id), '')) from source_references where person_id = ${personId}),
    'recovery_connections', (select md5(coalesce(string_agg(concat_ws('|', id::text, erasure_requested_at::text), ',' order by id), '')) from recovery_connections where person_id = ${personId}),
    'recovery_observations', (select md5(coalesce(string_agg(concat_ws('|', id::text, withdrawn_at::text, supersedes_id::text, quality::text), ',' order by id), '')) from recovery_observations where person_id = ${personId} and local_date between ${from} and ${to}),
    'recovery_assessments', (select md5(coalesce(string_agg(concat_ws('|', id::text, evidence_checksum), ',' order by id), '')) from recovery_assessments where person_id = ${personId} and local_date between ${from} and ${to}),
    'workout_sessions', (select md5(coalesce(string_agg(concat_ws('|', id::text, supersedes_id::text), ',' order by id), '')) from workout_sessions where person_id = ${personId}),
    'training_programs', (select md5(coalesce(string_agg(concat_ws('|', id::text, current_version_id::text, active_version_id::text, lock_version::text), ',' order by id), '')) from training_programs where person_id = ${personId}),
    'integration_connections', (select md5(coalesce(string_agg(concat_ws('|', id::text, recovery_connection_id::text, consent_id::text, lifecycle::text), ',' order by id), '')) from integration_connections where person_id = ${personId}),
    'integration_activities', (select md5(coalesce(string_agg(concat_ws('|', id::text, normalized_checksum, supersedes_id::text), ',' order by id), '')) from integration_activity_facts where person_id = ${personId}),
    'meals', (select md5(coalesce(string_agg(concat_ws('|', id::text, supersedes_id::text), ',' order by id), '')) from meals where person_id = ${personId} and local_date between ${from} and ${to}),
    'weights', (select md5(coalesce(string_agg(concat_ws('|', id::text, supersedes_id::text), ',' order by id), '')) from weight_measurements where person_id = ${personId} and local_date between ${from} and ${to}),
    'context_notes', (select md5(coalesce(string_agg(concat_ws('|', id::text, supersedes_id::text, baseline_eligibility::text), ',' order by id), '')) from daily_context_notes where person_id = ${personId} and local_date between ${from} and ${to})
  ) as revision`;
}

async function readEvidenceRevision(
  executor: Pick<DatabaseContext["db"], "execute"> | DatabaseTransaction,
  personId: string,
  from: string,
  to: string
): Promise<string> {
  const result = await executor.execute(evidenceRevisionQuery(personId, from, to));
  return createHash("sha256").update(JSON.stringify(result.rows[0]?.revision ?? null)).digest("hex");
}

/** Persistence boundary for Person timezone and immutable Coaching daily snapshots. */
export interface DailyAssessmentStore {
  getPreferences(personId: string): Promise<PersonPreferences>;
  setTimezone(
    personId: string,
    timezone: string,
    options?: { readonly ifUnset?: boolean }
  ): Promise<PersonPreferences>;
  getEvidenceRevision(personId: string, from: string, to: string): Promise<string>;
  createOrGet(personId: string, input: DailyAssessmentSnapshotInput, guard?: DailyAssessmentConsistencyGuard): Promise<DailyAssessmentAvailable>;
  recordFeedback(
    personId: string,
    input: CreateDailyRecommendationFeedback
  ): Promise<CreatedDailyRecommendationFeedback>;
  listFeedback(
    personId: string,
    snapshotId: string
  ): Promise<DailyRecommendationFeedbackList>;
}

/** PostgreSQL implementation of the daily assessment persistence boundary. */
export class DailyAssessmentRepository implements DailyAssessmentStore {
  public constructor(private readonly database: DatabaseContext) {}

  public async getPreferences(personId: string): Promise<PersonPreferences> {
    const rows = await this.database.db.select({ timezone: persons.timezone, updatedAt: persons.updatedAt }).from(persons).where(eq(persons.id, personId)).limit(1);
    if (!rows[0]) throw new Error("Authorized Person was not found");
    return { timezone: rows[0].timezone, updatedAt: rows[0].updatedAt.toISOString() };
  }

  public async setTimezone(
    personId: string,
    timezone: string,
    options: { readonly ifUnset?: boolean } = {}
  ): Promise<PersonPreferences> {
    return this.database.db.transaction(async (transaction) => {
      await lockPersonEvidenceMutation(transaction, personId);
      const rows = await transaction.update(persons).set({ timezone, updatedAt: new Date() })
        .where(options.ifUnset === true
          ? and(eq(persons.id, personId), isNull(persons.timezone))
          : eq(persons.id, personId))
        .returning({ timezone: persons.timezone, updatedAt: persons.updatedAt });
      const current = rows[0] ?? (await transaction.select({
        timezone: persons.timezone,
        updatedAt: persons.updatedAt
      }).from(persons).where(eq(persons.id, personId)).limit(1))[0];
      if (!current) throw new Error("Authorized Person was not found");
      return { timezone: current.timezone, updatedAt: current.updatedAt.toISOString() };
    });
  }

  /** Returns one statement-consistent revision of every live-read dependency. */
  public async getEvidenceRevision(personId: string, from: string, to: string): Promise<string> {
    return readEvidenceRevision(this.database.db, personId, from, to);
  }

  public createOrGet(personId: string, input: DailyAssessmentSnapshotInput, guard?: DailyAssessmentConsistencyGuard): Promise<DailyAssessmentAvailable> {
    if ((input.policyVersion === "daily-assessment-v2" || input.policyVersion === "daily-assessment-v3") &&
        (input.personalBaseline === undefined || input.personalBaselineCalculation === undefined)) {
      throw new Error("Personalized daily assessment requires its versioned baseline payload");
    }
    if (input.policyVersion === "daily-assessment-v3" && input.movement === undefined) {
      throw new Error("Daily assessment v3 requires its movement payload");
    }
    if (input.policyVersion === "daily-assessment-v1" &&
        (input.personalBaseline !== undefined || input.personalBaselineCalculation !== undefined ||
         "movement" in input)) {
      throw new Error("Daily assessment v1 cannot carry a personal-baseline payload");
    }
    return this.database.db.transaction(async (transaction) => {
      await lockPersonEvidenceMutation(transaction, personId);
      if (guard) {
        const preferences = await transaction.select({
          timezone: persons.timezone,
          updatedAt: persons.updatedAt
        }).from(persons).where(eq(persons.id, personId)).limit(1);
        if (!preferences[0] ||
            preferences[0].timezone !== guard.expectedTimezone ||
            preferences[0].updatedAt.toISOString() !== guard.expectedPreferencesUpdatedAt) {
          throw new DailyAssessmentEvidenceChangedError();
        }
        const finalRevision = await readEvidenceRevision(
          transaction,
          personId,
          guard.from,
          guard.to
        );
        if (finalRevision !== guard.expectedRevision) {
          throw new DailyAssessmentEvidenceChangedError();
        }
      }
      const existing = await transaction.select({ recommendation: coachingRecommendations, detail: coachingDailyAssessmentDetails })
        .from(coachingRecommendations)
        .innerJoin(coachingDailyAssessmentDetails, eq(coachingDailyAssessmentDetails.recommendationId, coachingRecommendations.id))
        .where(and(eq(coachingRecommendations.personId, personId), eq(coachingRecommendations.evidenceChecksum, input.evidenceChecksum), eq(coachingDailyAssessmentDetails.localDate, input.localDate), eq(coachingDailyAssessmentDetails.timezone, input.timezone)))
        .limit(1);
      if (existing[0]) return this.hydrate(existing[0].recommendation, existing[0].detail);

      const policyRows = await transaction.insert(coachingPolicies).values({ key: "daily-assessment", name: "Daily assessment" }).onConflictDoNothing().returning();
      const policy = policyRows[0] ?? (await transaction.select().from(coachingPolicies).where(eq(coachingPolicies.key, "daily-assessment")).limit(1))[0];
      if (!policy) throw new Error("Daily assessment policy could not be resolved");
      const policyVersionNumber = input.policyVersion === "daily-assessment-v3"
        ? 3
        : input.policyVersion === "daily-assessment-v2" ? 2 : 1;
      const versionRows = await transaction.insert(coachingPolicyVersions).values({
        policyId: policy.id,
        version: policyVersionNumber,
        effectiveFrom: new Date(
          policyVersionNumber === 3
            ? "2026-09-17T00:00:00.000Z"
            : policyVersionNumber === 2
            ? "2026-09-17T00:00:00.000Z"
            : "2026-09-14T00:00:00.000Z"
        ),
        effectiveUntil: null,
        recommendationTtlMinutes: 1440,
        minimumConfidence: "0.500",
        highRiskLoadFactor: "0.800",
        repetitionReduction: 1
      }).onConflictDoNothing().returning();
      const version = versionRows[0] ?? (await transaction.select().from(coachingPolicyVersions).where(and(eq(coachingPolicyVersions.policyId, policy.id), eq(coachingPolicyVersions.version, policyVersionNumber))).limit(1))[0];
      if (!version) throw new Error("Daily assessment policy version could not be resolved");
      const now = new Date();
      const inserted = await transaction.insert(coachingRecommendations).values({
        personId,
        kind: "daily_next_action",
        policyVersionId: version.id,
        asOf: now,
        expiresAt: new Date(now.valueOf() + 86_400_000),
        evidenceChecksum: input.evidenceChecksum,
        explanation: input.recommendedAction.text,
        dedupeKey: `daily:${input.localDate}:${input.timezone}:${input.evidenceChecksum}`
      }).onConflictDoNothing().returning();
      const recommendation = inserted[0] ?? (await transaction.select().from(coachingRecommendations).where(and(eq(coachingRecommendations.personId, personId), eq(coachingRecommendations.policyVersionId, version.id), eq(coachingRecommendations.evidenceChecksum, input.evidenceChecksum))).limit(1))[0];
      if (!recommendation) throw new Error("Daily assessment snapshot conflict could not be resolved");
      await transaction.insert(coachingDailyAssessmentDetails).values({
        recommendationId: recommendation.id,
        personId,
        localDate: input.localDate,
        timezone: input.timezone,
        status: input.status,
        confidence: input.confidence.toFixed(3),
        policyVersion: input.policyVersion,
        usedFacts: input.usedFacts,
        missingImportantData: [...input.missingImportantData],
        reasons: [...input.reasons],
        recommendedAction: input.recommendedAction,
        alternatives: [...input.alternatives],
        limitations: [...input.limitations],
        personalBaseline: input.personalBaseline ?? null,
        personalBaselineCalculation: input.personalBaselineCalculation ?? null,
        movement: "movement" in input ? input.movement : null
      }).onConflictDoNothing();
      if (input.usedFacts.recoveryObservationIds.length > 0) {
        await transaction.insert(coachingDailyAssessmentRecoveryEvidence).values(
          input.usedFacts.recoveryObservationIds.map((observationId) => ({
            recommendationId: recommendation.id,
            personId,
            observationId
          }))
        ).onConflictDoNothing();
      }
      if (input.usedFacts.recoveryAssessmentIds.length > 0) {
        await transaction.insert(coachingDailyAssessmentAssessmentEvidence).values(
          input.usedFacts.recoveryAssessmentIds.map((assessmentId) => ({
            recommendationId: recommendation.id,
            personId,
            assessmentId
          }))
        ).onConflictDoNothing();
      }
      if (input.usedFacts.externalActivityIds.length > 0) {
        await transaction.insert(coachingDailyAssessmentTrainingEvidence).values(
          input.usedFacts.externalActivityIds.map((activityId) => ({
            recommendationId: recommendation.id,
            personId,
            activityId
          }))
        ).onConflictDoNothing();
      }
      const detail = (await transaction.select().from(coachingDailyAssessmentDetails).where(eq(coachingDailyAssessmentDetails.recommendationId, recommendation.id)).limit(1))[0];
      if (!detail) throw new Error("Daily assessment detail was not stored");
      return this.hydrate(recommendation, detail);
    });
  }

  public recordFeedback(
    personId: string,
    input: CreateDailyRecommendationFeedback
  ): Promise<CreatedDailyRecommendationFeedback> {
    const comment = normalizeFeedbackComment(input.comment);
    validateFeedbackIdempotencyKey(input.idempotencyKey);
    return this.database.db.transaction(async (transaction) => {
      await lockPersonEvidenceMutation(transaction, personId);
      const snapshot = await transaction.select({
        recommendationId: coachingDailyAssessmentDetails.recommendationId
      }).from(coachingDailyAssessmentDetails).where(and(
        eq(coachingDailyAssessmentDetails.recommendationId, input.snapshotId),
        eq(coachingDailyAssessmentDetails.personId, personId)
      )).limit(1);
      if (!snapshot[0]) {
        throw new NotFoundError("Daily recommendation snapshot was not found");
      }

      const existingKey = await transaction.select()
        .from(coachingDailyRecommendationFeedback)
        .where(and(
          eq(coachingDailyRecommendationFeedback.personId, personId),
          eq(coachingDailyRecommendationFeedback.idempotencyKey, input.idempotencyKey)
        ))
        .limit(1);
      if (existingKey[0]) {
        if (
          existingKey[0].recommendationId !== input.snapshotId ||
          existingKey[0].status !== input.status ||
          existingKey[0].comment !== comment
        ) {
          throw new ConflictError("Feedback idempotency key is already used");
        }
        return { created: false, feedback: hydrateFeedback(existingKey[0]) };
      }

      const existingStatus = await transaction.select({
        id: coachingDailyRecommendationFeedback.id
      }).from(coachingDailyRecommendationFeedback).where(and(
        eq(coachingDailyRecommendationFeedback.recommendationId, input.snapshotId),
        eq(coachingDailyRecommendationFeedback.status, input.status)
      )).limit(1);
      if (existingStatus[0]) {
        throw new ConflictError("Feedback status is already recorded for this snapshot");
      }
      if (input.status === "completed" || input.status === "skipped") {
        const opposite = input.status === "completed" ? "skipped" : "completed";
        const existingDisposition = await transaction.select({
          id: coachingDailyRecommendationFeedback.id
        }).from(coachingDailyRecommendationFeedback).where(and(
          eq(coachingDailyRecommendationFeedback.recommendationId, input.snapshotId),
          eq(coachingDailyRecommendationFeedback.status, opposite)
        )).limit(1);
        if (existingDisposition[0]) {
          throw new ConflictError("Completed and skipped feedback are mutually exclusive");
        }
      }

      const inserted = await transaction.insert(coachingDailyRecommendationFeedback)
        .values({
          recommendationId: input.snapshotId,
          personId,
          actorPersonId: personId,
          status: input.status,
          comment,
          idempotencyKey: input.idempotencyKey
        })
        .returning();
      if (!inserted[0]) throw new Error("Daily recommendation feedback was not stored");
      return { created: true, feedback: hydrateFeedback(inserted[0]) };
    });
  }

  public listFeedback(
    personId: string,
    snapshotId: string
  ): Promise<DailyRecommendationFeedbackList> {
    return this.database.db.transaction(async (transaction) => {
      const snapshot = await transaction.select({
        recommendationId: coachingDailyAssessmentDetails.recommendationId
      }).from(coachingDailyAssessmentDetails).where(and(
        eq(coachingDailyAssessmentDetails.recommendationId, snapshotId),
        eq(coachingDailyAssessmentDetails.personId, personId)
      )).limit(1);
      if (!snapshot[0]) {
        throw new NotFoundError("Daily recommendation snapshot was not found");
      }
      const rows = await transaction.select()
        .from(coachingDailyRecommendationFeedback)
        .where(and(
          eq(coachingDailyRecommendationFeedback.recommendationId, snapshotId),
          eq(coachingDailyRecommendationFeedback.personId, personId)
        ))
        .orderBy(
          asc(coachingDailyRecommendationFeedback.reportedAt),
          asc(coachingDailyRecommendationFeedback.id)
        );
      return { snapshotId, items: rows.map(hydrateFeedback) };
    });
  }

  private hydrate(recommendation: typeof coachingRecommendations.$inferSelect, detail: typeof coachingDailyAssessmentDetails.$inferSelect): DailyAssessmentAvailable {
    if (detail.policyVersion !== "daily-assessment-v1" && detail.policyVersion !== "daily-assessment-v2" && detail.policyVersion !== "daily-assessment-v3") {
      throw new Error(`Unsupported daily assessment policy version: ${detail.policyVersion}`);
    }
    if (detail.policyVersion !== "daily-assessment-v1" && detail.personalBaseline === null) {
      throw new Error("Stored personalized daily assessment is missing its baseline explanation");
    }
    if (detail.policyVersion !== "daily-assessment-v1" &&
        !Array.isArray(detail.usedFacts.dailyContextNoteIds)) {
      throw new Error("Stored personalized daily assessment is missing its context-note evidence IDs");
    }
    if (detail.policyVersion === "daily-assessment-v3" && detail.movement === null) {
      throw new Error("Stored daily assessment v3 is missing its movement context");
    }
    if (detail.policyVersion === "daily-assessment-v3" &&
        detail.personalBaseline?.policyVersion !== "personal-baseline-v2") {
      throw new Error("Stored daily assessment v3 has the wrong baseline policy");
    }
    if (detail.policyVersion === "daily-assessment-v2" &&
        detail.personalBaseline?.policyVersion !== "personal-baseline-v1") {
      throw new Error("Stored daily assessment v2 has the wrong baseline policy");
    }
    const base = {
      state: "available" as const,
      snapshotId: recommendation.id,
      localDate: detail.localDate,
      timezone: detail.timezone,
      status: detail.status,
      usedFacts: detail.usedFacts,
      missingImportantData: detail.missingImportantData as DailyAssessmentAvailable["missingImportantData"],
      reasons: detail.reasons as DailyAssessmentAvailable["reasons"],
      recommendedAction: detail.recommendedAction,
      alternatives: detail.alternatives,
      limitations: detail.limitations as DailyAssessmentAvailable["limitations"],
      confidence: Number(detail.confidence),
      evidenceChecksum: recommendation.evidenceChecksum,
      createdAt: recommendation.createdAt.toISOString()
    };
    if (detail.policyVersion === "daily-assessment-v1") {
      return { ...base, policyVersion: detail.policyVersion };
    }
    const personalized = {
      ...base,
      usedFacts: {
        ...detail.usedFacts,
        dailyContextNoteIds: detail.usedFacts.dailyContextNoteIds!
      },
      personalBaseline: detail.personalBaseline!
    };
    if (detail.policyVersion === "daily-assessment-v3") {
      return {
        ...personalized,
        policyVersion: detail.policyVersion,
        personalBaseline: detail.personalBaseline as DailyAssessmentPersonalBaseline & {
          readonly policyVersion: "personal-baseline-v2";
        },
        movement: detail.movement!
      };
    }
    return { ...personalized, policyVersion: "daily-assessment-v2" };
  }
}

/** Small isolated-test fallback; production always uses PostgreSQL. */
export class InMemoryDailyAssessmentStore implements DailyAssessmentStore {
  private timezone: string | null = null;
  private readonly snapshots = new Map<string, DailyAssessmentAvailable>();
  private readonly snapshotOwners = new Map<string, string>();
  private readonly feedback = new Map<string, DailyRecommendationFeedback>();
  public async getPreferences(): Promise<PersonPreferences> { return { timezone: this.timezone, updatedAt: new Date(0).toISOString() }; }
  public async setTimezone(
    _personId: string,
    timezone: string,
    options: { readonly ifUnset?: boolean } = {}
  ): Promise<PersonPreferences> {
    if (options.ifUnset !== true || this.timezone === null) this.timezone = timezone;
    return { timezone: this.timezone, updatedAt: new Date().toISOString() };
  }
  public async getEvidenceRevision(): Promise<string> { return "in-memory-evidence-revision"; }
  public async createOrGet(personId: string, input: DailyAssessmentSnapshotInput): Promise<DailyAssessmentAvailable> {
    const key = `${personId}:${input.evidenceChecksum}`;
    const existing = this.snapshots.get(key);
    if (existing) return existing;
    const { personalBaselineCalculation, ...publicInput } = input;
    void personalBaselineCalculation;
    const value = { state: "available", snapshotId: randomUUID(), createdAt: new Date().toISOString(), ...publicInput } as DailyAssessmentAvailable;
    this.snapshots.set(key, value);
    this.snapshotOwners.set(value.snapshotId, personId);
    return value;
  }

  public async recordFeedback(
    personId: string,
    input: CreateDailyRecommendationFeedback
  ): Promise<CreatedDailyRecommendationFeedback> {
    if (this.snapshotOwners.get(input.snapshotId) !== personId) {
      throw new NotFoundError("Daily recommendation snapshot was not found");
    }
    const comment = normalizeFeedbackComment(input.comment);
    validateFeedbackIdempotencyKey(input.idempotencyKey);
    const key = `${personId}:${input.idempotencyKey}`;
    const existing = this.feedback.get(key);
    if (existing) {
      if (
        existing.snapshotId !== input.snapshotId ||
        existing.status !== input.status ||
        existing.comment !== comment
      ) throw new ConflictError("Feedback idempotency key is already used");
      return { created: false, feedback: existing };
    }
    const snapshotEvents = [...this.feedback.values()].filter(
      (item) => item.personId === personId && item.snapshotId === input.snapshotId
    );
    if (snapshotEvents.some((item) => item.status === input.status)) {
      throw new ConflictError("Feedback status is already recorded for this snapshot");
    }
    if (
      (input.status === "completed" && snapshotEvents.some((item) => item.status === "skipped")) ||
      (input.status === "skipped" && snapshotEvents.some((item) => item.status === "completed"))
    ) throw new ConflictError("Completed and skipped feedback are mutually exclusive");
    const created: DailyRecommendationFeedback = {
      id: randomUUID(),
      snapshotId: input.snapshotId,
      personId,
      actorPersonId: personId,
      status: input.status,
      comment,
      idempotencyKey: input.idempotencyKey,
      reportedAt: new Date().toISOString()
    };
    this.feedback.set(key, created);
    return { created: true, feedback: created };
  }

  public async listFeedback(
    personId: string,
    snapshotId: string
  ): Promise<DailyRecommendationFeedbackList> {
    if (this.snapshotOwners.get(snapshotId) !== personId) {
      throw new NotFoundError("Daily recommendation snapshot was not found");
    }
    return {
      snapshotId,
      items: [...this.feedback.values()]
        .filter((item) => item.personId === personId && item.snapshotId === snapshotId)
        .sort((left, right) => left.reportedAt.localeCompare(right.reportedAt) || left.id.localeCompare(right.id))
    };
  }
}

function normalizeFeedbackComment(comment: string | undefined): string | null {
  if (comment === undefined) return null;
  const normalized = comment.trim();
  if (normalized.length === 0 || normalized.length > 1000) {
    throw new DomainValidationError("Feedback comment must contain 1 to 1000 characters");
  }
  return normalized;
}

function validateFeedbackIdempotencyKey(idempotencyKey: string): void {
  if (idempotencyKey.length === 0 || idempotencyKey.length > 256 || idempotencyKey.trim().length === 0) {
    throw new DomainValidationError("Feedback idempotency key must contain 1 to 256 characters");
  }
}

function hydrateFeedback(
  row: typeof coachingDailyRecommendationFeedback.$inferSelect
): DailyRecommendationFeedback {
  return {
    id: row.id,
    snapshotId: row.recommendationId,
    personId: row.personId,
    actorPersonId: row.actorPersonId,
    status: row.status,
    comment: row.comment,
    idempotencyKey: row.idempotencyKey,
    reportedAt: row.reportedAt.toISOString()
  };
}
