import {
  and,
  asc,
  desc,
  eq,
  max,
  sql
} from "drizzle-orm";

import type {
  CreatePhysicalGoal,
  CreatePhysicalGoalVersion,
  ListPhysicalGoalsQuery,
  PhysicalGoal,
  PhysicalGoalHistory,
  PhysicalGoalList,
  PhysicalGoalTransition,
  PhysicalGoalVersion
} from "@shape-of-you/contracts";

import type { DatabaseContext } from "../database/context.js";
import {
  physicalGoalCriteria,
  physicalGoals,
  physicalGoalVersions,
  sourceReferences,
  type PhysicalGoalRow,
  type PhysicalGoalVersionRow,
  type SourceReferenceRow
} from "../database/schema.js";
import {
  ConflictError,
  NotFoundError
} from "../domain/errors.js";
import {
  toPhysicalGoal,
  toPhysicalGoalVersion,
  validatePhysicalGoalVersionInput
} from "../domain/physical-goal.js";
import {
  discardUnusedSourceReference,
  ensureSourceReference,
  type DatabaseTransaction
} from "./source-reference-repository.js";

interface JoinedVersion {
  readonly version: PhysicalGoalVersionRow;
  readonly sourceReference: SourceReferenceRow;
}

/** Result of idempotent goal or version creation. */
export interface CreatePhysicalGoalResult {
  readonly created: boolean;
  readonly goal: PhysicalGoal;
}

/** Persistence contract for versioned PhysicalGoal plans. */
export interface PhysicalGoalStore {
  create(
    personId: string,
    input: CreatePhysicalGoal
  ): Promise<CreatePhysicalGoalResult>;
  addVersion(
    personId: string,
    id: string,
    input: CreatePhysicalGoalVersion
  ): Promise<CreatePhysicalGoalResult>;
  activate(
    personId: string,
    id: string,
    version: number,
    input: PhysicalGoalTransition
  ): Promise<PhysicalGoal>;
  complete(
    personId: string,
    id: string,
    input: PhysicalGoalTransition
  ): Promise<PhysicalGoal>;
  cancel(
    personId: string,
    id: string,
    input: PhysicalGoalTransition
  ): Promise<PhysicalGoal>;
  findById(personId: string, id: string): Promise<PhysicalGoal | null>;
  history(
    personId: string,
    id: string
  ): Promise<PhysicalGoalHistory | null>;
  list(
    personId: string,
    status?: ListPhysicalGoalsQuery["status"]
  ): Promise<PhysicalGoalList>;
}

/** PostgreSQL implementation of versioned PhysicalGoal persistence. */
export class PhysicalGoalRepository implements PhysicalGoalStore {
  public constructor(private readonly database: DatabaseContext) {}

  public create(
    personId: string,
    input: CreatePhysicalGoal
  ): Promise<CreatePhysicalGoalResult> {
    validatePhysicalGoalVersionInput(input);
    return this.database.db.transaction(async (transaction) => {
      const sourceReference = await ensureSourceReference(
        transaction,
        personId,
        input.sourceReference
      );
      const insertedGoals = await transaction
        .insert(physicalGoals)
        .values({
          personId,
          source: input.sourceReference.channel,
          dedupeKey: input.dedupeKey
        })
        .onConflictDoNothing()
        .returning();
      if (!insertedGoals[0]) {
        await discardUnusedSourceReference(transaction, sourceReference);
        const existing = await transaction.query.physicalGoals.findFirst({
          where: and(
            eq(physicalGoals.personId, personId),
            eq(physicalGoals.source, input.sourceReference.channel),
            eq(physicalGoals.dedupeKey, input.dedupeKey)
          )
        });
        if (!existing) {
          throw new Error("PhysicalGoal conflict did not resolve");
        }
        return {
          created: false,
          goal: await this.hydrateGoal(existing, transaction)
        };
      }

      await this.insertVersion(
        transaction,
        insertedGoals[0],
        1,
        input,
        sourceReference.row.id
      );
      return {
        created: true,
        goal: await this.hydrateGoal(insertedGoals[0], transaction)
      };
    });
  }

  public addVersion(
    personId: string,
    id: string,
    input: CreatePhysicalGoalVersion
  ): Promise<CreatePhysicalGoalResult> {
    validatePhysicalGoalVersionInput(input);
    return this.database.db.transaction(async (transaction) => {
      const goal = await this.lockGoal(transaction, personId, id);
      if (goal.status === "completed" || goal.status === "cancelled") {
        throw new ConflictError(
          "A terminal PhysicalGoal cannot receive a new version"
        );
      }
      const existing =
        await transaction.query.physicalGoalVersions.findFirst({
          where: and(
            eq(physicalGoalVersions.goalId, id),
            eq(
              physicalGoalVersions.source,
              input.sourceReference.channel
            ),
            eq(physicalGoalVersions.dedupeKey, input.dedupeKey)
          )
        });
      if (existing) {
        return {
          created: false,
          goal: await this.hydrateGoal(goal, transaction)
        };
      }

      const sourceReference = await ensureSourceReference(
        transaction,
        personId,
        input.sourceReference
      );
      const aggregate = await transaction
        .select({ value: max(physicalGoalVersions.version) })
        .from(physicalGoalVersions)
        .where(eq(physicalGoalVersions.goalId, id));
      const nextVersion = (aggregate[0]?.value ?? 0) + 1;
      await this.insertVersion(
        transaction,
        goal,
        nextVersion,
        input,
        sourceReference.row.id
      );
      return {
        created: true,
        goal: await this.hydrateGoal(goal, transaction)
      };
    });
  }

  public activate(
    personId: string,
    id: string,
    version: number,
    input: PhysicalGoalTransition
  ): Promise<PhysicalGoal> {
    return this.database.db.transaction(async (transaction) => {
      const goal = await this.lockGoal(transaction, personId, id);
      this.assertLockVersion(goal, input.expectedLockVersion);
      if (goal.status === "completed" || goal.status === "cancelled") {
        throw new ConflictError(
          "A terminal PhysicalGoal cannot be activated"
        );
      }
      const selected =
        await transaction.query.physicalGoalVersions.findFirst({
          where: and(
            eq(physicalGoalVersions.goalId, id),
            eq(physicalGoalVersions.personId, personId),
            eq(physicalGoalVersions.version, version)
          )
        });
      if (!selected) {
        throw new NotFoundError("PhysicalGoalVersion was not found");
      }
      const updated = await transaction
        .update(physicalGoals)
        .set({
          status: "active",
          currentVersionId: selected.id,
          activatedAt: new Date(),
          lockVersion: goal.lockVersion + 1
        })
        .where(
          and(
            eq(physicalGoals.id, id),
            eq(physicalGoals.lockVersion, goal.lockVersion)
          )
        )
        .returning();
      if (!updated[0]) {
        throw new ConflictError("PhysicalGoal changed concurrently");
      }
      return this.hydrateGoal(updated[0], transaction);
    });
  }

  public complete(
    personId: string,
    id: string,
    input: PhysicalGoalTransition
  ): Promise<PhysicalGoal> {
    return this.transitionTerminal(personId, id, input, "completed");
  }

  public cancel(
    personId: string,
    id: string,
    input: PhysicalGoalTransition
  ): Promise<PhysicalGoal> {
    return this.transitionTerminal(personId, id, input, "cancelled");
  }

  public async findById(
    personId: string,
    id: string
  ): Promise<PhysicalGoal | null> {
    const goal = await this.database.db.query.physicalGoals.findFirst({
      where: and(
        eq(physicalGoals.id, id),
        eq(physicalGoals.personId, personId)
      )
    });
    return goal ? this.hydrateGoal(goal, this.database.db) : null;
  }

  public async history(
    personId: string,
    id: string
  ): Promise<PhysicalGoalHistory | null> {
    const goal = await this.database.db.query.physicalGoals.findFirst({
      where: and(
        eq(physicalGoals.id, id),
        eq(physicalGoals.personId, personId)
      )
    });
    if (!goal) {
      return null;
    }
    const joined = await this.findVersions(this.database.db, goal.id);
    const versions = await Promise.all(
      joined.map((version) =>
        this.hydrateVersion(version, this.database.db)
      )
    );
    return {
      goal: await this.hydrateGoal(goal, this.database.db),
      versions
    };
  }

  public async list(
    personId: string,
    status?: ListPhysicalGoalsQuery["status"]
  ): Promise<PhysicalGoalList> {
    const rows = await this.database.db.query.physicalGoals.findMany({
      where: and(
        eq(physicalGoals.personId, personId),
        status ? eq(physicalGoals.status, status) : undefined
      ),
      orderBy: [desc(physicalGoals.createdAt), desc(physicalGoals.id)]
    });
    return {
      items: await Promise.all(
        rows.map((row) => this.hydrateGoal(row, this.database.db))
      )
    };
  }

  private async transitionTerminal(
    personId: string,
    id: string,
    input: PhysicalGoalTransition,
    status: "completed" | "cancelled"
  ): Promise<PhysicalGoal> {
    return this.database.db.transaction(async (transaction) => {
      const goal = await this.lockGoal(transaction, personId, id);
      this.assertLockVersion(goal, input.expectedLockVersion);
      if (goal.status === "completed" || goal.status === "cancelled") {
        throw new ConflictError("PhysicalGoal is already terminal");
      }
      if (status === "completed" && goal.status !== "active") {
        throw new ConflictError(
          "Only an active PhysicalGoal can be completed"
        );
      }
      const now = new Date();
      const updated = await transaction
        .update(physicalGoals)
        .set({
          status,
          completedAt: status === "completed" ? now : null,
          cancelledAt: status === "cancelled" ? now : null,
          lockVersion: goal.lockVersion + 1
        })
        .where(
          and(
            eq(physicalGoals.id, id),
            eq(physicalGoals.lockVersion, goal.lockVersion)
          )
        )
        .returning();
      if (!updated[0]) {
        throw new ConflictError("PhysicalGoal changed concurrently");
      }
      return this.hydrateGoal(updated[0], transaction);
    });
  }

  private async lockGoal(
    transaction: DatabaseTransaction,
    personId: string,
    id: string
  ): Promise<PhysicalGoalRow> {
    await transaction.execute(
      sql`select id from ${physicalGoals}
          where ${physicalGoals.id} = ${id}
            and ${physicalGoals.personId} = ${personId}
          for update`
    );
    const goal = await transaction.query.physicalGoals.findFirst({
      where: and(
        eq(physicalGoals.id, id),
        eq(physicalGoals.personId, personId)
      )
    });
    if (!goal) {
      throw new NotFoundError("PhysicalGoal was not found");
    }
    return goal;
  }

  private assertLockVersion(
    goal: PhysicalGoalRow,
    expected: number
  ): void {
    if (goal.lockVersion !== expected) {
      throw new ConflictError("PhysicalGoal changed concurrently");
    }
  }

  private async insertVersion(
    transaction: DatabaseTransaction,
    goal: PhysicalGoalRow,
    version: number,
    input: CreatePhysicalGoal | CreatePhysicalGoalVersion,
    sourceReferenceId: string
  ): Promise<void> {
    const inserted = await transaction
      .insert(physicalGoalVersions)
      .values({
        goalId: goal.id,
        personId: goal.personId,
        version,
        intent: input.intent,
        effectiveFrom: input.effectiveFrom,
        targetDate: input.targetDate,
        source: input.sourceReference.channel,
        sourceReferenceId,
        dedupeKey: input.dedupeKey
      })
      .returning();
    if (!inserted[0]) {
      throw new Error("PhysicalGoalVersion insert did not return a row");
    }
    if (input.criteria.length > 0) {
      await transaction.insert(physicalGoalCriteria).values(
        input.criteria.map((criterion, index) => ({
          goalVersionId: inserted[0]!.id,
          position: index + 1,
          metric: criterion.metric,
          mode: criterion.mode,
          direction: criterion.direction,
          targetValue:
            criterion.targetValue === null
              ? null
              : criterion.targetValue.toFixed(3),
          minimumValue:
            criterion.minimumValue === null
              ? null
              : criterion.minimumValue.toFixed(3),
          maximumValue:
            criterion.maximumValue === null
              ? null
              : criterion.maximumValue.toFixed(3),
          unit: criterion.unit
        }))
      );
    }
  }

  private async hydrateGoal(
    goal: PhysicalGoalRow,
    query: DatabaseContext["db"]
  ): Promise<PhysicalGoal> {
    const versions = await this.findVersions(query, goal.id);
    if (!versions[0]) {
      throw new Error("PhysicalGoal has no version");
    }
    const serialized = await Promise.all(
      versions.map((version) => this.hydrateVersion(version, query))
    );
    const latest = serialized.at(-1);
    if (!latest) {
      throw new Error("PhysicalGoal has no latest version");
    }
    const current =
      serialized.find(
        (version) => version.id === goal.currentVersionId
      ) ?? null;
    return toPhysicalGoal(goal, current, latest);
  }

  private async findVersions(
    query: DatabaseContext["db"],
    goalId: string
  ): Promise<JoinedVersion[]> {
    return query
      .select({
        version: physicalGoalVersions,
        sourceReference: sourceReferences
      })
      .from(physicalGoalVersions)
      .innerJoin(
        sourceReferences,
        eq(
          physicalGoalVersions.sourceReferenceId,
          sourceReferences.id
        )
      )
      .where(eq(physicalGoalVersions.goalId, goalId))
      .orderBy(asc(physicalGoalVersions.version));
  }

  private async hydrateVersion(
    joined: JoinedVersion,
    query: DatabaseContext["db"]
  ): Promise<PhysicalGoalVersion> {
    const criteria = await query
      .select()
      .from(physicalGoalCriteria)
      .where(
        eq(physicalGoalCriteria.goalVersionId, joined.version.id)
      )
      .orderBy(asc(physicalGoalCriteria.position));
    return toPhysicalGoalVersion(
      joined.version,
      criteria,
      joined.sourceReference
    );
  }
}
