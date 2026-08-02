import { Inject, Injectable } from "@nestjs/common";

import type {
  ClarifyIntakeItem,
  CreateIntakeRequest,
  DecideIntakeItem,
  IntakeRequest
} from "@shape-of-you/contracts";

import type { PersonContext } from "../application/person-context.js";
import {
  INTAKE_STORE,
  PERSON_CONTEXT
} from "../application/tokens.js";
import { NotFoundError } from "../domain/errors.js";
import type { IntakeStore } from "../storage/intake-repository.js";

/** Application boundary for Person-owned Intake commands and projections. */
@Injectable()
export class IntakeService {
  public constructor(
    @Inject(INTAKE_STORE) private readonly store: IntakeStore,
    @Inject(PERSON_CONTEXT) private readonly personContext: PersonContext
  ) {}

  /** Accepts one message durably and schedules asynchronous parsing. */
  public async create(input: CreateIntakeRequest): Promise<IntakeRequest> {
    const result = await this.store.create(
      this.personContext.getPersonId(),
      input
    );
    return result.request;
  }

  /** Reads one request projection inside the active Person boundary. */
  public async find(id: string): Promise<IntakeRequest> {
    const request = await this.store.find(
      this.personContext.getPersonId(),
      id
    );
    if (!request) {
      throw new NotFoundError("Intake request was not found");
    }
    return request;
  }

  /** Adds an idempotent user answer for one ambiguous item. */
  public clarify(
    requestId: string,
    itemId: string,
    input: ClarifyIntakeItem
  ): Promise<IntakeRequest> {
    return this.store.clarify(
      this.personContext.getPersonId(),
      requestId,
      itemId,
      input
    );
  }

  /** Confirms or rejects one item without changing its siblings. */
  public decide(
    requestId: string,
    itemId: string,
    input: DecideIntakeItem
  ): Promise<IntakeRequest> {
    return this.store.decide(
      this.personContext.getPersonId(),
      requestId,
      itemId,
      input
    );
  }
}
