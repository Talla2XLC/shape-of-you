import { createHash } from "node:crypto";

import { and, asc, desc, eq, gte, isNull, lte, or, sql } from "drizzle-orm";

import type {
  CoachingRecommendation,
  CoachingRecommendationDecision,
  CoachingRecommendationHistory,
  CoachingRecommendationList,
  CreateCoachingRecommendationDecision,
  CreateTrainingAdjustmentRecommendation,
  ListCoachingRecommendationsQuery,
  TrainingAdjustmentRecommendationDetail
} from "@shape-of-you/contracts";

import type { DatabaseContext } from "../database/context.js";
import {
  coachingPolicies,
  coachingPolicyVersions,
  coachingRecommendationDecisions,
  coachingRecommendationRecoveryEvidence,
  coachingRecommendations,
  coachingRecommendationTrainingSessionEvidence,
  coachingTrainingAdjustmentDetails,
  recoveryAssessments,
  recoveryAssessmentTrainingEvidence,
  trainingProgramPrescriptions,
  trainingPrograms,
  trainingProgramVersions,
  trainingProgramWorkouts
} from "../database/schema.js";
import { deriveLocalDate } from "../domain/weight-measurement.js";
import {
  deriveCoachingRecommendationState,
  evaluateTrainingAdjustment,
  validateCoachingPolicy,
  type CoachingPolicyParameters
} from "../domain/coaching.js";
import { ConflictError, DomainValidationError, NotFoundError } from "../domain/errors.js";
import type { DatabaseTransaction } from "./source-reference-repository.js";

/** Typed definition used only by trusted composition and test setup. */
export interface RegisterCoachingPolicyVersion extends CoachingPolicyParameters {
  readonly policyKey: string;
  readonly policyName: string;
  readonly version: number;
  readonly effectiveFrom: string;
  readonly effectiveUntil: string | null;
}

export interface CreatedCoachingRecommendation {
  readonly created: boolean;
  readonly recommendation: CoachingRecommendation;
}

export interface CreatedCoachingDecision {
  readonly created: boolean;
  readonly recommendation: CoachingRecommendation;
}

/** Persistence boundary for immutable recommendations and decisions. */
export interface CoachingStore {
  registerPolicyVersion(input: RegisterCoachingPolicyVersion): Promise<string>;
  createTrainingAdjustment(
    personId: string,
    input: CreateTrainingAdjustmentRecommendation
  ): Promise<CreatedCoachingRecommendation>;
  decide(
    personId: string,
    recommendationId: string,
    input: CreateCoachingRecommendationDecision
  ): Promise<CreatedCoachingDecision>;
  find(personId: string, id: string): Promise<CoachingRecommendation | null>;
  list(
    personId: string,
    query: ListCoachingRecommendationsQuery
  ): Promise<CoachingRecommendationList>;
  /** Reads every recommendation whose local projection date matches the supplied context. */
  listForLocalDate(personId: string, localDate: string, timezone: string): Promise<readonly CoachingRecommendation[]>;
  history(
    personId: string,
    id: string
  ): Promise<CoachingRecommendationHistory | null>;
}

async function lockPerson(
  transaction: DatabaseTransaction,
  personId: string
): Promise<void> {
  await transaction.execute(sql`select pg_advisory_xact_lock(hashtext(${personId}))`);
}

type RecommendationRow = typeof coachingRecommendations.$inferSelect;
type DetailRow = typeof coachingTrainingAdjustmentDetails.$inferSelect;
type DecisionRow = typeof coachingRecommendationDecisions.$inferSelect;

/** PostgreSQL implementation of the Coaching persistence boundary. */
export class CoachingRepository implements CoachingStore {
  public constructor(
    private readonly database: DatabaseContext,
    private readonly clock: () => Date = () => new Date()
  ) {}

  public registerPolicyVersion(input: RegisterCoachingPolicyVersion): Promise<string> {
    validateCoachingPolicy(input);
    const effectiveFrom = new Date(input.effectiveFrom);
    const effectiveUntil = input.effectiveUntil ? new Date(input.effectiveUntil) : null;
    if (
      Number.isNaN(effectiveFrom.valueOf()) ||
      (effectiveUntil && Number.isNaN(effectiveUntil.valueOf())) ||
      (effectiveUntil && effectiveUntil <= effectiveFrom) ||
      !Number.isInteger(input.version) ||
      input.version <= 0
    ) {
      throw new DomainValidationError("Coaching policy version interval or version is invalid");
    }

    return this.database.db.transaction(async (transaction) => {
      const insertedPolicy = await transaction
        .insert(coachingPolicies)
        .values({ key: input.policyKey, name: input.policyName })
        .onConflictDoNothing()
        .returning();
      const policy = insertedPolicy[0] ?? await transaction.query.coachingPolicies.findFirst({
        where: eq(coachingPolicies.key, input.policyKey)
      });
      if (!policy) throw new Error("Coaching policy conflict did not resolve");

      const inserted = await transaction
        .insert(coachingPolicyVersions)
        .values({
          policyId: policy.id,
          version: input.version,
          effectiveFrom,
          effectiveUntil,
          recommendationTtlMinutes: input.recommendationTtlMinutes,
          minimumConfidence: input.minimumConfidence.toFixed(3),
          highRiskLoadFactor: input.highRiskLoadFactor.toFixed(3),
          repetitionReduction: input.repetitionReduction
        })
        .onConflictDoNothing()
        .returning();
      const version = inserted[0] ?? await transaction.query.coachingPolicyVersions.findFirst({
        where: and(
          eq(coachingPolicyVersions.policyId, policy.id),
          eq(coachingPolicyVersions.version, input.version)
        )
      });
      if (!version) throw new Error("Coaching policy version conflict did not resolve");
      return version.id;
    });
  }

  public createTrainingAdjustment(
    personId: string,
    input: CreateTrainingAdjustmentRecommendation
  ): Promise<CreatedCoachingRecommendation> {
    return this.database.db.transaction(async (transaction) => {
      await lockPerson(transaction, personId);
      const existing = await transaction.query.coachingRecommendations.findFirst({
        where: and(
          eq(coachingRecommendations.personId, personId),
          eq(coachingRecommendations.dedupeKey, input.dedupeKey)
        )
      });
      if (existing) {
        return {
          created: false,
          recommendation: await this.hydrate(transaction, existing, this.clock())
        };
      }

      const asOf = new Date(input.asOf);
      const now = this.clock();
      if (Number.isNaN(asOf.valueOf()) || asOf > now) {
        throw new DomainValidationError("Recommendation asOf must be a valid time that is not in the future");
      }
      const policy = await transaction.query.coachingPolicyVersions.findFirst({
        where: and(
          eq(coachingPolicyVersions.id, input.policyVersionId),
          lte(coachingPolicyVersions.effectiveFrom, asOf),
          or(
            isNull(coachingPolicyVersions.effectiveUntil),
            gte(coachingPolicyVersions.effectiveUntil, asOf)
          )
        )
      });
      if (!policy) throw new NotFoundError("Effective Coaching policy version was not found");

      const recovery = await transaction.query.recoveryAssessments.findFirst({
        where: and(
          eq(recoveryAssessments.id, input.recoveryAssessmentId),
          eq(recoveryAssessments.personId, personId),
          lte(recoveryAssessments.asOf, asOf)
        )
      });
      if (!recovery) throw new NotFoundError("Recovery assessment evidence was not found");

      const prescriptionRows = await transaction
        .select({
          program: trainingPrograms,
          version: trainingProgramVersions,
          workout: trainingProgramWorkouts,
          prescription: trainingProgramPrescriptions
        })
        .from(trainingPrograms)
        .innerJoin(
          trainingProgramVersions,
          and(
            eq(trainingPrograms.activeVersionId, trainingProgramVersions.id),
            eq(trainingPrograms.id, trainingProgramVersions.programId),
            eq(trainingPrograms.personId, trainingProgramVersions.personId)
          )
        )
        .innerJoin(
          trainingProgramWorkouts,
          eq(trainingProgramVersions.id, trainingProgramWorkouts.programVersionId)
        )
        .innerJoin(
          trainingProgramPrescriptions,
          eq(trainingProgramWorkouts.id, trainingProgramPrescriptions.workoutId)
        )
        .where(and(
          eq(trainingPrograms.personId, personId),
          eq(trainingProgramVersions.id, input.programVersionId),
          eq(trainingProgramWorkouts.position, input.workoutPosition),
          eq(trainingProgramPrescriptions.position, input.prescriptionPosition)
        ))
        .limit(1);
      const selected = prescriptionRows[0];
      if (!selected) {
        throw new NotFoundError("Active Training prescription evidence was not found");
      }

      const parameters: CoachingPolicyParameters = {
        recommendationTtlMinutes: policy.recommendationTtlMinutes,
        minimumConfidence: Number(policy.minimumConfidence),
        highRiskLoadFactor: Number(policy.highRiskLoadFactor),
        repetitionReduction: policy.repetitionReduction
      };
      const evaluation = evaluateTrainingAdjustment(
        parameters,
        {
          riskLevel: recovery.riskLevel,
          confidence: Number(recovery.confidence),
          hardStop: recovery.hardStop
        },
        {
          programId: selected.program.id,
          programVersionId: selected.version.id,
          workoutPosition: selected.workout.position,
          prescriptionPosition: selected.prescription.position,
          exerciseId: selected.prescription.exerciseId,
          exerciseVersionId: selected.prescription.exerciseVersionId,
          targetWeightKg: selected.prescription.targetWeightKg === null
            ? null
            : Number(selected.prescription.targetWeightKg),
          targetRepsMin: selected.prescription.targetRepsMin,
          targetRepsMax: selected.prescription.targetRepsMax
        }
      );
      const sessionRows = await transaction
        .select({ id: recoveryAssessmentTrainingEvidence.workoutSessionId })
        .from(recoveryAssessmentTrainingEvidence)
        .where(eq(recoveryAssessmentTrainingEvidence.assessmentId, recovery.id))
        .orderBy(asc(recoveryAssessmentTrainingEvidence.workoutSessionId));
      const sessionIds = sessionRows.map((row) => row.id);
      const evidenceChecksum = createHash("sha256")
        .update(JSON.stringify({
          policyVersionId: policy.id,
          recoveryAssessmentId: recovery.id,
          programVersionId: selected.version.id,
          prescriptionId: selected.prescription.id,
          workoutSessionIds: sessionIds,
          asOf: asOf.toISOString()
        }))
        .digest("hex");
      const expiresAt = new Date(asOf.valueOf() + parameters.recommendationTtlMinutes * 60_000);
      const inserted = await transaction
        .insert(coachingRecommendations)
        .values({
          personId,
          kind: "training_adjustment",
          policyVersionId: policy.id,
          asOf,
          expiresAt,
          evidenceChecksum,
          explanation: evaluation.explanation,
          dedupeKey: input.dedupeKey
        })
        .onConflictDoNothing()
        .returning();
      let recommendation = inserted[0];
      if (!recommendation) {
        recommendation = await transaction.query.coachingRecommendations.findFirst({
          where: and(
            eq(coachingRecommendations.personId, personId),
            eq(coachingRecommendations.policyVersionId, policy.id),
            eq(coachingRecommendations.evidenceChecksum, evidenceChecksum)
          )
        });
        if (!recommendation) {
          throw new ConflictError("Coaching recommendation conflict did not resolve");
        }
        return {
          created: false,
          recommendation: await this.hydrate(transaction, recommendation, now)
        };
      }

      await transaction.insert(coachingTrainingAdjustmentDetails).values({
        recommendationId: recommendation.id,
        personId,
        programId: selected.program.id,
        programVersionId: selected.version.id,
        prescriptionId: selected.prescription.id,
        workoutPosition: evaluation.detail.workoutPosition,
        prescriptionPosition: evaluation.detail.prescriptionPosition,
        exerciseId: evaluation.detail.exerciseId,
        exerciseVersionId: evaluation.detail.exerciseVersionId,
        action: evaluation.detail.action,
        reasonCode: evaluation.detail.reasonCode,
        currentTargetWeightKg: evaluation.detail.currentTargetWeightKg?.toFixed(3) ?? null,
        suggestedTargetWeightKg: evaluation.detail.suggestedTargetWeightKg?.toFixed(3) ?? null,
        currentRepsMin: evaluation.detail.currentRepsMin,
        currentRepsMax: evaluation.detail.currentRepsMax,
        suggestedRepsMin: evaluation.detail.suggestedRepsMin,
        suggestedRepsMax: evaluation.detail.suggestedRepsMax
      });
      await transaction.insert(coachingRecommendationRecoveryEvidence).values({
        recommendationId: recommendation.id,
        personId,
        recoveryAssessmentId: recovery.id
      });
      if (sessionIds.length > 0) {
        await transaction.insert(coachingRecommendationTrainingSessionEvidence).values(
          sessionIds.map((workoutSessionId) => ({
            recommendationId: recommendation!.id,
            personId,
            workoutSessionId
          }))
        );
      }
      return {
        created: true,
        recommendation: await this.hydrate(transaction, recommendation, now)
      };
    });
  }

  public decide(
    personId: string,
    recommendationId: string,
    input: CreateCoachingRecommendationDecision
  ): Promise<CreatedCoachingDecision> {
    return this.database.db.transaction(async (transaction) => {
      await lockPerson(transaction, personId);
      const recommendation = await transaction.query.coachingRecommendations.findFirst({
        where: and(
          eq(coachingRecommendations.id, recommendationId),
          eq(coachingRecommendations.personId, personId)
        )
      });
      if (!recommendation) throw new NotFoundError("Coaching recommendation was not found");
      const existing = await transaction.query.coachingRecommendationDecisions.findFirst({
        where: eq(coachingRecommendationDecisions.recommendationId, recommendationId)
      });
      if (existing) {
        if (
          existing.outcome !== input.outcome ||
          existing.reason !== input.reason ||
          existing.dedupeKey !== input.dedupeKey
        ) {
          throw new ConflictError("Recommendation already has a different terminal decision");
        }
        return {
          created: false,
          recommendation: await this.hydrate(transaction, recommendation, this.clock())
        };
      }
      const now = this.clock();
      if (now >= recommendation.expiresAt) {
        throw new ConflictError("Expired recommendation cannot be decided");
      }
      const duplicateKey = await transaction.query.coachingRecommendationDecisions.findFirst({
        where: and(
          eq(coachingRecommendationDecisions.personId, personId),
          eq(coachingRecommendationDecisions.dedupeKey, input.dedupeKey)
        )
      });
      if (duplicateKey) throw new ConflictError("Decision dedupe key is already used");
      await transaction.insert(coachingRecommendationDecisions).values({
        recommendationId,
        personId,
        actorPersonId: personId,
        outcome: input.outcome,
        reason: input.reason,
        dedupeKey: input.dedupeKey,
        decidedAt: now
      });
      return {
        created: true,
        recommendation: await this.hydrate(transaction, recommendation, now)
      };
    });
  }

  public async find(personId: string, id: string): Promise<CoachingRecommendation | null> {
    const row = await this.database.db.query.coachingRecommendations.findFirst({
      where: and(eq(coachingRecommendations.id, id), eq(coachingRecommendations.personId, personId))
    });
    return row
      ? this.database.db.transaction((transaction) => this.hydrate(transaction, row, this.clock()))
      : null;
  }

  public list(
    personId: string,
    query: ListCoachingRecommendationsQuery
  ): Promise<CoachingRecommendationList> {
    return this.database.db.transaction(async (transaction) => {
      const rows = await transaction
        .select()
        .from(coachingRecommendations)
        .where(eq(coachingRecommendations.personId, personId))
        .orderBy(desc(coachingRecommendations.asOf), desc(coachingRecommendations.id));
      const now = this.clock();
      const hydrated = await Promise.all(rows.map((row) => this.hydrate(transaction, row, now)));
      return {
        items: hydrated
          .filter((item) => query.state === undefined || item.state === query.state)
          .slice(0, query.limit ?? 50)
      };
    });
  }

  /** {@inheritDoc CoachingStore.listForLocalDate} */
  public listForLocalDate(
    personId: string,
    localDate: string,
    timezone: string
  ): Promise<readonly CoachingRecommendation[]> {
    return this.database.db.transaction(async (transaction) => {
      const rows = await transaction
        .select()
        .from(coachingRecommendations)
        .where(eq(coachingRecommendations.personId, personId))
        .orderBy(desc(coachingRecommendations.asOf), desc(coachingRecommendations.id));
      const now = this.clock();
      const hydrated = await Promise.all(rows.map((row) => this.hydrate(transaction, row, now)));
      return hydrated.filter(
        (item) => deriveLocalDate(new Date(item.asOf), timezone) === localDate
      );
    });
  }

  public async history(
    personId: string,
    id: string
  ): Promise<CoachingRecommendationHistory | null> {
    const recommendation = await this.find(personId, id);
    if (!recommendation) return null;
    return {
      recommendation,
      decisions: recommendation.decision ? [recommendation.decision] : []
    };
  }

  private toDetail(row: DetailRow): TrainingAdjustmentRecommendationDetail {
    const base = {
      programId: row.programId,
      programVersionId: row.programVersionId,
      workoutPosition: row.workoutPosition,
      prescriptionPosition: row.prescriptionPosition,
      exerciseId: row.exerciseId,
      exerciseVersionId: row.exerciseVersionId,
      reasonCode: row.reasonCode,
      currentTargetWeightKg: row.currentTargetWeightKg === null ? null : Number(row.currentTargetWeightKg),
      currentRepsMin: row.currentRepsMin,
      currentRepsMax: row.currentRepsMax
    };
    if (row.action === "target_weight") {
      if (row.currentTargetWeightKg === null || row.suggestedTargetWeightKg === null) {
        throw new Error("Stored target-weight Coaching detail is invalid");
      }
      return {
        ...base,
        action: row.action,
        currentTargetWeightKg: Number(row.currentTargetWeightKg),
        suggestedTargetWeightKg: Number(row.suggestedTargetWeightKg),
        suggestedRepsMin: null,
        suggestedRepsMax: null
      };
    }
    if (row.action === "repetition_range") {
      if (row.suggestedRepsMin === null || row.suggestedRepsMax === null) {
        throw new Error("Stored repetition-range Coaching detail is invalid");
      }
      return {
        ...base,
        action: row.action,
        suggestedTargetWeightKg: null,
        suggestedRepsMin: row.suggestedRepsMin,
        suggestedRepsMax: row.suggestedRepsMax
      };
    }
    return {
      ...base,
      action: "hold",
      suggestedTargetWeightKg: null,
      suggestedRepsMin: null,
      suggestedRepsMax: null
    };
  }

  private toDecision(row: DecisionRow): CoachingRecommendationDecision {
    return {
      id: row.id,
      recommendationId: row.recommendationId,
      personId: row.personId,
      actorPersonId: row.actorPersonId,
      outcome: row.outcome,
      reason: row.reason,
      dedupeKey: row.dedupeKey,
      decidedAt: row.decidedAt.toISOString()
    };
  }

  private async hydrate(
    transaction: DatabaseTransaction,
    row: RecommendationRow,
    now: Date
  ): Promise<CoachingRecommendation> {
    const detail = await transaction.query.coachingTrainingAdjustmentDetails.findFirst({
      where: eq(coachingTrainingAdjustmentDetails.recommendationId, row.id)
    });
    const recovery = await transaction.query.coachingRecommendationRecoveryEvidence.findFirst({
      where: eq(coachingRecommendationRecoveryEvidence.recommendationId, row.id)
    });
    if (!detail || !recovery) throw new Error("Stored Coaching recommendation graph is incomplete");
    const sessions = await transaction
      .select({ id: coachingRecommendationTrainingSessionEvidence.workoutSessionId })
      .from(coachingRecommendationTrainingSessionEvidence)
      .where(eq(coachingRecommendationTrainingSessionEvidence.recommendationId, row.id))
      .orderBy(asc(coachingRecommendationTrainingSessionEvidence.workoutSessionId));
    const decisionRow = await transaction.query.coachingRecommendationDecisions.findFirst({
      where: eq(coachingRecommendationDecisions.recommendationId, row.id)
    });
    const decision = decisionRow ? this.toDecision(decisionRow) : null;
    return {
      id: row.id,
      personId: row.personId,
      kind: row.kind,
      policyVersionId: row.policyVersionId,
      state: deriveCoachingRecommendationState(row.expiresAt, decision, now),
      asOf: row.asOf.toISOString(),
      createdAt: row.createdAt.toISOString(),
      expiresAt: row.expiresAt.toISOString(),
      evidenceChecksum: row.evidenceChecksum,
      explanation: row.explanation,
      dedupeKey: row.dedupeKey,
      detail: this.toDetail(detail),
      evidence: {
        recoveryAssessmentId: recovery.recoveryAssessmentId,
        trainingProgramVersionId: detail.programVersionId,
        workoutSessionIds: sessions.map((session) => session.id)
      },
      decision
    };
  }
}
