import type { Pool } from "pg";

import type { RecoveryErasureReason } from "@shape-of-you/contracts";

import type { RecoveryRepository } from "../storage/recovery-repository.js";
import {
  RecoveryErasureJournal,
  type RecoveryErasureCheckpointDurability,
  type VerifiedRecoveryErasureJournal
} from "./recovery-erasure-journal.js";

interface SourceErasureRow {
  readonly id: string;
  readonly person_id: string;
  readonly connection_id: string;
  readonly reason: RecoveryErasureReason;
  readonly requested_at: Date;
  readonly completed_at: Date | null;
  readonly journal_accepted_at: Date | null;
  readonly journal_completed_at: Date | null;
}

const journalLockNamespace = 1_397_704_326;
const journalLockKey = 100;

/** Result of sealing one complete PostgreSQL erasure snapshot into the journal. */
export interface RecoveryErasureJournalSyncResult {
  readonly completeThrough: string;
  readonly acceptedCount: number;
  readonly completedCount: number;
  readonly checkpointCreated: boolean;
}

/** Controls whether synchronization may seal a completeness-only checkpoint. */
export interface RecoveryErasureJournalSyncOptions {
  /** When true, skip checkpoint creation unless PostgreSQL has pending acknowledgements. */
  readonly onlyIfPending?: boolean;
  /** Testable durability boundary applied before PostgreSQL acknowledgement. */
  readonly checkpointDurability?: RecoveryErasureCheckpointDurability;
}

/**
 * Copies all erasure state through one repeatable-read cutoff into SQLite, seals
 * a new checkpoint, and only then acknowledges journal durability in PostgreSQL.
 */
export async function synchronizeRecoveryErasureJournal(
  pool: Pool,
  journalPath: string,
  checkpointPath: string,
  options: RecoveryErasureJournalSyncOptions = {}
): Promise<RecoveryErasureJournalSyncResult> {
  const client = await pool.connect();
  let locked = false;
  let journal: RecoveryErasureJournal | undefined;
  let cutoff: Date;
  let rows: readonly SourceErasureRow[];
  try {
    const lockResult = await client.query<{ acquired: boolean }>(
      "select pg_try_advisory_lock($1, $2) as acquired",
      [journalLockNamespace, journalLockKey]
    );
    locked = lockResult.rows[0]?.acquired === true;
    if (!locked) {
      throw new Error("Recovery erasure journal synchronization is already running");
    }
    journal = await RecoveryErasureJournal.open(journalPath);

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
        `select id, person_id, connection_id, reason, requested_at, completed_at,
                journal_accepted_at, journal_completed_at
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
    }

    const acceptedIds = rows
      .filter((row) => row.journal_accepted_at === null)
      .map((row) => row.id);
    const completedIds = rows
      .filter((row) => row.completed_at !== null && row.journal_completed_at === null)
      .map((row) => row.id);
    const completeThrough = cutoff.toISOString();
    if (options.onlyIfPending && acceptedIds.length === 0 && completedIds.length === 0) {
      return {
        completeThrough,
        acceptedCount: 0,
        completedCount: 0,
        checkpointCreated: false
      };
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
    journal.appendCheckpoint(completeThrough);
    await journal.createSealedCheckpoint(checkpointPath, options.checkpointDurability);

    if (acceptedIds.length === 0 && completedIds.length === 0) {
      return {
        completeThrough,
        acceptedCount: 0,
        completedCount: 0,
        checkpointCreated: true
      };
    }

    try {
      await client.query("begin");
      if (acceptedIds.length) {
        await client.query(
          `update recovery_erasure_requests
              set journal_accepted_at = coalesce(journal_accepted_at, now())
            where id = any($1::uuid[])`,
          [acceptedIds]
        );
      }
      if (completedIds.length) {
        await client.query(
          `update recovery_erasure_requests
              set journal_completed_at = coalesce(journal_completed_at, now())
            where id = any($1::uuid[])`,
          [completedIds]
        );
      }
      await client.query("commit");
    } catch (error) {
      await client.query("rollback").catch(() => undefined);
      throw error;
    }

    return {
      completeThrough,
      acceptedCount: acceptedIds.length,
      completedCount: completedIds.length,
      checkpointCreated: true
    };
  } finally {
    try {
      journal?.close();
    } finally {
      if (locked) {
        await client.query(
          "select pg_advisory_unlock($1, $2)",
          [journalLockNamespace, journalLockKey]
        ).catch(() => undefined);
      }
      client.release();
    }
  }
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
