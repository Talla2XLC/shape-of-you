import type { SourceReference } from "@shape-of-you/contracts";

import type { SourceReferenceRow } from "../database/schema.js";

/**
 * Converts persisted provenance into its public typed representation.
 *
 * Private ingestion metadata and raw snapshots deliberately remain internal.
 *
 * @param row - SourceReference row owned by the same Person as the entity.
 * @returns Public provenance contract.
 */
export function toSourceReference(
  row: SourceReferenceRow
): SourceReference {
  return {
    id: row.id,
    channel: row.channel,
    externalSystem: row.externalSystem,
    externalRecordId: row.externalRecordId,
    occurredAt: row.occurredAt?.toISOString() ?? null,
    ingestedAt: row.ingestedAt.toISOString()
  };
}
