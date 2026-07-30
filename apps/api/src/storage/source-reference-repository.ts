import { and, eq } from "drizzle-orm";

import type { SourceReferenceInput } from "@shape-of-you/contracts";

import type { DatabaseContext } from "../database/context.js";
import {
  sourceReferences,
  type SourceReferenceRow
} from "../database/schema.js";

export type DatabaseTransaction = Parameters<
  Parameters<DatabaseContext["db"]["transaction"]>[0]
>[0];

/** SourceReference row plus whether the current transaction inserted it. */
export interface EnsuredSourceReference {
  readonly row: SourceReferenceRow;
  readonly inserted: boolean;
}

/**
 * Creates or retrieves a Person-owned typed provenance record.
 *
 * @param transaction - Active application database transaction.
 * @param personId - UUID of the Person that owns the provenance.
 * @param input - Validated public provenance input.
 * @returns Inserted or previously existing SourceReference.
 */
export async function ensureSourceReference(
  transaction: DatabaseTransaction,
  personId: string,
  input: SourceReferenceInput
): Promise<EnsuredSourceReference> {
  const inserted = await transaction
    .insert(sourceReferences)
    .values({
      personId,
      channel: input.channel,
      externalSystem: input.externalSystem,
      externalRecordId: input.externalRecordId,
      occurredAt: input.occurredAt ? new Date(input.occurredAt) : null
    })
    .onConflictDoNothing()
    .returning();

  if (inserted[0]) {
    return { row: inserted[0], inserted: true };
  }

  if (!input.externalSystem || !input.externalRecordId) {
    throw new Error("SourceReference insert failed without a unique key");
  }

  const existing = await transaction.query.sourceReferences.findFirst({
    where: and(
      eq(sourceReferences.personId, personId),
      eq(sourceReferences.channel, input.channel),
      eq(sourceReferences.externalSystem, input.externalSystem),
      eq(sourceReferences.externalRecordId, input.externalRecordId)
    )
  });

  if (!existing) {
    throw new Error("SourceReference conflict did not resolve");
  }

  return { row: existing, inserted: false };
}

/**
 * Removes a just-created provenance row when its owning entity deduplicated.
 *
 * @param transaction - Active application database transaction.
 * @param sourceReference - Ensured provenance result.
 */
export async function discardUnusedSourceReference(
  transaction: DatabaseTransaction,
  sourceReference: EnsuredSourceReference
): Promise<void> {
  if (sourceReference.inserted) {
    await transaction
      .delete(sourceReferences)
      .where(eq(sourceReferences.id, sourceReference.row.id));
  }
}
