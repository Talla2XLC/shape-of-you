import { and, eq } from "drizzle-orm";
import { randomUUID } from "node:crypto";

import type { DailyAssessmentAvailable, PersonPreferences } from "@shape-of-you/contracts";

import type { DatabaseContext } from "../database/context.js";
import {
  coachingDailyAssessmentDetails,
  coachingDailyAssessmentRecoveryEvidence,
  coachingPolicies,
  coachingPolicyVersions,
  coachingRecommendations,
  persons
} from "../database/schema.js";

export type DailyAssessmentSnapshotInput = Omit<DailyAssessmentAvailable, "snapshotId" | "createdAt" | "state">;

/** Persistence boundary for Person timezone and immutable Coaching daily snapshots. */
export interface DailyAssessmentStore {
  getPreferences(personId: string): Promise<PersonPreferences>;
  setTimezone(personId: string, timezone: string): Promise<PersonPreferences>;
  createOrGet(personId: string, input: DailyAssessmentSnapshotInput): Promise<DailyAssessmentAvailable>;
}

/** PostgreSQL implementation of the daily assessment persistence boundary. */
export class DailyAssessmentRepository implements DailyAssessmentStore {
  public constructor(private readonly database: DatabaseContext) {}

  public async getPreferences(personId: string): Promise<PersonPreferences> {
    const rows = await this.database.db.select({ timezone: persons.timezone, updatedAt: persons.updatedAt }).from(persons).where(eq(persons.id, personId)).limit(1);
    if (!rows[0]) throw new Error("Authorized Person was not found");
    return { timezone: rows[0].timezone, updatedAt: rows[0].updatedAt.toISOString() };
  }

  public async setTimezone(personId: string, timezone: string): Promise<PersonPreferences> {
    const rows = await this.database.db.update(persons).set({ timezone, updatedAt: new Date() }).where(eq(persons.id, personId)).returning({ timezone: persons.timezone, updatedAt: persons.updatedAt });
    if (!rows[0]) throw new Error("Authorized Person was not found");
    return { timezone: rows[0].timezone, updatedAt: rows[0].updatedAt.toISOString() };
  }

  public createOrGet(personId: string, input: DailyAssessmentSnapshotInput): Promise<DailyAssessmentAvailable> {
    return this.database.db.transaction(async (transaction) => {
      const existing = await transaction.select({ recommendation: coachingRecommendations, detail: coachingDailyAssessmentDetails })
        .from(coachingRecommendations)
        .innerJoin(coachingDailyAssessmentDetails, eq(coachingDailyAssessmentDetails.recommendationId, coachingRecommendations.id))
        .where(and(eq(coachingRecommendations.personId, personId), eq(coachingRecommendations.evidenceChecksum, input.evidenceChecksum), eq(coachingDailyAssessmentDetails.localDate, input.localDate), eq(coachingDailyAssessmentDetails.timezone, input.timezone)))
        .limit(1);
      if (existing[0]) return this.hydrate(existing[0].recommendation, existing[0].detail);

      const policyRows = await transaction.insert(coachingPolicies).values({ key: "daily-assessment", name: "Daily assessment" }).onConflictDoNothing().returning();
      const policy = policyRows[0] ?? (await transaction.select().from(coachingPolicies).where(eq(coachingPolicies.key, "daily-assessment")).limit(1))[0];
      if (!policy) throw new Error("Daily assessment policy could not be resolved");
      const versionRows = await transaction.insert(coachingPolicyVersions).values({
        policyId: policy.id,
        version: 1,
        effectiveFrom: new Date("2026-09-14T00:00:00.000Z"),
        effectiveUntil: null,
        recommendationTtlMinutes: 1440,
        minimumConfidence: "0.500",
        highRiskLoadFactor: "0.800",
        repetitionReduction: 1
      }).onConflictDoNothing().returning();
      const version = versionRows[0] ?? (await transaction.select().from(coachingPolicyVersions).where(and(eq(coachingPolicyVersions.policyId, policy.id), eq(coachingPolicyVersions.version, 1))).limit(1))[0];
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
        limitations: [...input.limitations]
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
      const detail = (await transaction.select().from(coachingDailyAssessmentDetails).where(eq(coachingDailyAssessmentDetails.recommendationId, recommendation.id)).limit(1))[0];
      if (!detail) throw new Error("Daily assessment detail was not stored");
      return this.hydrate(recommendation, detail);
    });
  }

  private hydrate(recommendation: typeof coachingRecommendations.$inferSelect, detail: typeof coachingDailyAssessmentDetails.$inferSelect): DailyAssessmentAvailable {
    return {
      state: "available",
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
      policyVersion: "daily-assessment-v1",
      evidenceChecksum: recommendation.evidenceChecksum,
      createdAt: recommendation.createdAt.toISOString()
    };
  }
}

/** Small isolated-test fallback; production always uses PostgreSQL. */
export class InMemoryDailyAssessmentStore implements DailyAssessmentStore {
  private timezone: string | null = null;
  private readonly snapshots = new Map<string, DailyAssessmentAvailable>();
  public async getPreferences(): Promise<PersonPreferences> { return { timezone: this.timezone, updatedAt: new Date(0).toISOString() }; }
  public async setTimezone(_personId: string, timezone: string): Promise<PersonPreferences> { this.timezone = timezone; return { timezone, updatedAt: new Date().toISOString() }; }
  public async createOrGet(_personId: string, input: DailyAssessmentSnapshotInput): Promise<DailyAssessmentAvailable> {
    const existing = this.snapshots.get(input.evidenceChecksum);
    if (existing) return existing;
    const value = { state: "available", snapshotId: randomUUID(), createdAt: new Date().toISOString(), ...input } as DailyAssessmentAvailable;
    this.snapshots.set(input.evidenceChecksum, value);
    return value;
  }
}
