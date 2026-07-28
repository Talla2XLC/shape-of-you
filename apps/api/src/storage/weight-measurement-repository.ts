import {
  and,
  desc,
  eq,
  lt,
  or
} from "drizzle-orm";

import type {
  CreateWeightMeasurement,
  WeightMeasurement,
  WeightMeasurementList
} from "@shape-of-you/contracts";

import type { DatabaseContext } from "../database/context.js";
import { weightMeasurements } from "../database/schema.js";
import {
  decodeCursor,
  encodeCursor
} from "../domain/cursor.js";
import {
  toNewWeightMeasurement,
  toWeightMeasurement
} from "../domain/weight-measurement.js";

/** Result of an idempotent WeightMeasurement create operation. */
export interface CreateWeightMeasurementResult {
  /** Whether this call inserted the immutable fact. */
  readonly created: boolean;
  /** Newly inserted or previously existing fact for the dedupe key. */
  readonly measurement: WeightMeasurement;
}

/** Persistence contract for immutable WeightMeasurement facts. */
export interface WeightMeasurementStore {
  /**
   * Creates a fact once per dedupe key.
   *
   * @param input - Validated creation contract.
   * @returns The inserted or previously existing measurement.
   */
  create(
    input: CreateWeightMeasurement
  ): Promise<CreateWeightMeasurementResult>;

  /**
   * Finds one immutable measurement by UUID.
   *
   * @param id - Measurement UUID.
   * @returns The measurement, or `null` when it does not exist.
   */
  findById(id: string): Promise<WeightMeasurement | null>;

  /**
   * Lists measurements in stable descending timestamp and UUID order.
   *
   * @param limit - Maximum number of facts to return.
   * @param cursor - Optional opaque keyset cursor.
   * @returns One page and the next cursor when more facts exist.
   */
  list(limit: number, cursor?: string): Promise<WeightMeasurementList>;
}

/** PostgreSQL implementation of the WeightMeasurement persistence contract. */
export class WeightMeasurementRepository
  implements WeightMeasurementStore
{
  public constructor(private readonly database: DatabaseContext) {}

  /** {@inheritDoc WeightMeasurementStore.create} */
  public async create(
    input: CreateWeightMeasurement
  ): Promise<CreateWeightMeasurementResult> {
    const inserted = await this.database.db
      .insert(weightMeasurements)
      .values(toNewWeightMeasurement(input))
      .onConflictDoNothing({
        target: weightMeasurements.dedupeKey
      })
      .returning();

    const createdRow = inserted[0];
    if (createdRow) {
      return {
        created: true,
        measurement: toWeightMeasurement(createdRow)
      };
    }

    const existing = await this.database.db.query.weightMeasurements.findFirst({
      where: eq(weightMeasurements.dedupeKey, input.dedupeKey)
    });

    if (!existing) {
      throw new Error("dedupe conflict did not resolve to an existing fact");
    }

    return {
      created: false,
      measurement: toWeightMeasurement(existing)
    };
  }

  /** {@inheritDoc WeightMeasurementStore.findById} */
  public async findById(id: string): Promise<WeightMeasurement | null> {
    const row = await this.database.db.query.weightMeasurements.findFirst({
      where: eq(weightMeasurements.id, id)
    });
    return row ? toWeightMeasurement(row) : null;
  }

  /** {@inheritDoc WeightMeasurementStore.list} */
  public async list(
    limit: number,
    cursorValue?: string
  ): Promise<WeightMeasurementList> {
    const cursor = cursorValue ? decodeCursor(cursorValue) : undefined;
    const rows = await this.database.db
      .select()
      .from(weightMeasurements)
      .where(
        cursor
          ? or(
              lt(weightMeasurements.measuredAt, new Date(cursor.measuredAt)),
              and(
                eq(
                  weightMeasurements.measuredAt,
                  new Date(cursor.measuredAt)
                ),
                lt(weightMeasurements.id, cursor.id)
              )
            )
          : undefined
      )
      .orderBy(
        desc(weightMeasurements.measuredAt),
        desc(weightMeasurements.id)
      )
      .limit(limit + 1);

    const hasNextPage = rows.length > limit;
    const page = rows.slice(0, limit);
    const last = page.at(-1);

    return {
      items: page.map(toWeightMeasurement),
      nextCursor:
        hasNextPage && last
          ? encodeCursor({
              measuredAt: last.measuredAt.toISOString(),
              id: last.id
            })
          : null
    };
  }
}
