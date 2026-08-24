import { createHash } from "node:crypto";

import type { Pool, PoolClient } from "pg";

import type { SafeApplyImportReport } from "./contracts.js";
import type { FitnessTrackerBodySnapshot } from "./fitness-tracker-sheets-reader.js";
import {
  BodyDryRunAdapter,
  type BodyDryRunPrivateDetail,
  type BodyImportAuditRecord,
  type BodyImportTarget
} from "./body-dry-run.js";
import { PostgresBodyTargetReader } from "./postgres-body-target-reader.js";
import {
  PostgresImportLifecycle,
  type PostgresApplyAdapter
} from "./postgres-import-lifecycle.js";

/** Atomic Body apply implementation behind the shared importer lifecycle. */
export class BodyImportApplyService {
  public constructor(
    private readonly pool: Pool,
    private readonly spreadsheetId: string,
    private readonly sheetId: number
  ) {}

  /** Reclassifies under lock, appends missing Body aggregates, and persists audit. */
  public async apply(
    personId: string,
    snapshot: FitnessTrackerBodySnapshot
  ): Promise<SafeApplyImportReport> {
    const targetReader = new PostgresBodyTargetReader(
      this.pool,
      this.spreadsheetId,
      this.sheetId
    );
    const classifier = new BodyDryRunAdapter();
    const adapter: PostgresApplyAdapter<
      FitnessTrackerBodySnapshot,
      BodyImportTarget,
      BodyDryRunPrivateDetail
    > = {
      domain: "body",
      readTarget: (client, ownerId) =>
        targetReader.readTargetWithClient(client, ownerId),
      classify: (source, target) => classifier.classify(source, target),
      targetStateChecksum: checksumTarget,
      createFacts: async (client, batchId, ownerId, source, detail) => {
        const targetIds = new Map<string, string>();
        for (const record of detail.records) {
          if (record.outcome !== "created") continue;
          const candidate = detail.candidates.find(
            ({ locator }) => locator === record.sourceLocator
          );
          if (!candidate) throw new Error("Created Body finding has no typed candidate");
          const id = await createDateOnlySession(client, {
            batchId,
            personId: ownerId,
            spreadsheetId: this.spreadsheetId,
            sheetId: this.sheetId,
            sourceKey: candidate.sourceIdentity.sourceKey,
            checksum: candidate.checksum,
            localDate: candidate.localDate,
            timezone: source.timeZone,
            values: candidate.values,
            note: candidate.note
          });
          targetIds.set(record.sourceLocator, id);
        }
        return {
          ...detail,
          records: detail.records.map((record) => ({
            ...record,
            targetSessionId:
              targetIds.get(record.sourceLocator) ?? record.targetSessionId
          }))
        };
      },
      persistAudit: (client, batchId, ownerId, detail) =>
        insertAuditRecords(client, batchId, ownerId, detail.records)
    };
    return new PostgresImportLifecycle(this.pool).apply({
      personId,
      snapshot,
      sourceSystem: "google_sheets",
      sourceContainerId: this.spreadsheetId,
      sourceManifestChecksum: snapshot.manifestChecksum,
      adapter
    });
  }
}

function checksumTarget(target: readonly BodyImportTarget[]): string {
  return digest([...target]
    .map((row) => ({
      id: row.id,
      identity: row.sourceIdentity,
      checksum: row.checksum,
      localDate: row.localDate,
      temporalPrecision: row.temporalPrecision,
      values: [...row.values].sort((left, right) => left.metric.localeCompare(right.metric)),
      note: row.note
    }))
    .sort((left, right) => left.id.localeCompare(right.id)));
}

async function createDateOnlySession(
  client: PoolClient,
  input: {
    readonly batchId: string;
    readonly personId: string;
    readonly spreadsheetId: string;
    readonly sheetId: number;
    readonly sourceKey: string;
    readonly checksum: string;
    readonly localDate: string;
    readonly timezone: string;
    readonly values: BodyImportTarget["values"];
    readonly note: string | null;
  }
): Promise<string> {
  const externalSystem = `google_sheets:${input.spreadsheetId}:${input.sheetId}`;
  const source = await client.query<{ id: string }>(
    `insert into source_references (
       person_id, channel, external_system, external_record_id,
       import_batch_id, checksum, contains_sensitive_data
     ) values ($1, 'google_sheets', $2, $3, $4, $5, true)
     returning id`,
    [input.personId, externalSystem, input.sourceKey, input.batchId, input.checksum]
  );
  const dedupeKey = `fitness-tracker:body:${digest({
    spreadsheetId: input.spreadsheetId,
    sheetId: input.sheetId,
    sourceKey: input.sourceKey
  })}`;
  const fact = await client.query<{ id: string }>(
    `insert into body_measurement_sessions (
       person_id, measured_at, temporal_precision, local_date, timezone,
       source, source_reference_id, dedupe_key, note
     ) values ($1, null, 'local_date', $2, $3, 'google_sheets', $4, $5, $6)
     on conflict (person_id, source, dedupe_key) do nothing
     returning id`,
    [
      input.personId,
      input.localDate,
      input.timezone,
      source.rows[0]!.id,
      dedupeKey,
      input.note
    ]
  );
  if (!fact.rows[0]) {
    await client.query("delete from source_references where id = $1", [source.rows[0]!.id]);
    const existing = await client.query<{ id: string }>(
      `select id from body_measurement_sessions
        where person_id = $1 and source = 'google_sheets' and dedupe_key = $2`,
      [input.personId, dedupeKey]
    );
    if (!existing.rows[0]) throw new Error("Body dedupe conflict could not be resolved");
    return existing.rows[0].id;
  }
  for (const value of input.values) {
    await client.query(
      `insert into body_measurement_values (session_id, metric, value, unit)
       values ($1, $2, $3, 'cm')`,
      [fact.rows[0].id, value.metric, value.value.toFixed(2)]
    );
  }
  return fact.rows[0].id;
}

async function insertAuditRecords(
  client: PoolClient,
  batchId: string,
  personId: string,
  records: readonly BodyImportAuditRecord[]
): Promise<void> {
  for (const record of records) {
    const inserted = await client.query<{ id: string }>(
      `insert into body_import_records (
         batch_id, person_id, source_sheet_id, source_locator,
         source_measurement_id, source_local_date, source_checksum,
         normalized_local_date, normalized_note, normalized_source,
         outcome, finding_code, target_session_id
       ) values ($1, $2, $3, $4, $5, $6, $7, $8, $9, $10, $11, $12, $13)
       on conflict (batch_id, source_locator, finding_code) do nothing
       returning id`,
      [
        batchId,
        personId,
        record.sourceSheetId,
        record.sourceLocator,
        record.sourceMeasurementId,
        record.sourceLocalDate,
        record.sourceChecksum,
        record.normalizedLocalDate,
        record.normalizedNote,
        record.normalizedSource,
        record.outcome,
        record.findingCode,
        record.targetSessionId
      ]
    );
    if (!inserted.rows[0]) continue;
    for (const value of record.values) {
      await client.query(
        `insert into body_import_record_values (record_id, metric, value, unit)
         values ($1, $2, $3, 'cm')`,
        [inserted.rows[0].id, value.metric, value.value.toFixed(2)]
      );
    }
  }
}

function digest(value: unknown): string {
  return createHash("sha256").update(JSON.stringify(value)).digest("hex");
}
