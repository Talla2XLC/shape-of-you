import { and, desc, eq, sql } from "drizzle-orm";

import type {
  DayClosure,
  DayClosureHistory,
  DayClosureReference,
  DaySnapshot
} from "@shape-of-you/contracts";

import type { DatabaseContext } from "../database/context.js";
import {
  dayClosureOperations,
  dayClosureReferences,
  dayClosures,
  type DayClosureRow
} from "../database/schema.js";
import { ConflictError } from "../domain/errors.js";
import type { DatabaseTransaction } from "./source-reference-repository.js";

/** Candidate composed by module-owned read ports before it is atomically closed. */
export interface DayClosureCandidate {
  readonly localDate: string;
  readonly timezone: string;
  readonly policyVersion: string;
  readonly snapshot: DaySnapshot;
  readonly references: readonly DayClosureReference[];
  readonly stateFingerprint: string;
  /** The current HTTP command is explicitly performed by the Person owner. */
  readonly actorPersonId: string;
  /** Provenance channel of the explicit command. */
  readonly source: "manual";
}

/** Active closure plus the internal state fingerprint used only for freshness. */
export interface ActiveDayClosure {
  readonly closure: DayClosure;
  readonly stateFingerprint: string;
}

/** Persistence boundary for the DayClosure coordination module. */
export interface DayClosureStore {
  findActive(
    personId: string,
    localDate: string
  ): Promise<ActiveDayClosure | null>;
  history(personId: string, localDate: string): Promise<DayClosureHistory>;
  close(
    personId: string,
    candidate: DayClosureCandidate,
    idempotencyKey: string,
    requestFingerprint: string
  ): Promise<{ readonly created: boolean; readonly closure: DayClosure }>;
  reopen(
    personId: string,
    localDate: string,
    reason: string,
    idempotencyKey: string,
    requestFingerprint: string
  ): Promise<{ readonly created: boolean; readonly closure: DayClosure }>;
}

/** PostgreSQL persistence for append-only Person-local closure versions. */
export class DayClosureRepository implements DayClosureStore {
  public constructor(private readonly database: DatabaseContext) {}

  public async findActive(
    personId: string,
    localDate: string
  ): Promise<ActiveDayClosure | null> {
    const row = await this.database.db.query.dayClosures.findFirst({
      where: and(
        eq(dayClosures.personId, personId),
        eq(dayClosures.localDate, localDate),
        eq(dayClosures.status, "active")
      )
    });
    return row
      ? {
          closure: await this.hydrate(this.database.db, row),
          stateFingerprint: row.stateFingerprint
        }
      : null;
  }

  public async history(
    personId: string,
    localDate: string
  ): Promise<DayClosureHistory> {
    const rows = await this.database.db
      .select()
      .from(dayClosures)
      .where(
        and(
          eq(dayClosures.personId, personId),
          eq(dayClosures.localDate, localDate)
        )
      )
      .orderBy(desc(dayClosures.version));
    return { items: await Promise.all(rows.map((row) => this.hydrate(this.database.db, row))) };
  }

  public close(
    personId: string,
    candidate: DayClosureCandidate,
    idempotencyKey: string,
    requestFingerprint: string
  ): Promise<{ readonly created: boolean; readonly closure: DayClosure }> {
    return this.database.db.transaction(async (transaction) => {
      await lockPerson(transaction, personId);
      const replay = await this.findOperation(
        transaction,
        personId,
        "close",
        idempotencyKey
      );
      if (replay) {
        if (replay.requestFingerprint !== requestFingerprint) {
          throw new ConflictError("Idempotency key was already used with a different close request");
        }
        return { created: false, closure: await this.hydrateById(transaction, replay.closureId) };
      }

      const active = await transaction.query.dayClosures.findFirst({
        where: and(
          eq(dayClosures.personId, personId),
          eq(dayClosures.localDate, candidate.localDate),
          eq(dayClosures.status, "active")
        )
      });
      if (active) {
        throw new ConflictError("The selected day is already closed");
      }
      const prior = await transaction.query.dayClosures.findFirst({
        where: and(
          eq(dayClosures.personId, personId),
          eq(dayClosures.localDate, candidate.localDate)
        ),
        orderBy: [desc(dayClosures.version)]
      });
      const inserted = await transaction
        .insert(dayClosures)
        .values({
          personId,
          closedByPersonId: candidate.actorPersonId,
          source: candidate.source,
          localDate: candidate.localDate,
          timezone: candidate.timezone,
          version: (prior?.version ?? 0) + 1,
          status: "active",
          policyVersion: candidate.policyVersion,
          snapshot: candidate.snapshot,
          stateFingerprint: candidate.stateFingerprint,
          supersedesId: prior?.id ?? null
        })
        .returning();
      const row = inserted[0];
      if (!row) throw new Error("DayClosure insert did not return a row");
      await this.insertReferences(transaction, row.id, candidate.references);
      await transaction.insert(dayClosureOperations).values({
        personId,
        actorPersonId: candidate.actorPersonId,
        source: candidate.source,
        operation: "close",
        localDate: candidate.localDate,
        idempotencyKey,
        requestFingerprint,
        closureId: row.id
      });
      return { created: true, closure: await this.hydrate(transaction, row) };
    });
  }

  public reopen(
    personId: string,
    localDate: string,
    reason: string,
    idempotencyKey: string,
    requestFingerprint: string
  ): Promise<{ readonly created: boolean; readonly closure: DayClosure }> {
    return this.database.db.transaction(async (transaction) => {
      await lockPerson(transaction, personId);
      const replay = await this.findOperation(
        transaction,
        personId,
        "reopen",
        idempotencyKey
      );
      if (replay) {
        if (replay.requestFingerprint !== requestFingerprint) {
          throw new ConflictError("Idempotency key was already used with a different reopen request");
        }
        return { created: false, closure: await this.hydrateById(transaction, replay.closureId) };
      }
      const active = await transaction.query.dayClosures.findFirst({
        where: and(
          eq(dayClosures.personId, personId),
          eq(dayClosures.localDate, localDate),
          eq(dayClosures.status, "active")
        )
      });
      if (!active) throw new ConflictError("The selected day is not closed");
      const updated = await transaction
        .update(dayClosures)
        .set({ status: "superseded", reopenedAt: new Date(), reopenReason: reason })
        .where(eq(dayClosures.id, active.id))
        .returning();
      const row = updated[0];
      if (!row) throw new Error("DayClosure reopen update did not return a row");
      await transaction.insert(dayClosureOperations).values({
        personId,
        actorPersonId: personId,
        source: "manual",
        operation: "reopen",
        localDate,
        idempotencyKey,
        requestFingerprint,
        closureId: row.id
      });
      return { created: true, closure: await this.hydrate(transaction, row) };
    });
  }

  private async findOperation(
    transaction: DatabaseTransaction,
    personId: string,
    operation: "close" | "reopen",
    idempotencyKey: string
  ) {
    return transaction.query.dayClosureOperations.findFirst({
      where: and(
        eq(dayClosureOperations.personId, personId),
        eq(dayClosureOperations.operation, operation),
        eq(dayClosureOperations.idempotencyKey, idempotencyKey)
      )
    });
  }

  private async insertReferences(
    transaction: DatabaseTransaction,
    closureId: string,
    references: readonly DayClosureReference[]
  ): Promise<void> {
    const deduplicated = new Map(
      references.map((reference) => [`${reference.kind}:${reference.id}`, reference])
    );
    if (deduplicated.size > 0) {
      await transaction.insert(dayClosureReferences).values(
        [...deduplicated.values()].map((reference) => ({
          closureId,
          kind: reference.kind,
          referenceId: reference.id
        }))
      );
    }
  }

  private async hydrateById(
    transaction: DatabaseTransaction,
    id: string
  ): Promise<DayClosure> {
    const row = await transaction.query.dayClosures.findFirst({
      where: eq(dayClosures.id, id)
    });
    if (!row) throw new Error("DayClosure idempotency record references a missing closure");
    return this.hydrate(transaction, row);
  }

  private async hydrate(
    database: Pick<DatabaseContext, "db">["db"] | DatabaseTransaction,
    row: DayClosureRow
  ): Promise<DayClosure> {
    const references = await database
      .select({ kind: dayClosureReferences.kind, id: dayClosureReferences.referenceId })
      .from(dayClosureReferences)
      .where(eq(dayClosureReferences.closureId, row.id));
    return {
      id: row.id,
      personId: row.personId,
      closedByPersonId: row.closedByPersonId,
      source: row.source,
      localDate: row.localDate,
      timezone: row.timezone,
      version: row.version,
      status: row.status,
      policyVersion: row.policyVersion,
      snapshot: row.snapshot as DaySnapshot,
      references,
      closedAt: row.closedAt.toISOString(),
      reopenedAt: row.reopenedAt?.toISOString() ?? null,
      reopenReason: row.reopenReason,
      supersedesId: row.supersedesId
    };
  }
}

async function lockPerson(
  transaction: DatabaseTransaction,
  personId: string
): Promise<void> {
  await transaction.execute(sql`select pg_advisory_xact_lock(hashtext(${personId}))`);
}
