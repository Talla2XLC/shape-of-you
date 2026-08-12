import {
  and,
  desc,
  eq,
  inArray,
  lt,
  notExists,
  or,
  sql
} from "drizzle-orm";
import { alias } from "drizzle-orm/pg-core";

import type {
  CorrectWeightMeasurement,
  CreateWeightMeasurement,
  WeightMeasurement,
  WeightMeasurementHistory,
  WeightMeasurementList
} from "@shape-of-you/contracts";

import type { DatabaseContext } from "../database/context.js";
import {
  sourceReferences,
  weightMeasurements,
  type SourceReferenceRow,
  type WeightMeasurementRow
} from "../database/schema.js";
import {
  decodeCursor,
  encodeCursor
} from "../domain/cursor.js";
import {
  ConflictError,
  NotFoundError
} from "../domain/errors.js";
import {
  toNewWeightMeasurement,
  toWeightMeasurement
} from "../domain/weight-measurement.js";
import {
  discardUnusedSourceReference,
  ensureSourceReference,
  type DatabaseTransaction,
  type EnsuredSourceReference
} from "./source-reference-repository.js";

interface JoinedMeasurement {
  readonly measurement: WeightMeasurementRow;
  readonly sourceReference: SourceReferenceRow;
}

/** Result of an idempotent WeightMeasurement create or correction operation. */
export interface CreateWeightMeasurementResult {
  /** Whether this call inserted the immutable fact. */
  readonly created: boolean;
  /** Newly inserted or previously existing fact for the dedupe key. */
  readonly measurement: WeightMeasurement;
}

/** Persistence contract for immutable, Person-owned WeightMeasurement facts. */
export interface WeightMeasurementStore {
  /**
   * Creates a fact once per Person, source channel and dedupe key.
   *
   * @param personId - Authorized data-owner UUID.
   * @param input - Validated creation contract.
   * @returns The inserted or previously existing measurement.
   */
  create(
    personId: string,
    input: CreateWeightMeasurement
  ): Promise<CreateWeightMeasurementResult>;

  /**
   * Appends an immutable correction to a current fact.
   *
   * @param personId - Authorized data-owner UUID.
   * @param id - Current fact UUID.
   * @param input - Full replacement snapshot and reason.
   * @returns The inserted correction or prior idempotent result.
   * @throws NotFoundError when the fact is not owned by the Person.
   * @throws ConflictError when the selected fact was already superseded.
   */
  correct(
    personId: string,
    id: string,
    input: CorrectWeightMeasurement
  ): Promise<CreateWeightMeasurementResult>;

  /**
   * Finds one immutable measurement by UUID within a Person boundary.
   *
   * @param personId - Authorized data-owner UUID.
   * @param id - Measurement UUID.
   * @returns The measurement, or `null` when it does not exist.
   */
  findById(
    personId: string,
    id: string
  ): Promise<WeightMeasurement | null>;

  /**
   * Lists only current facts in stable descending timestamp and UUID order.
   *
   * @param personId - Authorized data-owner UUID.
   * @param limit - Maximum number of facts to return.
   * @param cursor - Optional opaque keyset cursor.
   * @returns One page and the next cursor when more facts exist.
   */
  list(
    personId: string,
    limit: number,
    cursor?: string
  ): Promise<WeightMeasurementList>;

  /** Reads every current measurement for one exact Person-local calendar date. */
  listForLocalDate(
    personId: string,
    localDate: string
  ): Promise<readonly WeightMeasurement[]>;

  /**
   * Returns the complete ordered correction chain containing a fact.
   *
   * @param personId - Authorized data-owner UUID.
   * @param id - Any fact UUID in the chain.
   * @returns Original-to-current history, or `null` when not found.
   */
  history(
    personId: string,
    id: string
  ): Promise<WeightMeasurementHistory | null>;
}

function serializeJoined(row: JoinedMeasurement): WeightMeasurement {
  return toWeightMeasurement(row.measurement, row.sourceReference);
}

/**
 * Creates a WeightMeasurement inside a caller-owned database transaction.
 *
 * @param transaction - Active transaction that also owns surrounding workflow state.
 * @param personId - Authorized data-owner UUID.
 * @param input - Validated immutable fact command.
 * @param existingSourceReference - Optional provenance already owned by the transaction.
 * @returns Idempotent insert outcome.
 */
export async function createWeightMeasurementInTransaction(
  transaction: DatabaseTransaction,
  personId: string,
  input: CreateWeightMeasurement,
  existingSourceReference?: SourceReferenceRow
): Promise<CreateWeightMeasurementResult> {
  if (
    existingSourceReference &&
    existingSourceReference.channel !== input.sourceReference.channel
  ) {
    throw new Error("WeightMeasurement source channel does not match provenance");
  }
  const sourceReference: EnsuredSourceReference = existingSourceReference
    ? { row: existingSourceReference, inserted: false }
    : await ensureSourceReference(
        transaction,
        personId,
        input.sourceReference
      );
  const inserted = await transaction
    .insert(weightMeasurements)
    .values(
      toNewWeightMeasurement(
        personId,
        sourceReference.row.id,
        input
      )
    )
    .onConflictDoNothing()
    .returning();

  if (inserted[0]) {
    return {
      created: true,
      measurement: toWeightMeasurement(inserted[0], sourceReference.row)
    };
  }

  await discardUnusedSourceReference(transaction, sourceReference);
  const existing = await transaction
    .select({
      measurement: weightMeasurements,
      sourceReference: sourceReferences
    })
    .from(weightMeasurements)
    .innerJoin(
      sourceReferences,
      eq(weightMeasurements.sourceReferenceId, sourceReferences.id)
    )
    .where(
      and(
        eq(weightMeasurements.personId, personId),
        eq(
          weightMeasurements.source,
          input.sourceReference.channel
        ),
        eq(weightMeasurements.dedupeKey, input.dedupeKey)
      )
    )
    .limit(1);

  if (!existing[0]) {
    throw new Error(
      "WeightMeasurement conflict did not resolve to a deduplicated fact"
    );
  }

  return {
    created: false,
    measurement: serializeJoined(existing[0])
  };
}

/** PostgreSQL implementation of the WeightMeasurement persistence contract. */
export class WeightMeasurementRepository
  implements WeightMeasurementStore
{
  public constructor(private readonly database: DatabaseContext) {}

  /** {@inheritDoc WeightMeasurementStore.create} */
  public create(
    personId: string,
    input: CreateWeightMeasurement
  ): Promise<CreateWeightMeasurementResult> {
    return this.database.db.transaction((transaction) =>
      createWeightMeasurementInTransaction(transaction, personId, input)
    );
  }

  /** {@inheritDoc WeightMeasurementStore.correct} */
  public correct(
    personId: string,
    id: string,
    input: CorrectWeightMeasurement
  ): Promise<CreateWeightMeasurementResult> {
    return this.database.db.transaction(async (transaction) => {
      await transaction.execute(
        sql`select id from ${weightMeasurements}
            where ${weightMeasurements.id} = ${id}
              and ${weightMeasurements.personId} = ${personId}
            for update`
      );

      const original = await transaction.query.weightMeasurements.findFirst({
        where: and(
          eq(weightMeasurements.id, id),
          eq(weightMeasurements.personId, personId)
        )
      });
      if (!original) {
        throw new NotFoundError("WeightMeasurement was not found");
      }

      const successor = await transaction
        .select({
          measurement: weightMeasurements,
          sourceReference: sourceReferences
        })
        .from(weightMeasurements)
        .innerJoin(
          sourceReferences,
          eq(weightMeasurements.sourceReferenceId, sourceReferences.id)
        )
        .where(eq(weightMeasurements.supersedesId, id))
        .limit(1);

      if (successor[0]) {
        if (
          successor[0].measurement.source ===
            input.sourceReference.channel &&
          successor[0].measurement.dedupeKey === input.dedupeKey
        ) {
          return {
            created: false,
            measurement: serializeJoined(successor[0])
          };
        }
        throw new ConflictError(
          "WeightMeasurement was already superseded"
        );
      }

      const sourceReference = await ensureSourceReference(
        transaction,
        personId,
        input.sourceReference
      );
      const inserted = await transaction
        .insert(weightMeasurements)
        .values(
          toNewWeightMeasurement(
            personId,
            sourceReference.row.id,
            input,
            { supersedesId: id, reason: input.reason }
          )
        )
        .onConflictDoNothing()
        .returning();

      if (inserted[0]) {
        return {
          created: true,
          measurement: toWeightMeasurement(
            inserted[0],
            sourceReference.row
          )
        };
      }

      await discardUnusedSourceReference(transaction, sourceReference);
      const retry = await transaction
        .select({
          measurement: weightMeasurements,
          sourceReference: sourceReferences
        })
        .from(weightMeasurements)
        .innerJoin(
          sourceReferences,
          eq(weightMeasurements.sourceReferenceId, sourceReferences.id)
        )
        .where(
          and(
            eq(weightMeasurements.personId, personId),
            eq(
              weightMeasurements.source,
              input.sourceReference.channel
            ),
            eq(weightMeasurements.dedupeKey, input.dedupeKey),
            eq(weightMeasurements.supersedesId, id)
          )
        )
        .limit(1);

      if (retry[0]) {
        return {
          created: false,
          measurement: serializeJoined(retry[0])
        };
      }
      throw new ConflictError(
        "WeightMeasurement correction conflicts with current state"
      );
    });
  }

  /** {@inheritDoc WeightMeasurementStore.findById} */
  public async findById(
    personId: string,
    id: string
  ): Promise<WeightMeasurement | null> {
    const rows = await this.database.db
      .select({
        measurement: weightMeasurements,
        sourceReference: sourceReferences
      })
      .from(weightMeasurements)
      .innerJoin(
        sourceReferences,
        eq(weightMeasurements.sourceReferenceId, sourceReferences.id)
      )
      .where(
        and(
          eq(weightMeasurements.id, id),
          eq(weightMeasurements.personId, personId)
        )
      )
      .limit(1);
    return rows[0] ? serializeJoined(rows[0]) : null;
  }

  /** {@inheritDoc WeightMeasurementStore.list} */
  public async list(
    personId: string,
    limit: number,
    cursorValue?: string
  ): Promise<WeightMeasurementList> {
    const cursor = cursorValue ? decodeCursor(cursorValue) : undefined;
    const successor = alias(weightMeasurements, "successor");
    const rows = await this.database.db
      .select({
        measurement: weightMeasurements,
        sourceReference: sourceReferences
      })
      .from(weightMeasurements)
      .innerJoin(
        sourceReferences,
        eq(weightMeasurements.sourceReferenceId, sourceReferences.id)
      )
      .where(
        and(
          eq(weightMeasurements.personId, personId),
          notExists(
            this.database.db
              .select({ id: successor.id })
              .from(successor)
              .where(eq(successor.supersedesId, weightMeasurements.id))
          ),
          cursor
            ? or(
                lt(
                  weightMeasurements.measuredAt,
                  new Date(cursor.measuredAt)
                ),
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
      )
      .orderBy(
        desc(weightMeasurements.measuredAt),
        desc(weightMeasurements.id)
      )
      .limit(limit + 1);

    const hasNextPage = rows.length > limit;
    const page = rows.slice(0, limit);
    const last = page.at(-1)?.measurement;

    return {
      items: page.map(serializeJoined),
      nextCursor:
        hasNextPage && last
          ? encodeCursor({
              measuredAt: last.measuredAt.toISOString(),
              id: last.id
            })
          : null
    };
  }

  /** {@inheritDoc WeightMeasurementStore.listForLocalDate} */
  public async listForLocalDate(
    personId: string,
    localDate: string
  ): Promise<readonly WeightMeasurement[]> {
    const successor = alias(weightMeasurements, "daily_weight_successor");
    const rows = await this.database.db
      .select({ measurement: weightMeasurements, sourceReference: sourceReferences })
      .from(weightMeasurements)
      .innerJoin(sourceReferences, eq(weightMeasurements.sourceReferenceId, sourceReferences.id))
      .where(
        and(
          eq(weightMeasurements.personId, personId),
          eq(weightMeasurements.localDate, localDate),
          notExists(
            this.database.db
              .select({ id: successor.id })
              .from(successor)
              .where(eq(successor.supersedesId, weightMeasurements.id))
          )
        )
      )
      .orderBy(desc(weightMeasurements.measuredAt), desc(weightMeasurements.id));
    return rows.map(serializeJoined);
  }

  /** {@inheritDoc WeightMeasurementStore.history} */
  public async history(
    personId: string,
    id: string
  ): Promise<WeightMeasurementHistory | null> {
    const result = await this.database.pool.query<{ id: string }>(
      `with recursive ancestors as (
         select id, supersedes_id
           from weight_measurements
          where id = $1 and person_id = $2
         union all
         select parent.id, parent.supersedes_id
           from weight_measurements parent
           join ancestors child on child.supersedes_id = parent.id
          where parent.person_id = $2
       ),
       root as (
         select id, supersedes_id
           from ancestors
          where supersedes_id is null
       ),
       chain as (
         select id, supersedes_id, 0 as depth from root
         union all
         select child.id, child.supersedes_id, parent.depth + 1
           from weight_measurements child
           join chain parent on child.supersedes_id = parent.id
          where child.person_id = $2
       )
       select id from chain order by depth`,
      [id, personId]
    );

    const ids = result.rows.map((row) => row.id);
    if (ids.length === 0) {
      return null;
    }

    const rows = await this.database.db
      .select({
        measurement: weightMeasurements,
        sourceReference: sourceReferences
      })
      .from(weightMeasurements)
      .innerJoin(
        sourceReferences,
        eq(weightMeasurements.sourceReferenceId, sourceReferences.id)
      )
      .where(
        and(
          eq(weightMeasurements.personId, personId),
          inArray(weightMeasurements.id, ids)
        )
      );
    const byId = new Map(
      rows.map((row) => [row.measurement.id, serializeJoined(row)])
    );

    return {
      items: ids.map((chainId) => {
        const measurement = byId.get(chainId);
        if (!measurement) {
          throw new Error("Correction chain contains an unreadable fact");
        }
        return measurement;
      })
    };
  }
}
