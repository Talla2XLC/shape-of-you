import { createHash, randomUUID } from "node:crypto";
import { chmod, lstat, open, rm } from "node:fs/promises";
import { backup, DatabaseSync } from "node:sqlite";
import { dirname } from "node:path";

import type { RecoveryErasureReason } from "@shape-of-you/contracts";

import type { RecoveryErasureMarker } from "../storage/recovery-repository.js";

const schemaVersion = 1;
const zeroHash = "0".repeat(64);
const uuidPattern = /^[0-9a-f]{8}-[0-9a-f]{4}-[1-5][0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/i;
const hashPattern = /^[0-9a-f]{64}$/;

interface JournalMetadataRow {
  readonly schema_version: number;
  readonly journal_id: string;
}

interface JournalRecordRow {
  readonly sequence: number;
  readonly record_kind: "accepted" | "completed" | "checkpoint";
  readonly request_id: string | null;
  readonly person_id: string | null;
  readonly connection_id: string | null;
  readonly reason: RecoveryErasureReason | null;
  readonly occurred_at: string | null;
  readonly complete_through: string | null;
  readonly recorded_at: string;
  readonly previous_hash: string;
  readonly record_hash: string;
}

/** Typed completion evidence appended after one Recovery connection graph is erased. */
export interface RecoveryErasureCompletion {
  readonly requestId: string;
  readonly completedAt: string;
}

/** Verified journal contents safe to use as restore suppression authority. */
export interface VerifiedRecoveryErasureJournal {
  readonly journalId: string;
  readonly completeThrough: string;
  readonly accepted: readonly RecoveryErasureMarker[];
  readonly completedRequestIds: readonly string[];
}

function exactUuid(value: string, name: string): string {
  if (!uuidPattern.test(value)) throw new Error(`${name} must be a UUID`);
  return value;
}

function exactDate(value: string, name: string): string {
  const parsed = new Date(value);
  if (Number.isNaN(parsed.valueOf()) || parsed.toISOString() !== value) {
    throw new Error(`${name} must be a canonical ISO date-time`);
  }
  return value;
}

function canonicalField(value: string | number | null): string {
  const normalized = value === null ? "" : String(value);
  return `${Buffer.byteLength(normalized, "utf8")}:${normalized}`;
}

function recordHash(record: Omit<JournalRecordRow, "record_hash">): string {
  const canonical = [
    schemaVersion,
    record.sequence,
    record.record_kind,
    record.request_id,
    record.person_id,
    record.connection_id,
    record.reason,
    record.occurred_at,
    record.complete_through,
    record.recorded_at,
    record.previous_hash
  ].map(canonicalField).join("|");
  return createHash("sha256").update(canonical).digest("hex");
}

async function assertPrivateRegularFile(path: string): Promise<void> {
  const metadata = await lstat(path);
  if (metadata.isSymbolicLink() || !metadata.isFile() || (metadata.mode & 0o077) !== 0) {
    throw new Error("Recovery erasure journal must be a regular mode-0600 file");
  }
}

/** Verifies that a journal directory is private, real, and safe for new files. */
export async function assertPrivateRecoveryErasureJournalDirectory(
  path: string
): Promise<void> {
  const metadata = await lstat(path);
  if (metadata.isSymbolicLink() || !metadata.isDirectory() || (metadata.mode & 0o077) !== 0) {
    throw new Error("Recovery erasure journal directory must be a real mode-0700 directory");
  }
}

/** Injectable durability boundary used before a checkpoint can be acknowledged. */
export interface RecoveryErasureCheckpointDurability {
  /** Flushes all checkpoint file data and metadata to durable storage. */
  readonly syncFile: (path: string) => Promise<void>;
  /** Flushes the checkpoint directory entry to durable storage. */
  readonly syncDirectory: (path: string) => Promise<void>;
}

async function syncPath(path: string): Promise<void> {
  const handle = await open(path, "r");
  try {
    await handle.sync();
  } finally {
    await handle.close();
  }
}

const checkpointDurability: RecoveryErasureCheckpointDurability = {
  syncFile: syncPath,
  syncDirectory: syncPath
};

function initialize(database: DatabaseSync, journalId: string, createdAt: string): void {
  database.exec(`
    pragma foreign_keys = on;
    pragma journal_mode = delete;
    pragma synchronous = full;
    create table recovery_erasure_journal_metadata (
      singleton integer primary key check (singleton = 1),
      schema_version integer not null check (schema_version = 1),
      journal_id text not null check (length(journal_id) = 36),
      created_at text not null
    ) strict;
    create table recovery_erasure_journal_records (
      sequence integer primary key,
      record_kind text not null check (record_kind in ('accepted', 'completed', 'checkpoint')),
      request_id text,
      person_id text,
      connection_id text,
      reason text check (reason is null or reason in ('user_request', 'retention_expired')),
      occurred_at text,
      complete_through text,
      recorded_at text not null,
      previous_hash text not null check (length(previous_hash) = 64),
      record_hash text not null unique check (length(record_hash) = 64),
      check (
        (record_kind = 'accepted' and request_id is not null and person_id is not null
          and connection_id is not null and reason is not null and occurred_at is not null
          and complete_through is null)
        or (record_kind = 'completed' and request_id is not null and person_id is null
          and connection_id is null and reason is null and occurred_at is not null
          and complete_through is null)
        or (record_kind = 'checkpoint' and request_id is null and person_id is null
          and connection_id is null and reason is null and occurred_at is null
          and complete_through is not null)
      )
    ) strict;
    create unique index recovery_erasure_journal_request_kind_uq
      on recovery_erasure_journal_records (request_id, record_kind)
      where request_id is not null;
    create unique index recovery_erasure_journal_checkpoint_uq
      on recovery_erasure_journal_records (complete_through)
      where record_kind = 'checkpoint';
    create trigger recovery_erasure_journal_metadata_no_update
      before update on recovery_erasure_journal_metadata begin
        select raise(abort, 'Recovery erasure journal metadata is immutable');
      end;
    create trigger recovery_erasure_journal_metadata_no_delete
      before delete on recovery_erasure_journal_metadata begin
        select raise(abort, 'Recovery erasure journal metadata is immutable');
      end;
    create trigger recovery_erasure_journal_records_no_update
      before update on recovery_erasure_journal_records begin
        select raise(abort, 'Recovery erasure journal records are append-only');
      end;
    create trigger recovery_erasure_journal_records_no_delete
      before delete on recovery_erasure_journal_records begin
        select raise(abort, 'Recovery erasure journal records are append-only');
      end;
  `);
  database.prepare(
    `insert into recovery_erasure_journal_metadata
       (singleton, schema_version, journal_id, created_at)
     values (1, ?, ?, ?)`
  ).run(schemaVersion, journalId, createdAt);
}

/** Append-only typed journal for Recovery erasure intent and completion evidence. */
export class RecoveryErasureJournal implements Disposable {
  private constructor(
    private readonly database: DatabaseSync,
    public readonly path: string,
    public readonly journalId: string,
    private readonly clock: () => Date
  ) {}

  /** Creates a new private journal and refuses to replace an existing path. */
  public static async create(
    path: string,
    clock: () => Date = () => new Date()
  ): Promise<RecoveryErasureJournal> {
    const handle = await open(path, "wx", 0o600);
    await handle.close();
    const database = new DatabaseSync(path, { timeout: 5_000 });
    const journalId = randomUUID();
    try {
      initialize(database, journalId, clock().toISOString());
      await chmod(path, 0o600);
      return new RecoveryErasureJournal(database, path, journalId, clock);
    } catch (error) {
      database.close();
      await rm(path, { force: true });
      throw error;
    }
  }

  /** Opens and fully verifies an existing private journal. */
  public static async open(
    path: string,
    options: { readonly readOnly?: boolean; readonly clock?: () => Date } = {}
  ): Promise<RecoveryErasureJournal> {
    await assertPrivateRegularFile(path);
    const database = new DatabaseSync(path, {
      readOnly: options.readOnly ?? false,
      timeout: 5_000
    });
    try {
      const metadata = database.prepare(
        `select schema_version, journal_id
           from recovery_erasure_journal_metadata
          where singleton = 1`
      ).get() as JournalMetadataRow | undefined;
      if (!metadata || metadata.schema_version !== schemaVersion) {
        throw new Error("Unsupported Recovery erasure journal schema version");
      }
      exactUuid(metadata.journal_id, "journalId");
      const journal = new RecoveryErasureJournal(
        database,
        path,
        metadata.journal_id,
        options.clock ?? (() => new Date())
      );
      journal.verifyChain();
      return journal;
    } catch (error) {
      database.close();
      throw error;
    }
  }

  /** Appends restore-authoritative accepted intent idempotently. */
  public appendAccepted(marker: RecoveryErasureMarker): void {
    exactUuid(marker.id, "marker.id");
    exactUuid(marker.personId, "marker.personId");
    exactUuid(marker.connectionId, "marker.connectionId");
    exactDate(marker.requestedAt, "marker.requestedAt");
    this.append({
      recordKind: "accepted",
      requestId: marker.id,
      personId: marker.personId,
      connectionId: marker.connectionId,
      reason: marker.reason,
      occurredAt: marker.requestedAt,
      completeThrough: null
    });
  }

  /** Appends completion evidence idempotently after physical graph deletion. */
  public appendCompleted(completion: RecoveryErasureCompletion): void {
    exactUuid(completion.requestId, "completion.requestId");
    exactDate(completion.completedAt, "completion.completedAt");
    const accepted = this.database.prepare(
      `select sequence from recovery_erasure_journal_records
        where request_id = ? and record_kind = 'accepted'`
    ).get(completion.requestId);
    if (!accepted) throw new Error("Recovery erasure completion requires accepted intent");
    this.append({
      recordKind: "completed",
      requestId: completion.requestId,
      personId: null,
      connectionId: null,
      reason: null,
      occurredAt: completion.completedAt,
      completeThrough: null
    });
  }

  /** Appends a completeness boundary covering the source snapshot through one instant. */
  public appendCheckpoint(completeThrough: string): void {
    exactDate(completeThrough, "completeThrough");
    this.append({
      recordKind: "checkpoint",
      requestId: null,
      personId: null,
      connectionId: null,
      reason: null,
      occurredAt: null,
      completeThrough
    });
  }

  /**
   * Creates and durably publishes a new mode-0600 SQLite backup.
   *
   * @param outputPath - New checkpoint path; an existing path is never replaced.
   * @param durability - File and directory flush boundary, injectable for fault tests.
   */
  public async createSealedCheckpoint(
    outputPath: string,
    durability: RecoveryErasureCheckpointDurability = checkpointDurability
  ): Promise<void> {
    this.verifyChain();
    const outputDirectory = dirname(outputPath);
    await assertPrivateRecoveryErasureJournalDirectory(outputDirectory);
    const handle = await open(outputPath, "wx", 0o600);
    await handle.close();
    try {
      await backup(this.database, outputPath);
      await chmod(outputPath, 0o600);
      await durability.syncFile(outputPath);
      await durability.syncDirectory(outputDirectory);
      const checkpoint = await RecoveryErasureJournal.open(outputPath, { readOnly: true });
      try {
        checkpoint.verify();
      } finally {
        checkpoint.close();
      }
    } catch (error) {
      await rm(outputPath, { force: true });
      throw error;
    }
  }

  /** Verifies integrity and returns restore-authoritative accepted markers. */
  public verify(requiredThrough?: string): VerifiedRecoveryErasureJournal {
    const records = this.verifyChain();
    const checkpoints = records.filter((record) => record.record_kind === "checkpoint");
    const lastCheckpoint = checkpoints.at(-1);
    if (!lastCheckpoint?.complete_through) {
      throw new Error("Recovery erasure journal has no completeness checkpoint");
    }
    if (requiredThrough) {
      const required = exactDate(requiredThrough, "requiredThrough");
      if (lastCheckpoint.complete_through < required) {
        throw new Error("Recovery erasure journal is incomplete for the required restore boundary");
      }
    }
    return {
      journalId: this.journalId,
      completeThrough: lastCheckpoint.complete_through,
      accepted: records
        .filter((record) => record.record_kind === "accepted")
        .map((record) => ({
          id: record.request_id!,
          personId: record.person_id!,
          connectionId: record.connection_id!,
          reason: record.reason!,
          requestedAt: record.occurred_at!
        })),
      completedRequestIds: records
        .filter((record) => record.record_kind === "completed")
        .map((record) => record.request_id!)
    };
  }

  /** Closes the SQLite handle owned by this journal. */
  public close(): void {
    this.database.close();
  }

  public [Symbol.dispose](): void {
    this.close();
  }

  private append(input: {
    readonly recordKind: JournalRecordRow["record_kind"];
    readonly requestId: string | null;
    readonly personId: string | null;
    readonly connectionId: string | null;
    readonly reason: RecoveryErasureReason | null;
    readonly occurredAt: string | null;
    readonly completeThrough: string | null;
  }): void {
    this.database.exec("begin immediate");
    try {
      const duplicate = input.requestId
        ? this.database.prepare(
            `select * from recovery_erasure_journal_records
              where request_id = ? and record_kind = ?`
          ).get(input.requestId, input.recordKind) as JournalRecordRow | undefined
        : this.database.prepare(
            `select * from recovery_erasure_journal_records
              where complete_through = ? and record_kind = 'checkpoint'`
          ).get(input.completeThrough) as JournalRecordRow | undefined;
      if (duplicate) {
        const same = duplicate.person_id === input.personId
          && duplicate.connection_id === input.connectionId
          && duplicate.reason === input.reason
          && duplicate.occurred_at === input.occurredAt
          && duplicate.complete_through === input.completeThrough;
        if (!same) throw new Error("Recovery erasure journal event conflicts with prior evidence");
        this.database.exec("commit");
        return;
      }
      const previous = this.database.prepare(
        `select sequence, record_hash from recovery_erasure_journal_records
          order by sequence desc limit 1`
      ).get() as { readonly sequence: number; readonly record_hash: string } | undefined;
      const recordWithoutHash: Omit<JournalRecordRow, "record_hash"> = {
        sequence: (previous?.sequence ?? 0) + 1,
        record_kind: input.recordKind,
        request_id: input.requestId,
        person_id: input.personId,
        connection_id: input.connectionId,
        reason: input.reason,
        occurred_at: input.occurredAt,
        complete_through: input.completeThrough,
        recorded_at: this.clock().toISOString(),
        previous_hash: previous?.record_hash ?? zeroHash
      };
      const hash = recordHash(recordWithoutHash);
      this.database.prepare(
        `insert into recovery_erasure_journal_records
          (sequence, record_kind, request_id, person_id, connection_id, reason,
           occurred_at, complete_through, recorded_at, previous_hash, record_hash)
         values (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)`
      ).run(
        recordWithoutHash.sequence,
        recordWithoutHash.record_kind,
        recordWithoutHash.request_id,
        recordWithoutHash.person_id,
        recordWithoutHash.connection_id,
        recordWithoutHash.reason,
        recordWithoutHash.occurred_at,
        recordWithoutHash.complete_through,
        recordWithoutHash.recorded_at,
        recordWithoutHash.previous_hash,
        hash
      );
      this.database.exec("commit");
    } catch (error) {
      this.database.exec("rollback");
      throw error;
    }
  }

  private verifyChain(): readonly JournalRecordRow[] {
    const rows = this.database.prepare(
      "select * from recovery_erasure_journal_records order by sequence"
    ).all() as unknown as JournalRecordRow[];
    let expectedPrevious = zeroHash;
    for (const [index, row] of rows.entries()) {
      if (row.sequence !== index + 1 || row.previous_hash !== expectedPrevious) {
        throw new Error("Recovery erasure journal sequence or hash chain is invalid");
      }
      if (!hashPattern.test(row.record_hash) || recordHash(row) !== row.record_hash) {
        throw new Error("Recovery erasure journal integrity check failed");
      }
      exactDate(row.recorded_at, `record[${row.sequence}].recordedAt`);
      if (row.request_id) exactUuid(row.request_id, `record[${row.sequence}].requestId`);
      if (row.person_id) exactUuid(row.person_id, `record[${row.sequence}].personId`);
      if (row.connection_id) exactUuid(row.connection_id, `record[${row.sequence}].connectionId`);
      if (row.occurred_at) exactDate(row.occurred_at, `record[${row.sequence}].occurredAt`);
      if (row.complete_through) exactDate(row.complete_through, `record[${row.sequence}].completeThrough`);
      expectedPrevious = row.record_hash;
    }
    return rows;
  }
}
