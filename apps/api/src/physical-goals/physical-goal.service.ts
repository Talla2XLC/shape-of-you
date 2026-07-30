import { Inject, Injectable } from "@nestjs/common";

import type {
  CreatePhysicalGoal,
  CreatePhysicalGoalVersion,
  ListPhysicalGoalsQuery,
  PhysicalGoal,
  PhysicalGoalHistory,
  PhysicalGoalList,
  PhysicalGoalTransition
} from "@shape-of-you/contracts";

import type { PersonContext } from "../application/person-context.js";
import {
  PERSON_CONTEXT,
  PHYSICAL_GOAL_STORE
} from "../application/tokens.js";
import { NotFoundError } from "../domain/errors.js";
import type {
  CreatePhysicalGoalResult,
  PhysicalGoalStore
} from "../storage/physical-goal-repository.js";

/** Application service for versioned PhysicalGoal plans. */
@Injectable()
export class PhysicalGoalService {
  public constructor(
    @Inject(PHYSICAL_GOAL_STORE)
    private readonly store: PhysicalGoalStore,
    @Inject(PERSON_CONTEXT)
    private readonly personContext: PersonContext
  ) {}

  /** Creates a goal root and its first immutable draft version. */
  public create(
    input: CreatePhysicalGoal
  ): Promise<CreatePhysicalGoalResult> {
    return this.store.create(this.personContext.getPersonId(), input);
  }

  /** Appends an immutable draft version to a non-terminal goal. */
  public addVersion(
    id: string,
    input: CreatePhysicalGoalVersion
  ): Promise<CreatePhysicalGoalResult> {
    return this.store.addVersion(
      this.personContext.getPersonId(),
      id,
      input
    );
  }

  /** Activates one immutable version using optimistic concurrency. */
  public activate(
    id: string,
    version: number,
    input: PhysicalGoalTransition
  ): Promise<PhysicalGoal> {
    return this.store.activate(
      this.personContext.getPersonId(),
      id,
      version,
      input
    );
  }

  /** Completes an active goal. */
  public complete(
    id: string,
    input: PhysicalGoalTransition
  ): Promise<PhysicalGoal> {
    return this.store.complete(
      this.personContext.getPersonId(),
      id,
      input
    );
  }

  /** Cancels a draft or active goal. */
  public cancel(
    id: string,
    input: PhysicalGoalTransition
  ): Promise<PhysicalGoal> {
    return this.store.cancel(
      this.personContext.getPersonId(),
      id,
      input
    );
  }

  /**
   * Reads one goal aggregate.
   *
   * @throws NotFoundError when the goal is not owned by the active Person.
   */
  public async findById(id: string): Promise<PhysicalGoal> {
    const goal = await this.store.findById(
      this.personContext.getPersonId(),
      id
    );
    if (!goal) {
      throw new NotFoundError("PhysicalGoal was not found");
    }
    return goal;
  }

  /**
   * Reads all immutable versions of one goal.
   *
   * @throws NotFoundError when the goal is not owned by the active Person.
   */
  public async history(id: string): Promise<PhysicalGoalHistory> {
    const history = await this.store.history(
      this.personContext.getPersonId(),
      id
    );
    if (!history) {
      throw new NotFoundError("PhysicalGoal was not found");
    }
    return history;
  }

  /** Lists Person-owned goals with an optional lifecycle filter. */
  public list(
    query: ListPhysicalGoalsQuery
  ): Promise<PhysicalGoalList> {
    return this.store.list(
      this.personContext.getPersonId(),
      query.status
    );
  }
}
