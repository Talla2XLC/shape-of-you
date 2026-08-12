import { Inject, Injectable } from "@nestjs/common";

import type {
  BodyMeasurementSession,
  BodyMeasurementSessionHistory,
  BodyMeasurementSessionList,
  CorrectBodyMeasurementSession,
  CreateBodyMeasurementSession,
  ListBodyMeasurementSessionsQuery
} from "@shape-of-you/contracts";

import type { PersonContext } from "../application/person-context.js";
import {
  BODY_MEASUREMENT_SESSION_STORE,
  PERSON_CONTEXT
} from "../application/tokens.js";
import { NotFoundError } from "../domain/errors.js";
import type {
  BodyMeasurementSessionStore,
  CreateBodyMeasurementSessionResult
} from "../storage/body-measurement-session-repository.js";

/** Application service for immutable body measurement sessions. */
@Injectable()
export class BodyMeasurementSessionService {
  public constructor(
    @Inject(BODY_MEASUREMENT_SESSION_STORE)
    private readonly store: BodyMeasurementSessionStore,
    @Inject(PERSON_CONTEXT)
    private readonly personContext: PersonContext
  ) {}

  /** Creates or retrieves one idempotent body measurement session. */
  public create(
    input: CreateBodyMeasurementSession
  ): Promise<CreateBodyMeasurementSessionResult> {
    return this.store.create(this.personContext.getPersonId(), input);
  }

  /** Appends an immutable full-session correction. */
  public correct(
    id: string,
    input: CorrectBodyMeasurementSession
  ): Promise<CreateBodyMeasurementSessionResult> {
    return this.store.correct(
      this.personContext.getPersonId(),
      id,
      input
    );
  }

  /**
   * Reads one Person-owned session.
   *
   * @throws NotFoundError when the session is not visible to the active Person.
   */
  public async findById(id: string): Promise<BodyMeasurementSession> {
    const session = await this.store.findById(
      this.personContext.getPersonId(),
      id
    );
    if (!session) {
      throw new NotFoundError("BodyMeasurementSession was not found");
    }
    return session;
  }

  /** Lists current sessions in stable keyset order. */
  public list(
    query: ListBodyMeasurementSessionsQuery
  ): Promise<BodyMeasurementSessionList> {
    return this.store.list(
      this.personContext.getPersonId(),
      query.limit ?? 50,
      query.cursor,
      query.metric
    );
  }

  /** Reads every current body-measurement session for one Person-local date. */
  public listForLocalDate(
    localDate: string
  ): Promise<readonly BodyMeasurementSession[]> {
    return this.store.listForLocalDate(
      this.personContext.getPersonId(),
      localDate
    );
  }

  /**
   * Reads a complete body session correction chain.
   *
   * @throws NotFoundError when the selected session does not exist.
   */
  public async history(
    id: string
  ): Promise<BodyMeasurementSessionHistory> {
    const history = await this.store.history(
      this.personContext.getPersonId(),
      id
    );
    if (!history) {
      throw new NotFoundError("BodyMeasurementSession was not found");
    }
    return history;
  }
}
