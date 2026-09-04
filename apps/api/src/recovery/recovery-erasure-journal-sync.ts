import type { Pool } from "pg";

import type { RecoveryErasureReason } from "@shape-of-you/contracts";

import type { RecoveryRepository } from "../storage/recovery-repository.js";
import {
  RecoveryErasureJournal,
  type VerifiedRecoveryErasureJournal
} from "./recovery-erasure-journal.js";

interface SourceErasureRow {
  readonly id: string;
  readonly person_id: string;
  readonly connection_id: string;
  readonly reason: RecoveryErasureReason;
  readonly requested_at: Date;
  readonly completed_at: Date | null;
}

/** Result of sealing one complete PostgreSQL erasure snapshot into the journal. */
export interface RecoveryErasureJournalSyncResult {
  readonly completeThrough: string;
  readonly acceptedCount: number;
  readonly completedCount: number;
}

/**
 * Copies all erasure state through one repeatable-read cutoff into SQLite, seals
 * a new checkpoint, and only then acknowledges journal durability in PostgreSQL.
 */
export async function synchronizeRecoveryErasureJournal(
  pool: Pool,
  journal: RecoveryErasureJournal,
  checkpointPath: string
): Promise<RecoveryErasureJournalSyncResult> {
  const client = await pool.connect();
  let cutoff: Date;
  let rows: readonly SourceErasureRow[];
  try {
    await client.query("begin isolation level repeatable read read only");
    const cutoffResult = await client.query<{ cutoff: Date }>(
      "select transaction_timestamp() as cutoff"
    );
    cutoff = cutoffResult.rows[0]?.cutoff ?? new Date(Number.NaN);
    if (Number.isNaN(cutoff.valueOf())) {
      throw new Error("Could not establish Recovery erasure journal cutoff");
    }
    const result = await client.query<SourceErasureRow>(
      `select id, person_id, connection_id, reason, requested_at, completed_at
         from recovery_erasure_requests
        where requested_at <= $1
        order by requested_at, id`,
      [cutoff]
    );
    rows = result.rows;
    await client.query("commit");
  } catch (error) {
    await client.query("rollback").catch(() => undefined);
    throw error;
  } finally {
    client.release();
  }

  for (const row of rows) {
    journal.appendAccepted({
      id: row.id,
      personId: row.person_id,
      connectionId: row.connection_id,
      reason: row.reason,
      requestedAt: row.requested_at.toISOString()
    });
    if (row.completed_at) {
      journal.appendCompleted({
        requestId: row.id,
        completedAt: row.completed_at.toISOString()
      });
    }
  }
  const completeThrough = cutoff.toISOString();
  journal.appendCheckpoint(completeThrough);
  await journal.createSealedCheckpoint(checkpointPath);

  const acceptedIds = rows.map((row) => row.id);
  const completedIds = rows.filter((row) => row.completed_at).map((row) => row.id);
  if (acceptedIds.length || completedIds.length) {
    const acknowledgement = await pool.connect();
    try {
      await acknowledgement.query("begin");
      if (acceptedIds.length) {
        await acknowledgement.query(
          `update recovery_erasure_requests
              set journal_accepted_at = coalesce(journal_accepted_at, now())
            where id = any($1::uuid[])`,
          [acceptedIds]
        );
      }
      if (completedIds.length) {
        await acknowledgement.query(
          `update recovery_erasure_requests
              set journal_completed_at = coalesce(journal_completed_at, now())
            where id = any($1::uuid[])`,
          [completedIds]
        );
      }
      await acknowledgement.query("commit");
    } catch (error) {
      await acknowledgement.query("rollback").catch(() => undefined);
      throw error;
    } finally {
      acknowledgement.release();
    }
  }

  return {
    completeThrough,
    acceptedCount: acceptedIds.length,
    completedCount: completedIds.length
  };
}

/** Verifies one sealed journal without opening or mutating PostgreSQL. */
export async function inspectRecoveryErasureJournal(
  journalPath: string,
  requiredThrough?: string
): Promise<VerifiedRecoveryErasureJournal> {
  const journal = await RecoveryErasureJournal.open(journalPath, { readOnly: true });
  try {
    return journal.verify(requiredThrough);
  } finally {
    journal.close();
  }
}

/** Replays every accepted erasure from a complete sealed journal into a restore. */
export async function applyRecoveryErasureJournal(
  repository: RecoveryRepository,
  journalPath: string,
  requiredThrough: string
): Promise<VerifiedRecoveryErasureJournal> {
  const verified = await inspectRecoveryErasureJournal(journalPath, requiredThrough);
  for (const marker of verified.accepted) {
    await repository.replayErasureMarker(marker);
  }
  return verified;
}
