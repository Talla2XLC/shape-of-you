import { Inject, Injectable } from "@nestjs/common";

import type {
  CorrectWeightMeasurement,
  CreateWeightMeasurement,
  ListWeightMeasurementsQuery,
  WeightMeasurement,
  WeightMeasurementHistory,
  WeightMeasurementList
} from "@shape-of-you/contracts";

import type { PersonContext } from "../application/person-context.js";
import {
  PERSON_CONTEXT,
  WEIGHT_MEASUREMENT_STORE
} from "../application/tokens.js";
import { NotFoundError } from "../domain/errors.js";
import type {
  CreateWeightMeasurementResult,
  WeightMeasurementStore
} from "../storage/weight-measurement-repository.js";

/** Application service for the immutable WeightMeasurement vertical. */
@Injectable()
export class WeightMeasurementService {
  public constructor(
    @Inject(WEIGHT_MEASUREMENT_STORE)
    private readonly store: WeightMeasurementStore,
    @Inject(PERSON_CONTEXT)
    private readonly personContext: PersonContext
  ) {}

  /**
   * Creates or retrieves a measurement for one deduplication key.
   *
   * @param input - Validated creation contract.
   * @returns Insert outcome and immutable measurement.
   */
  public create(
    input: CreateWeightMeasurement
  ): Promise<CreateWeightMeasurementResult> {
    return this.store.create(this.personContext.getPersonId(), input);
  }

  /**
   * Appends a replacement fact that supersedes the selected current fact.
   *
   * @param id - Existing fact UUID.
   * @param input - Full corrected snapshot and mandatory reason.
   * @returns Idempotent correction outcome.
   */
  public correct(
    id: string,
    input: CorrectWeightMeasurement
  ): Promise<CreateWeightMeasurementResult> {
    return this.store.correct(
      this.personContext.getPersonId(),
      id,
      input
    );
  }

  /**
   * Finds one measurement or fails with the stable not-found domain error.
   *
   * @param id - Validated measurement UUID.
   * @returns Existing immutable measurement.
   * @throws NotFoundError when no measurement has the requested UUID.
   */
  public async findById(id: string): Promise<WeightMeasurement> {
    const measurement = await this.store.findById(
      this.personContext.getPersonId(),
      id
    );
    if (!measurement) {
      throw new NotFoundError("WeightMeasurement was not found");
    }
    return measurement;
  }

  /**
   * Lists measurements using the repository's stable keyset ordering.
   *
   * @param query - Validated page size and optional opaque cursor.
   * @returns One measurement page.
   */
  public list(
    query: ListWeightMeasurementsQuery
  ): Promise<WeightMeasurementList> {
    return this.store.list(
      this.personContext.getPersonId(),
      query.limit ?? 50,
      query.cursor
    );
  }

  /** Reads every current measurement for one exact Person-local date. */
  public listForLocalDate(
    localDate: string
  ): Promise<readonly WeightMeasurement[]> {
    return this.store.listForLocalDate(
      this.personContext.getPersonId(),
      localDate
    );
  }

  /**
   * Returns the complete ordered correction chain containing a fact.
   *
   * @param id - Any fact UUID in the correction chain.
   * @returns Complete chain from original to current fact.
   * @throws NotFoundError when the fact is not owned by the active Person.
   */
  public async history(id: string): Promise<WeightMeasurementHistory> {
    const history = await this.store.history(
      this.personContext.getPersonId(),
      id
    );
    if (!history) {
      throw new NotFoundError("WeightMeasurement was not found");
    }
    return history;
  }
}
