import { and, asc, eq, inArray, notExists, sql } from "drizzle-orm";
import { alias } from "drizzle-orm/pg-core";

import type {
  CorrectDailyContextNote,
  CreateDailyContextNote,
  DailyContextNote,
  DailyContextNoteHistory,
  DailyContextNoteList
} from "@shape-of-you/contracts";

import type { DatabaseContext } from "../database/context.js";
import {
  dailyContextNotes,
  sourceReferences,
  type DailyContextNoteRow,
  type SourceReferenceRow
} from "../database/schema.js";
import { ConflictError, NotFoundError } from "../domain/errors.js";
import {
  toDailyContextNote,
  toNewDailyContextNote
} from "../domain/daily-context-note.js";
import {
  discardUnusedSourceReference,
  ensureSourceReference,
  type DatabaseTransaction
} from "./source-reference-repository.js";

interface JoinedNote {
  readonly note: DailyContextNoteRow;
  readonly sourceReference: SourceReferenceRow;
}

/** Idempotent create/correction result for one DailyContextNote. */
export interface CreateDailyContextNoteResult {
  readonly created: boolean;
  readonly note: DailyContextNote;
}

/** Persistence boundary for append-only Person-owned DailyContextNote facts. */
export interface DailyContextNoteStore {
  create(
    personId: string,
    input: CreateDailyContextNote
  ): Promise<CreateDailyContextNoteResult>;
  correct(
    personId: string,
    id: string,
    input: CorrectDailyContextNote
  ): Promise<CreateDailyContextNoteResult>;
  listForLocalDate(
    personId: string,
    localDate: string
  ): Promise<DailyContextNoteList>;
  history(
    personId: string,
    id: string
  ): Promise<DailyContextNoteHistory | null>;
}

function serialize(row: JoinedNote): DailyContextNote {
  return toDailyContextNote(row.note, row.sourceReference);
}

async function createInTransaction(
  transaction: DatabaseTransaction,
  personId: string,
  input: CreateDailyContextNote | CorrectDailyContextNote,
  correction?: { readonly supersedesId: string; readonly reason: string }
): Promise<CreateDailyContextNoteResult> {
  const sourceReference = await ensureSourceReference(
    transaction,
    personId,
    input.sourceReference
  );
  const inserted = await transaction
    .insert(dailyContextNotes)
    .values(
      toNewDailyContextNote(
        personId,
        sourceReference.row.id,
        input,
        correction
      )
    )
    .onConflictDoNothing()
    .returning();
  if (inserted[0]) {
    return {
      created: true,
      note: toDailyContextNote(inserted[0], sourceReference.row)
    };
  }
  await discardUnusedSourceReference(transaction, sourceReference);
  const existing = await transaction
    .select({ note: dailyContextNotes, sourceReference: sourceReferences })
    .from(dailyContextNotes)
    .innerJoin(
      sourceReferences,
      eq(dailyContextNotes.sourceReferenceId, sourceReferences.id)
    )
    .where(
      and(
        eq(dailyContextNotes.personId, personId),
        eq(dailyContextNotes.source, input.sourceReference.channel),
        eq(dailyContextNotes.dedupeKey, input.dedupeKey)
      )
    )
    .limit(1);
  if (!existing[0]) {
    throw new Error("DailyContextNote dedupe conflict could not be resolved");
  }
  return { created: false, note: serialize(existing[0]) };
}

/** PostgreSQL implementation of the DailyContextNote persistence boundary. */
export class DailyContextNoteRepository implements DailyContextNoteStore {
  public constructor(private readonly database: DatabaseContext) {}

  /** {@inheritDoc DailyContextNoteStore.create} */
  public create(
    personId: string,
    input: CreateDailyContextNote
  ): Promise<CreateDailyContextNoteResult> {
    return this.database.db.transaction((transaction) =>
      createInTransaction(transaction, personId, input)
    );
  }

  /** {@inheritDoc DailyContextNoteStore.correct} */
  public correct(
    personId: string,
    id: string,
    input: CorrectDailyContextNote
  ): Promise<CreateDailyContextNoteResult> {
    return this.database.db.transaction(async (transaction) => {
      await transaction.execute(
        sql`select id from ${dailyContextNotes}
            where ${dailyContextNotes.id} = ${id}
              and ${dailyContextNotes.personId} = ${personId}
            for update`
      );
      const current = await transaction
        .select({ id: dailyContextNotes.id })
        .from(dailyContextNotes)
        .where(
          and(
            eq(dailyContextNotes.id, id),
            eq(dailyContextNotes.personId, personId)
          )
        )
        .limit(1);
      if (!current[0]) {
        throw new NotFoundError("DailyContextNote was not found");
      }
      const superseder = alias(dailyContextNotes, "daily_context_note_superseder");
      const superseded = await transaction
        .select({ id: superseder.id })
        .from(superseder)
        .where(
          and(
            eq(superseder.personId, personId),
            eq(superseder.supersedesId, id)
          )
        )
        .limit(1);
      if (superseded[0]) {
        throw new ConflictError("DailyContextNote was already superseded");
      }
      return createInTransaction(transaction, personId, input, {
        supersedesId: id,
        reason: input.reason
      });
    });
  }

  /** {@inheritDoc DailyContextNoteStore.listForLocalDate} */
  public async listForLocalDate(
    personId: string,
    localDate: string
  ): Promise<DailyContextNoteList> {
    const superseder = alias(dailyContextNotes, "daily_context_note_current");
    const rows = await this.database.db
      .select({ note: dailyContextNotes, sourceReference: sourceReferences })
      .from(dailyContextNotes)
      .innerJoin(
        sourceReferences,
        eq(dailyContextNotes.sourceReferenceId, sourceReferences.id)
      )
      .where(
        and(
          eq(dailyContextNotes.personId, personId),
          eq(dailyContextNotes.localDate, localDate),
          notExists(
            this.database.db
              .select({ id: superseder.id })
              .from(superseder)
              .where(
                and(
                  eq(superseder.personId, personId),
                  eq(superseder.supersedesId, dailyContextNotes.id)
                )
              )
          )
        )
      )
      .orderBy(asc(dailyContextNotes.createdAt), asc(dailyContextNotes.id));
    return { items: rows.map(serialize) };
  }

  /** {@inheritDoc DailyContextNoteStore.history} */
  public async history(
    personId: string,
    id: string
  ): Promise<DailyContextNoteHistory | null> {
    const rows = await this.database.pool.query<{
      note_id: string;
    }>(
      `with recursive chain as (
         select id, supersedes_id, created_at from daily_context_notes
          where id = $1 and person_id = $2
         union
         select n.id, n.supersedes_id, n.created_at
           from daily_context_notes n
           join chain c on n.id = c.supersedes_id or n.supersedes_id = c.id
          where n.person_id = $2
       ) select distinct id as note_id from chain order by note_id`,
      [id, personId]
    );
    if (rows.rows.length === 0) return null;
    const joined = await this.database.db
      .select({ note: dailyContextNotes, sourceReference: sourceReferences })
      .from(dailyContextNotes)
      .innerJoin(
        sourceReferences,
        eq(dailyContextNotes.sourceReferenceId, sourceReferences.id)
      )
      .where(
        and(
          eq(dailyContextNotes.personId, personId),
          inArray(dailyContextNotes.id, rows.rows.map((row) => row.note_id))
        )
      )
      .orderBy(asc(dailyContextNotes.createdAt), asc(dailyContextNotes.id));
    return { items: joined.map(serialize) };
  }
}
