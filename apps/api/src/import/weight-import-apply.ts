import { createHash } from "node:crypto";

import type { Pool, PoolClient } from "pg";

import type { SafeApplyImportReport } from "./contracts.js";
import type { FitnessTrackerWeightSnapshot } from "./fitness-tracker-sheets-reader.js";
import { PostgresWeightTargetReader } from "./postgres-weight-target-reader.js";
import {
  PostgresImportLifecycle,
  type PostgresApplyAdapter
} from "./postgres-import-lifecycle.js";
import {
  WeightDryRunAdapter,
  type WeightDryRunPrivateDetail,
  type WeightImportAuditRecord,
  type WeightImportTarget
} from "./weight-dry-run.js";

/** Atomic Weight apply implementation behind the shared importer lifecycle. */
export class WeightImportApplyService {
  public constructor(
    private readonly pool: Pool,
    private readonly spreadsheetId: string,
    private readonly sheetId: number
  ) {}

  /** Reclassifies under lock, appends missing facts, and persists the full audit. */
  public async apply(
    personId: string,
    snapshot: FitnessTrackerWeightSnapshot
  ): Promise<SafeApplyImportReport> {
    const targetReader = new PostgresWeightTargetReader(
      this.pool,
      this.spreadsheetId,
      this.sheetId
    );
    const classifier = new WeightDryRunAdapter();
    const adapter: PostgresApplyAdapter<
      FitnessTrackerWeightSnapshot,
      WeightImportTarget,
      WeightDryRunPrivateDetail
    > = {
      domain: "weight",
      readTarget: (client, ownerId) => targetReader.readTargetWithClient(client, ownerId),
      classify: (source, target) => classifier.classify(source, target),
      targetStateChecksum: checksumTarget,
      createFacts: async (client, batchId, ownerId, source, detail) => {
        const targetIds = new Map<string, string>();
        for (const record of detail.records) {
          if (record.outcome !== "created" || record.role !== "authority") continue;
          const candidate = detail.candidates.find(
            (item) => item.locator === record.sourceLocator
          );
          if (!candidate) throw new Error("Created Weight finding has no typed candidate");
          const id = await createDateOnlyFact(client, {
            batchId,
            personId: ownerId,
            spreadsheetId: this.spreadsheetId,
            sheetId: this.sheetId,
            sourceKey: candidate.sourceIdentity.sourceKey,
            checksum: candidate.checksum,
            localDate: candidate.localDate,
            timezone: source.timeZone,
            weightKg: candidate.weightKg
          });
          targetIds.set(record.sourceLocator, id);
        }
        return {
          ...detail,
          records: detail.records.map((record) => ({
            ...record,
            targetMeasurementId:
              targetIds.get(record.sourceLocator) ?? record.targetMeasurementId
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

function checksumTarget(target: readonly WeightImportTarget[]): string {
  return digest([...target]
    .map((row) => ({
      id: row.id,
      identity: row.sourceIdentity,
      checksum: row.checksum,
      localDate: row.localDate,
      temporalPrecision: row.temporalPrecision,
      weightKg: row.weightKg
    }))
    .sort((left, right) => left.id.localeCompare(right.id)));
}

async function createDateOnlyFact(
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
    readonly weightKg: number;
  }
): Promise<string> {
  const externalSystem = `google_sheets:${input.spreadsheetId}:${input.sheetId}`;
  const source = await client.query<{ id: string }>(
    `insert into source_references (
       person_id, channel, external_system, external_record_id,
       import_batch_id, checksum, contains_sensitive_data
     ) values ($1, 'google_sheets', $2, $3, $4, $5, false)
     returning id`,
    [input.personId, externalSystem, input.sourceKey, input.batchId, input.checksum]
  );
  const dedupeKey = `fitness-tracker:weight:${digest({
    spreadsheetId: input.spreadsheetId,
    sheetId: input.sheetId,
    sourceKey: input.sourceKey
  })}`;
  const fact = await client.query<{ id: string }>(
    `insert into weight_measurements (
       person_id, measured_at, temporal_precision, local_date, timezone,
       weight_kg, source, source_reference_id, dedupe_key
     ) values ($1, null, 'local_date', $2, $3, $4, 'google_sheets', $5, $6)
     on conflict (person_id, source, dedupe_key) do nothing
     returning id`,
    [
      input.personId,
      input.localDate,
      input.timezone,
      input.weightKg.toFixed(3),
      source.rows[0]!.id,
      dedupeKey
    ]
  );
  if (fact.rows[0]) return fact.rows[0].id;
  await client.query("delete from source_references where id = $1", [source.rows[0]!.id]);
  const existing = await client.query<{ id: string }>(
    `select id from weight_measurements
      where person_id = $1 and source = 'google_sheets' and dedupe_key = $2`,
    [input.personId, dedupeKey]
  );
  if (!existing.rows[0]) throw new Error("Weight dedupe conflict could not be resolved");
  return existing.rows[0].id;
}

async function insertAuditRecords(
  client: PoolClient,
  batchId: string,
  personId: string,
  records: readonly WeightImportAuditRecord[]
): Promise<void> {
  for (const record of records) {
    await client.query(
      `insert into weight_import_records (
         batch_id, person_id, role, source_sheet_id, source_locator,
         source_local_date, source_checksum, normalized_local_date,
         normalized_weight_kg, outcome, finding_code, target_measurement_id
       ) values ($1, $2, $3, $4, $5, $6, $7, $8, $9, $10, $11, $12)
       on conflict (batch_id, role, source_locator, finding_code) do nothing`,
      [
        batchId,
        personId,
        record.role,
        record.sourceSheetId,
        record.sourceLocator,
        record.sourceLocalDate,
        record.sourceChecksum,
        record.normalizedLocalDate,
        record.normalizedWeightKg?.toFixed(3) ?? null,
        record.outcome,
        record.findingCode,
        record.targetMeasurementId
      ]
    );
  }
}

function digest(value: unknown): string {
  return createHash("sha256").update(JSON.stringify(value)).digest("hex");
}
