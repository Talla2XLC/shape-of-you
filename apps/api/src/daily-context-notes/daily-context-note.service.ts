import { Inject, Injectable } from "@nestjs/common";

import type {
  CorrectDailyContextNote,
  CreateDailyContextNote,
  DailyContextNoteHistory,
  DailyContextNoteList,
  ListDailyContextNotesQuery
} from "@shape-of-you/contracts";

import { DAILY_CONTEXT_NOTE_STORE, PERSON_CONTEXT } from "../application/tokens.js";
import type { PersonContext } from "../application/person-context.js";
import { NotFoundError } from "../domain/errors.js";
import type {
  CreateDailyContextNoteResult,
  DailyContextNoteStore
} from "../storage/daily-context-note-repository.js";

/** Application boundary for append-only DailyContextNote facts. */
@Injectable()
export class DailyContextNoteService {
  public constructor(
    @Inject(DAILY_CONTEXT_NOTE_STORE)
    private readonly store: DailyContextNoteStore,
    @Inject(PERSON_CONTEXT)
    private readonly personContext: PersonContext
  ) {}

  /** Creates or returns an idempotent DailyContextNote. */
  public create(input: CreateDailyContextNote): Promise<CreateDailyContextNoteResult> {
    return this.store.create(this.personContext.getPersonId(), input);
  }

  /** Appends an immutable corrected DailyContextNote. */
  public correct(
    id: string,
    input: CorrectDailyContextNote
  ): Promise<CreateDailyContextNoteResult> {
    return this.store.correct(this.personContext.getPersonId(), id, input);
  }

  /** Lists current notes for one exact Person-local date. */
  public list(query: ListDailyContextNotesQuery): Promise<DailyContextNoteList> {
    return this.store.listForLocalDate(
      this.personContext.getPersonId(),
      query.localDate
    );
  }

  /** Lists current notes for closure composition without transport pagination. */
  public listForLocalDate(localDate: string): Promise<DailyContextNoteList> {
    return this.store.listForLocalDate(this.personContext.getPersonId(), localDate);
  }

  /** Returns the complete correction chain containing a note. */
  public async history(id: string): Promise<DailyContextNoteHistory> {
    const history = await this.store.history(this.personContext.getPersonId(), id);
    if (!history) throw new NotFoundError("DailyContextNote was not found");
    return history;
  }
}
