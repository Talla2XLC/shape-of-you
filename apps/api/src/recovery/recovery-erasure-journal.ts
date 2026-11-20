import { createHash, randomUUID } from "node:crypto";
import { chmod, lstat, open, rm } from "node:fs/promises";
import { backup, DatabaseSync } from "node:sqlite";
import { dirname } from "node:path";

import type { RecoveryErasureReason } from "@shape-of-you/contracts";

import { parseIntegrationCutoverRestorePolicy, type IntegrationCutoverRestorePolicy } from "./integration-cutover-restore-policy.js";

import type { RecoveryErasureMarker } from "../storage/recovery-repository.js";

const legacyHashVersion = 1;
const currentFormatVersion = 2;
const zeroHash = "0".repeat(64);
const uuidPattern = /^[0-9a-f]{8}-[0-9a-f]{4}-[1-5][0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/i;
const hashPattern = /^[0-9a-f]{64}$/;

interface JournalMetadataRow {
  readonly schema_version: number;
  readonly journal_id: string;
}

interface JournalRecordRow {
  readonly sequence: number;
  readonly record_kind: "accepted" | "completed" | "checkpoint" | "cutover";
  readonly request_id: string | null;
  readonly person_id: string | null;
  readonly connection_id: string | null;
  readonly reason: RecoveryErasureReason | null;
  readonly occurred_at: string | null;
  readonly complete_through: string | null;
  readonly recorded_at: string;
  readonly previous_hash: string;
  readonly record_hash: string;
  readonly cutover_policy?: string | null;
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
  readonly cutovers?: readonly IntegrationCutoverRestorePolicy[];
}

/** Exact immutable source prefix that an offline preparation command must revalidate under a writer barrier. */
export interface RecoveryErasureJournalHead {
  readonly journalId: string;
  readonly formatVersion: 1 | 2;
  readonly sequence: number;
  readonly headHash: string;
  readonly completeThrough: string;
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
    record.record_kind === "cutover" ? currentFormatVersion : legacyHashVersion,
    record.sequence,
    record.record_kind,
    record.request_id,
    record.person_id,
    record.connection_id,
    record.reason,
    record.occurred_at,
    record.complete_through,
    record.recorded_at,
    ...(record.record_kind === "cutover" ? [record.cutover_policy ?? null] : []),
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

function initialize(database: DatabaseSync, journalId: string, createdAt: string, formatVersion: 1 | 2): void {
  database.exec(`
    pragma foreign_keys = on;
    pragma journal_mode = delete;
    pragma synchronous = full;
    create table recovery_erasure_journal_metadata (
      singleton integer primary key check (singleton = 1),
      schema_version integer not null check (schema_version = ${formatVersion}),
      journal_id text not null check (length(journal_id) = 36),
      created_at text not null
    ) strict;
    create table recovery_erasure_journal_records (
      sequence integer primary key,
      record_kind text not null check (record_kind in ('accepted', 'completed', 'checkpoint'${formatVersion >= 2 ? ", 'cutover'" : ""})),
      request_id text,
      person_id text,
      connection_id text,
      reason text check (reason is null or reason in ('user_request', 'retention_expired')),
      occurred_at text,
      complete_through text,
      ${formatVersion >= 2 ? "cutover_policy text," : ""}
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
        ${formatVersion >= 2 ? `or (record_kind = 'cutover' and request_id is null and person_id is not null
          and connection_id is null and reason is null and occurred_at is null
          and complete_through is null and cutover_policy is not null)` : ""}
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
  ).run(formatVersion, journalId, createdAt);
}

/** Append-only typed journal for Recovery erasure intent and completion evidence. */
export class RecoveryErasureJournal implements Disposable {
  private constructor(
    private readonly database: DatabaseSync,
    public readonly path: string,
    public readonly journalId: string,
    private readonly clock: () => Date,
    public readonly formatVersion: 1 | 2 = currentFormatVersion
  ) {}

  /** Creates a new private journal and refuses to replace an existing path. */
  public static async create(
    path: string,
    clock: () => Date = () => new Date(),
    formatVersion: 1 | 2 = currentFormatVersion
  ): Promise<RecoveryErasureJournal> {
    const handle = await open(path, "wx", 0o600);
    await handle.close();
    const database = new DatabaseSync(path, { timeout: 5_000 });
    const journalId = randomUUID();
    try {
      initialize(database, journalId, clock().toISOString(), formatVersion);
      await chmod(path, 0o600);
      return new RecoveryErasureJournal(database, path, journalId, clock, formatVersion);
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
      if (!metadata || ![1, currentFormatVersion].includes(metadata.schema_version)) {
        throw new Error("Unsupported Recovery erasure journal schema version");
      }
      exactUuid(metadata.journal_id, "journalId");
      const journal = new RecoveryErasureJournal(
        database,
        path,
        metadata.journal_id,
        options.clock ?? (() => new Date()),
        metadata.schema_version as 1 | 2
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

  /** Appends bounded import authority; format-1 files require explicit offline preparation first. */
  public appendCutover(policy: IntegrationCutoverRestorePolicy): void {
    if (this.formatVersion < 2) throw new Error("Cutover restore authority requires an explicitly upgraded version-2 erasure journal");
    const parsed = parseIntegrationCutoverRestorePolicy(policy);
    const previous = this.verifyChain().filter((row) => row.record_kind === "cutover")
      .map((row) => parseIntegrationCutoverRestorePolicy(JSON.parse(row.cutover_policy!)))
      .filter((row) => row.id === parsed.id).at(-1);
    assertPolicyProgress(previous, parsed);
    this.append({ recordKind: "cutover", requestId: null, personId: parsed.personId,
      connectionId: null, reason: null, occurredAt: null, completeThrough: null, cutoverPolicy: JSON.stringify(parsed) });
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
    const cutovers = new Map<string, IntegrationCutoverRestorePolicy>();
    for (const record of records.filter((item) => item.record_kind === "cutover")) {
      const policy = parseIntegrationCutoverRestorePolicy(JSON.parse(record.cutover_policy!));
      assertPolicyProgress(cutovers.get(policy.id), policy);
      cutovers.set(policy.id, policy);
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
      ...(cutovers.size ? { cutovers: [...cutovers.values()] } : {}),
      completedRequestIds: records
        .filter((record) => record.record_kind === "completed")
        .map((record) => record.request_id!)
    };
  }

  /** Returns a verified source head without changing the journal or advancing completeness by wall clock. */
  public head(): RecoveryErasureJournalHead {
    const records = this.verifyChain();
    return { journalId: this.journalId, formatVersion: this.formatVersion,
      sequence: records.at(-1)?.sequence ?? 0, headHash: records.at(-1)?.record_hash ?? zeroHash,
      completeThrough: this.verify().completeThrough };
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
    readonly cutoverPolicy?: string;
  }): void {
    this.database.exec("begin immediate");
    try {
      const duplicate = input.requestId
        ? this.database.prepare(
            `select * from recovery_erasure_journal_records
              where request_id = ? and record_kind = ?`
          ).get(input.requestId, input.recordKind) as JournalRecordRow | undefined
        : input.recordKind === "cutover"
          ? this.database.prepare(`select * from recovery_erasure_journal_records where record_kind = 'cutover' and cutover_policy = ?`).get(input.cutoverPolicy!) as JournalRecordRow | undefined
          : this.database.prepare(
              `select * from recovery_erasure_journal_records
                where complete_through = ? and record_kind = 'checkpoint'`
            ).get(input.completeThrough) as JournalRecordRow | undefined;
      if (duplicate) {
        const same = duplicate.person_id === input.personId
          && duplicate.connection_id === input.connectionId
          && duplicate.reason === input.reason
          && duplicate.occurred_at === input.occurredAt
          && duplicate.complete_through === input.completeThrough
          && (duplicate.cutover_policy ?? null) === (input.cutoverPolicy ?? null);
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
        ...(this.formatVersion >= 2 ? { cutover_policy: input.cutoverPolicy ?? null } : {}),
        recorded_at: this.clock().toISOString(),
        previous_hash: previous?.record_hash ?? zeroHash
      };
      const hash = recordHash(recordWithoutHash);
      this.database.prepare(
        `insert into recovery_erasure_journal_records
          (sequence, record_kind, request_id, person_id, connection_id, reason,
           occurred_at, complete_through, recorded_at, previous_hash, record_hash${this.formatVersion >= 2 ? ", cutover_policy" : ""})
         values (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?${this.formatVersion >= 2 ? ", ?" : ""})`
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
        hash,
        ...(this.formatVersion >= 2 ? [recordWithoutHash.cutover_policy ?? null] : [])
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
      if (row.record_kind === "cutover") {
        if (this.formatVersion < 2 || !row.cutover_policy) throw new Error("Cutover journal record is invalid");
        const policy = parseIntegrationCutoverRestorePolicy(JSON.parse(row.cutover_policy));
        if (row.person_id !== policy.personId) throw new Error("Cutover journal Person mismatch");
      } else if (row.cutover_policy != null) throw new Error("Unexpected cutover journal payload");
      expectedPrevious = row.record_hash;
    }
    return rows;
  }
}

/** Verifies an existing private journal as input to explicit offline preparation. */
export async function inspectRecoveryErasureJournalHead(path: string): Promise<RecoveryErasureJournalHead> {
  const journal = await RecoveryErasureJournal.open(path, { readOnly: true });
  try { return journal.head(); } finally { journal.close(); }
}

/**
 * Prepares a separate v2 file and seal while preserving every v1 record and the journal identity.
 * The source is never altered or replaced. Actual replacement requires quiescing every old writer/handle
 * and revalidating the returned source head; this function performs no operational replacement.
 */
export async function prepareRecoveryErasureJournalV2(
  sourcePath: string,
  outputPath: string,
  checkpointPath: string,
  expected: RecoveryErasureJournalHead,
  durability: RecoveryErasureCheckpointDurability = checkpointDurability
): Promise<RecoveryErasureJournalHead> {
  if (sourcePath === outputPath || sourcePath === checkpointPath || outputPath === checkpointPath || expected.formatVersion !== 1) throw new Error("Offline upgrade requires distinct paths and a format-1 source");
  await assertPrivateRegularFile(sourcePath);
  await assertPrivateRecoveryErasureJournalDirectory(dirname(outputPath));
  const source = new DatabaseSync(sourcePath, { timeout: 5_000 });
  let created = false;
  let sealed = false;
  let target: DatabaseSync | undefined;
  try {
    source.exec("begin immediate");
    const sourceJournal = await RecoveryErasureJournal.open(sourcePath, { readOnly: true });
    let current: RecoveryErasureJournalHead;
    try { current = sourceJournal.head(); } finally { sourceJournal.close(); }
    if (current.journalId !== expected.journalId || current.formatVersion !== expected.formatVersion || current.sequence !== expected.sequence || current.headHash !== expected.headHash || current.completeThrough !== expected.completeThrough) throw new Error("Offline upgrade source head changed; prepare again from a fresh preview");
    const rows = source.prepare("select * from recovery_erasure_journal_records order by sequence").all() as unknown as JournalRecordRow[];
    const metadata = source.prepare("select created_at from recovery_erasure_journal_metadata where singleton=1").get() as { created_at: string };
    const handle = await open(outputPath, "wx", 0o600);
    await handle.close();
    created = true;
    target = new DatabaseSync(outputPath, { timeout: 5_000 });
    initialize(target, current.journalId, metadata.created_at, 2);
    target.exec("begin immediate");
    const insert = target.prepare(`insert into recovery_erasure_journal_records
      (sequence,record_kind,request_id,person_id,connection_id,reason,occurred_at,complete_through,recorded_at,previous_hash,record_hash,cutover_policy)
      values(?,?,?,?,?,?,?,?,?,?,?,null)`);
    for (const row of rows) insert.run(row.sequence,row.record_kind,row.request_id,row.person_id,row.connection_id,row.reason,row.occurred_at,row.complete_through,row.recorded_at,row.previous_hash,row.record_hash);
    target.exec("commit");
    target.close();
    target = undefined;
    const prepared = await RecoveryErasureJournal.open(outputPath);
    try {
      const transferred = prepared.head();
      if (transferred.journalId !== current.journalId || transferred.sequence !== current.sequence || transferred.headHash !== current.headHash || transferred.completeThrough !== current.completeThrough) throw new Error("Offline upgrade changed the legacy prefix");
      await durability.syncFile(outputPath);
      await durability.syncDirectory(dirname(outputPath));
      await prepared.createSealedCheckpoint(checkpointPath, durability);
      sealed = true;
    } finally { prepared.close(); }
    const finalHead = source.prepare("select sequence,record_hash from recovery_erasure_journal_records order by sequence desc limit 1").get() as { sequence: number; record_hash: string } | undefined;
    if ((finalHead?.sequence ?? 0) !== current.sequence || (finalHead?.record_hash ?? zeroHash) !== current.headHash) throw new Error("Offline upgrade source head changed while preparing");
    source.exec("commit");
    return current;
  } catch (error) {
    try { source.exec("rollback"); } catch { /* The source may not have entered its transaction. */ }
    target?.close();
    if (sealed) await rm(checkpointPath, { force: true });
    if (created) await rm(outputPath, { force: true });
    throw error;
  } finally { source.close(); }
}

function assertPolicyProgress(previous: IntegrationCutoverRestorePolicy | undefined, current: IntegrationCutoverRestorePolicy): void {
  if (!previous) return;
  if (current.personId !== previous.personId || current.version < previous.version || (current.version === previous.version && JSON.stringify(current) !== JSON.stringify(previous))) throw new Error("Cutover restore policy conflicts with prior journal authority");
  const immutable = (value: IntegrationCutoverRestorePolicy) => JSON.stringify([value.id,value.personId,value.sourceProvider,value.targetProvider,value.startsOn,value.timezone,value.startsAt,value.sourceDrainsUntil,value.capabilityVersion,[...value.acceptedCoverageGaps].sort()]);
  if (previous.activatedAt !== null && (current.activatedAt === null || immutable(previous) !== immutable(current))) throw new Error("Activated cutover journal authority cannot regress");
}
