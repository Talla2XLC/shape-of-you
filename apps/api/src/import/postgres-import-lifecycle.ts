import type { Pool, PoolClient } from "pg";

import type {
  DryRunAdapterResult,
  SafeApplyImportReport
} from "./contracts.js";

/** PostgreSQL hooks supplied by one typed domain adapter. */
export interface PostgresApplyAdapter<Snapshot, Target, Detail> {
  readonly domain: "weight" | "body" | "nutrition" | "training" | "recovery";
  /** Whether any conflict or invalid record blocks all fact creation. */
  readonly blockOnFindings?: boolean;
  readTarget(client: PoolClient, personId: string): Promise<readonly Target[]>;
  classify(snapshot: Snapshot, target: readonly Target[]): DryRunAdapterResult<Detail>;
  targetStateChecksum(target: readonly Target[]): string;
  createFacts(
    client: PoolClient,
    batchId: string,
    personId: string,
    snapshot: Snapshot,
    detail: Detail
  ): Promise<Detail>;
  persistAudit(
    client: PoolClient,
    batchId: string,
    personId: string,
    detail: Detail
  ): Promise<void>;
}

/** Shared atomic apply lifecycle used by every Fitness Tracker domain adapter. */
export class PostgresImportLifecycle {
  public constructor(private readonly pool: Pool) {}

  /** Locks, reclassifies, gates fact creation, and persists one relational batch. */
  public async apply<Snapshot, Target, Detail>(input: {
    readonly personId: string;
    readonly snapshot: Snapshot;
    readonly sourceSystem: string;
    readonly sourceContainerId: string;
    readonly sourceManifestChecksum: string;
    readonly adapter: PostgresApplyAdapter<Snapshot, Target, Detail>;
  }): Promise<SafeApplyImportReport> {
    const client = await this.pool.connect();
    try {
      await client.query("begin");
      await client.query("select pg_advisory_xact_lock(hashtextextended($1, 0))", [
        `${input.sourceSystem}:${input.adapter.domain}:${input.personId}`
      ]);
      const target = await input.adapter.readTarget(client, input.personId);
      const classified = input.adapter.classify(input.snapshot, target);
      const blocked = input.adapter.blockOnFindings !== false &&
        (classified.safeReport.counts.conflict > 0 ||
          classified.safeReport.counts.invalid > 0);
      const status = blocked ? "blocked" : "completed";
      const batchId = await insertBatch(client, {
        personId: input.personId,
        domain: input.adapter.domain,
        sourceSystem: input.sourceSystem,
        sourceContainerId: input.sourceContainerId,
        sourceManifestChecksum: input.sourceManifestChecksum,
        targetStateChecksum: input.adapter.targetStateChecksum(target),
        status,
        counts: classified.safeReport.counts
      });
      const detail = blocked
        ? classified.privateDetail
        : await input.adapter.createFacts(
            client,
            batchId,
            input.personId,
            input.snapshot,
            classified.privateDetail
          );
      await input.adapter.persistAudit(client, batchId, input.personId, detail);
      await client.query("commit");
      return {
        ...classified.safeReport,
        mode: "apply",
        batchId,
        status
      };
    } catch (error) {
      await client.query("rollback").catch(() => undefined);
      throw error;
    } finally {
      client.release();
    }
  }
}

async function insertBatch(
  client: PoolClient,
  input: {
    readonly personId: string;
    readonly domain: string;
    readonly sourceSystem: string;
    readonly sourceContainerId: string;
    readonly sourceManifestChecksum: string;
    readonly targetStateChecksum: string;
    readonly status: "completed" | "blocked";
    readonly counts: Readonly<Record<"created" | "unchanged" | "conflict" | "invalid", number>>;
  }
): Promise<string> {
  const result = await client.query<{ id: string }>(
    `insert into import_batches (
       person_id, domain, mode, source_system, source_container_id,
       source_manifest_checksum, target_state_checksum, status,
       created_count, unchanged_count, conflict_count, invalid_count,
       started_at, completed_at
     ) values ($1, $2, 'apply', $3, $4, $5, $6, $7,
       $8, $9, $10, $11, statement_timestamp(), statement_timestamp())
     on conflict (person_id, domain, mode, source_system, source_container_id,
       source_manifest_checksum, target_state_checksum)
     do update set source_manifest_checksum = excluded.source_manifest_checksum
     returning id`,
    [
      input.personId,
      input.domain,
      input.sourceSystem,
      input.sourceContainerId,
      input.sourceManifestChecksum,
      input.targetStateChecksum,
      input.status,
      input.counts.created,
      input.counts.unchanged,
      input.counts.conflict,
      input.counts.invalid
    ]
  );
  return result.rows[0]!.id;
}
