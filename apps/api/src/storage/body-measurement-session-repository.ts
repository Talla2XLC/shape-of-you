import {
  and,
  desc,
  eq,
  lt,
  notExists,
  or,
  sql
} from "drizzle-orm";
import { alias } from "drizzle-orm/pg-core";

import type {
  BodyMeasurementSession,
  BodyMeasurementSessionHistory,
  BodyMeasurementSessionList,
  BodyMeasurementValueInput,
  CorrectBodyMeasurementSession,
  CreateBodyMeasurementSession
} from "@shape-of-you/contracts";

import type { DatabaseContext } from "../database/context.js";
import {
  bodyMeasurementSessions,
  bodyMeasurementValues,
  sourceReferences,
  type BodyMeasurementSessionRow,
  type BodyMeasurementValueRow,
  type SourceReferenceRow
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
  toBodyMeasurementSession,
  toNewBodyMeasurementSession,
  validateBodyMeasurementValues
} from "../domain/body-measurement-session.js";
import {
  discardUnusedSourceReference,
  ensureSourceReference,
  type DatabaseTransaction
} from "./source-reference-repository.js";

interface JoinedSession {
  readonly session: BodyMeasurementSessionRow;
  readonly sourceReference: SourceReferenceRow;
}

/** Result of idempotent body session creation or correction. */
export interface CreateBodyMeasurementSessionResult {
  readonly created: boolean;
  readonly session: BodyMeasurementSession;
}

/** Persistence contract for immutable BodyMeasurementSession aggregates. */
export interface BodyMeasurementSessionStore {
  create(
    personId: string,
    input: CreateBodyMeasurementSession
  ): Promise<CreateBodyMeasurementSessionResult>;
  correct(
    personId: string,
    id: string,
    input: CorrectBodyMeasurementSession
  ): Promise<CreateBodyMeasurementSessionResult>;
  findById(
    personId: string,
    id: string
  ): Promise<BodyMeasurementSession | null>;
  list(
    personId: string,
    limit: number,
    cursor?: string,
    metric?: BodyMeasurementValueInput["metric"]
  ): Promise<BodyMeasurementSessionList>;
  history(
    personId: string,
    id: string
  ): Promise<BodyMeasurementSessionHistory | null>;
}

async function insertValues(
  transaction: DatabaseTransaction,
  sessionId: string,
  values: readonly BodyMeasurementValueInput[]
): Promise<BodyMeasurementValueRow[]> {
  validateBodyMeasurementValues(values);
  return transaction
    .insert(bodyMeasurementValues)
    .values(
      values.map((value) => ({
        sessionId,
        metric: value.metric,
        value: value.value.toFixed(2),
        unit: value.unit
      }))
    )
    .returning();
}

/** PostgreSQL implementation of the body measurement aggregate store. */
export class BodyMeasurementSessionRepository
  implements BodyMeasurementSessionStore
{
  public constructor(private readonly database: DatabaseContext) {}

  public create(
    personId: string,
    input: CreateBodyMeasurementSession
  ): Promise<CreateBodyMeasurementSessionResult> {
    return this.database.db.transaction(async (transaction) => {
      const sourceReference = await ensureSourceReference(
        transaction,
        personId,
        input.sourceReference
      );
      const inserted = await transaction
        .insert(bodyMeasurementSessions)
        .values(
          toNewBodyMeasurementSession(
            personId,
            sourceReference.row.id,
            input
          )
        )
        .onConflictDoNothing()
        .returning();

      if (inserted[0]) {
        const values = await insertValues(
          transaction,
          inserted[0].id,
          input.values
        );
        return {
          created: true,
          session: toBodyMeasurementSession(
            inserted[0],
            values,
            sourceReference.row
          )
        };
      }

      await discardUnusedSourceReference(transaction, sourceReference);
      const existing = await transaction
        .select({
          session: bodyMeasurementSessions,
          sourceReference: sourceReferences
        })
        .from(bodyMeasurementSessions)
        .innerJoin(
          sourceReferences,
          eq(
            bodyMeasurementSessions.sourceReferenceId,
            sourceReferences.id
          )
        )
        .where(
          and(
            eq(bodyMeasurementSessions.personId, personId),
            eq(
              bodyMeasurementSessions.source,
              input.sourceReference.channel
            ),
            eq(bodyMeasurementSessions.dedupeKey, input.dedupeKey)
          )
        )
        .limit(1);
      if (!existing[0]) {
        throw new Error("BodyMeasurementSession conflict did not resolve");
      }
      return {
        created: false,
        session: await this.hydrate(existing[0], transaction)
      };
    });
  }

  public correct(
    personId: string,
    id: string,
    input: CorrectBodyMeasurementSession
  ): Promise<CreateBodyMeasurementSessionResult> {
    return this.database.db.transaction(async (transaction) => {
      await transaction.execute(
        sql`select id from ${bodyMeasurementSessions}
            where ${bodyMeasurementSessions.id} = ${id}
              and ${bodyMeasurementSessions.personId} = ${personId}
            for update`
      );
      const original =
        await transaction.query.bodyMeasurementSessions.findFirst({
          where: and(
            eq(bodyMeasurementSessions.id, id),
            eq(bodyMeasurementSessions.personId, personId)
          )
        });
      if (!original) {
        throw new NotFoundError("BodyMeasurementSession was not found");
      }

      const successor = await this.findJoinedSuccessor(
        transaction,
        id
      );
      if (successor) {
        if (
          successor.session.source === input.sourceReference.channel &&
          successor.session.dedupeKey === input.dedupeKey
        ) {
          return {
            created: false,
            session: await this.hydrate(successor, transaction)
          };
        }
        throw new ConflictError(
          "BodyMeasurementSession was already superseded"
        );
      }

      const sourceReference = await ensureSourceReference(
        transaction,
        personId,
        input.sourceReference
      );
      const inserted = await transaction
        .insert(bodyMeasurementSessions)
        .values(
          toNewBodyMeasurementSession(
            personId,
            sourceReference.row.id,
            input,
            { supersedesId: id, reason: input.reason }
          )
        )
        .onConflictDoNothing()
        .returning();
      if (!inserted[0]) {
        await discardUnusedSourceReference(transaction, sourceReference);
        const retry = await this.findByDedupe(
          transaction,
          personId,
          input.sourceReference.channel,
          input.dedupeKey
        );
        if (retry?.session.supersedesId === id) {
          return {
            created: false,
            session: await this.hydrate(retry, transaction)
          };
        }
        throw new ConflictError(
          "BodyMeasurementSession correction conflicts with current state"
        );
      }
      const values = await insertValues(
        transaction,
        inserted[0].id,
        input.values
      );
      return {
        created: true,
        session: toBodyMeasurementSession(
          inserted[0],
          values,
          sourceReference.row
        )
      };
    });
  }

  public async findById(
    personId: string,
    id: string
  ): Promise<BodyMeasurementSession | null> {
    const rows = await this.database.db
      .select({
        session: bodyMeasurementSessions,
        sourceReference: sourceReferences
      })
      .from(bodyMeasurementSessions)
      .innerJoin(
        sourceReferences,
        eq(
          bodyMeasurementSessions.sourceReferenceId,
          sourceReferences.id
        )
      )
      .where(
        and(
          eq(bodyMeasurementSessions.id, id),
          eq(bodyMeasurementSessions.personId, personId)
        )
      )
      .limit(1);
    return rows[0] ? this.hydrate(rows[0], this.database.db) : null;
  }

  public async list(
    personId: string,
    limit: number,
    cursorValue?: string,
    metric?: BodyMeasurementValueInput["metric"]
  ): Promise<BodyMeasurementSessionList> {
    const cursor = cursorValue ? decodeCursor(cursorValue) : undefined;
    const successor = alias(bodyMeasurementSessions, "body_successor");
    const rows = await this.database.db
      .select({
        session: bodyMeasurementSessions,
        sourceReference: sourceReferences
      })
      .from(bodyMeasurementSessions)
      .innerJoin(
        sourceReferences,
        eq(
          bodyMeasurementSessions.sourceReferenceId,
          sourceReferences.id
        )
      )
      .where(
        and(
          eq(bodyMeasurementSessions.personId, personId),
          notExists(
            this.database.db
              .select({ id: successor.id })
              .from(successor)
              .where(
                eq(successor.supersedesId, bodyMeasurementSessions.id)
              )
          ),
          metric
            ? sql`exists (
                select 1 from ${bodyMeasurementValues}
                where ${bodyMeasurementValues.sessionId} = ${bodyMeasurementSessions.id}
                  and ${bodyMeasurementValues.metric} = ${metric}
              )`
            : undefined,
          cursor
            ? or(
                lt(
                  bodyMeasurementSessions.measuredAt,
                  new Date(cursor.measuredAt)
                ),
                and(
                  eq(
                    bodyMeasurementSessions.measuredAt,
                    new Date(cursor.measuredAt)
                  ),
                  lt(bodyMeasurementSessions.id, cursor.id)
                )
              )
            : undefined
        )
      )
      .orderBy(
        desc(bodyMeasurementSessions.measuredAt),
        desc(bodyMeasurementSessions.id)
      )
      .limit(limit + 1);
    const hasNextPage = rows.length > limit;
    const page = rows.slice(0, limit);
    const items = await Promise.all(
      page.map((row) => this.hydrate(row, this.database.db))
    );
    const last = page.at(-1)?.session;
    return {
      items,
      nextCursor:
        hasNextPage && last
          ? encodeCursor({
              measuredAt: last.measuredAt.toISOString(),
              id: last.id
            })
          : null
    };
  }

  public async history(
    personId: string,
    id: string
  ): Promise<BodyMeasurementSessionHistory | null> {
    const result = await this.database.pool.query<{ id: string }>(
      `with recursive ancestors as (
         select id, supersedes_id
           from body_measurement_sessions
          where id = $1 and person_id = $2
         union all
         select parent.id, parent.supersedes_id
           from body_measurement_sessions parent
           join ancestors child on child.supersedes_id = parent.id
          where parent.person_id = $2
       ),
       root as (
         select id, supersedes_id from ancestors where supersedes_id is null
       ),
       chain as (
         select id, supersedes_id, 0 as depth from root
         union all
         select child.id, child.supersedes_id, parent.depth + 1
           from body_measurement_sessions child
           join chain parent on child.supersedes_id = parent.id
          where child.person_id = $2
       )
       select id from chain order by depth`,
      [id, personId]
    );
    if (result.rows.length === 0) {
      return null;
    }
    const items: BodyMeasurementSession[] = [];
    for (const row of result.rows) {
      const session = await this.findById(personId, row.id);
      if (!session) {
        throw new Error("Body correction chain contains unreadable state");
      }
      items.push(session);
    }
    return { items };
  }

  private async hydrate(
    joined: JoinedSession,
    query: Pick<DatabaseContext["db"], "select">
  ): Promise<BodyMeasurementSession> {
    const values = await query
      .select()
      .from(bodyMeasurementValues)
      .where(
        eq(bodyMeasurementValues.sessionId, joined.session.id)
      );
    return toBodyMeasurementSession(
      joined.session,
      values,
      joined.sourceReference
    );
  }

  private async findJoinedSuccessor(
    transaction: DatabaseTransaction,
    id: string
  ): Promise<JoinedSession | undefined> {
    const rows = await transaction
      .select({
        session: bodyMeasurementSessions,
        sourceReference: sourceReferences
      })
      .from(bodyMeasurementSessions)
      .innerJoin(
        sourceReferences,
        eq(
          bodyMeasurementSessions.sourceReferenceId,
          sourceReferences.id
        )
      )
      .where(eq(bodyMeasurementSessions.supersedesId, id))
      .limit(1);
    return rows[0];
  }

  private async findByDedupe(
    transaction: DatabaseTransaction,
    personId: string,
    source: "manual" | "google_sheets" | "import",
    dedupeKey: string
  ): Promise<JoinedSession | undefined> {
    const rows = await transaction
      .select({
        session: bodyMeasurementSessions,
        sourceReference: sourceReferences
      })
      .from(bodyMeasurementSessions)
      .innerJoin(
        sourceReferences,
        eq(
          bodyMeasurementSessions.sourceReferenceId,
          sourceReferences.id
        )
      )
      .where(
        and(
          eq(bodyMeasurementSessions.personId, personId),
          eq(bodyMeasurementSessions.source, source),
          eq(bodyMeasurementSessions.dedupeKey, dedupeKey)
        )
      )
      .limit(1);
    return rows[0];
  }
}
