import { Inject, Injectable } from "@nestjs/common";

import type {
  CreateWeightMeasurement,
  ListWeightMeasurementsQuery,
  WeightMeasurement,
  WeightMeasurementList
} from "@shape-of-you/contracts";

import { WEIGHT_MEASUREMENT_STORE } from "../application/tokens.js";
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
    private readonly store: WeightMeasurementStore
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
    return this.store.create(input);
  }

  /**
   * Finds one measurement or fails with the stable not-found domain error.
   *
   * @param id - Validated measurement UUID.
   * @returns Existing immutable measurement.
   * @throws NotFoundError when no measurement has the requested UUID.
   */
  public async findById(id: string): Promise<WeightMeasurement> {
    const measurement = await this.store.findById(id);
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
    return this.store.list(query.limit ?? 50, query.cursor);
  }
}
