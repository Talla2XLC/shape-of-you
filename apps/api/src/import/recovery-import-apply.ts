import { createHash } from "node:crypto";

import type { RecoveryObservationDetail } from "@shape-of-you/contracts";
import type { Pool, PoolClient } from "pg";

import type { SafeApplyImportReport } from "./contracts.js";
import type { FitnessTrackerRecoverySnapshot } from "./fitness-tracker-sheets-reader.js";
import { PostgresImportLifecycle, type PostgresApplyAdapter } from "./postgres-import-lifecycle.js";
import { PostgresRecoveryTargetReader } from "./postgres-recovery-target-reader.js";
import { RecoveryDryRunAdapter, type RecoveryDryRunPrivateDetail, type RecoveryImportAuditRecord, type RecoveryImportCandidate, type RecoveryImportTarget } from "./recovery-dry-run.js";

/** Transactional raw Recovery apply implementation behind the shared importer lifecycle. */
export class RecoveryImportApplyService {
  public constructor(private readonly pool: Pool, private readonly spreadsheetId: string, private readonly sheetId: number) {}

  public apply(personId: string, snapshot: FitnessTrackerRecoverySnapshot): Promise<SafeApplyImportReport> {
    const targetReader = new PostgresRecoveryTargetReader(this.pool, this.spreadsheetId, this.sheetId);
    const classifier = new RecoveryDryRunAdapter();
    const adapter: PostgresApplyAdapter<FitnessTrackerRecoverySnapshot, RecoveryImportTarget, RecoveryDryRunPrivateDetail> = {
      domain: "recovery",
      blockOnFindings: false,
      readTarget: (client, ownerId) => targetReader.readTargetWithClient(client, ownerId),
      classify: (source, target) => classifier.classify(source, target),
      targetStateChecksum: (target) => digest(target),
      createFacts: async (client, batchId, ownerId, source, detail) => {
        const created = new Map<string, string>();
        for (const record of detail.records) {
          if (record.outcome !== "created" || !record.sourceKey) continue;
          const candidate = detail.candidates.find(({ sourceIdentity }) => sourceIdentity.sourceKey === record.sourceKey);
          if (!candidate) throw new Error("Created Recovery finding has no candidate");
          created.set(record.sourceKey, await createObservation(client, batchId, ownerId, source.timeZone, candidate));
        }
        return { ...detail, records: detail.records.map((record) => ({ ...record, targetObservationId: record.sourceKey ? created.get(record.sourceKey) ?? record.targetObservationId : record.targetObservationId })) };
      },
      persistAudit: (client, batchId, ownerId, detail) => insertAudit(client, batchId, ownerId, detail.records)
    };
    return new PostgresImportLifecycle(this.pool).apply({ personId, snapshot, sourceSystem: "google_sheets", sourceContainerId: this.spreadsheetId, sourceManifestChecksum: snapshot.manifestChecksum, adapter });
  }
}

async function createObservation(client: PoolClient, batchId: string, personId: string, timezone: string, candidate: RecoveryImportCandidate): Promise<string> {
  const externalSystem = `google_sheets:${candidate.sourceIdentity.spreadsheetId}:${candidate.sourceIdentity.sheetId}`;
  const source = await client.query<{ id: string }>(
    `insert into source_references (person_id, channel, external_system, external_record_id, import_batch_id, checksum, contains_sensitive_data)
     values ($1, 'google_sheets', $2, $3, $4, $5, true) returning id`,
    [personId, externalSystem, candidate.sourceIdentity.sourceKey, batchId, candidate.checksum]
  );
  const dedupeKey = `fitness-tracker:recovery:${digest(candidate.sourceIdentity)}`;
  const observation = await client.query<{ id: string }>(
    `insert into recovery_observations (person_id, kind, observed_from, observed_until, temporal_precision, local_date, timezone, quality, source, source_reference_id, connection_id, consent_id, dedupe_key)
     values ($1, $2, null, null, 'local_date', $3, $4, 'reliable', 'google_sheets', $5, null, null, $6)
     on conflict (person_id, source, dedupe_key) do nothing returning id`,
    [personId, candidate.detail.type, candidate.localDate, timezone, source.rows[0]!.id, dedupeKey]
  );
  if (!observation.rows[0]) {
    await client.query("delete from source_references where id = $1", [source.rows[0]!.id]);
    const existing = await client.query<{ id: string }>("select id from recovery_observations where person_id = $1 and source = 'google_sheets' and dedupe_key = $2", [personId, dedupeKey]);
    if (!existing.rows[0]) throw new Error("Recovery dedupe conflict could not be resolved");
    return existing.rows[0].id;
  }
  await insertDetail(client, observation.rows[0].id, candidate.detail);
  return observation.rows[0].id;
}

async function insertDetail(client: PoolClient, observationId: string, detail: RecoveryObservationDetail): Promise<void> {
  if (detail.type === "sleep") {
    await client.query(
      `insert into recovery_sleep_details (observation_id, total_sleep_minutes, deep_sleep_minutes, rem_sleep_minutes, light_sleep_minutes, sleep_quality)
       values ($1,$2,$3,$4,$5,$6)`,
      [observationId, detail.totalSleepMinutes, detail.deepSleepMinutes ?? null, detail.remSleepMinutes ?? null, detail.lightSleepMinutes ?? null, detail.sleepQuality]
    );
  } else if (detail.type === "metric") {
    await client.query("insert into recovery_metric_details (observation_id, metric, value, unit) values ($1,$2,$3,$4)", [observationId, detail.metric, detail.value, detail.unit]);
  } else {
    throw new Error("Fitness Tracker Recovery import does not create subjective observations");
  }
}

async function insertAudit(client: PoolClient, batchId: string, personId: string, records: readonly RecoveryImportAuditRecord[]): Promise<void> {
  for (const record of records) {
    const detail = record.detail;
    await client.query(
      `insert into recovery_import_records (batch_id, person_id, source_sheet_id, source_locator, source_key, source_local_date, source_checksum, observation_kind, metric, metric_value, metric_unit, total_sleep_minutes, deep_sleep_minutes, rem_sleep_minutes, light_sleep_minutes, outcome, finding_code, target_observation_id)
       values ($1,$2,$3,$4,$5,$6,$7,$8,$9,$10,$11,$12,$13,$14,$15,$16,$17,$18)
       on conflict (batch_id, source_locator, finding_code) do nothing`,
      [batchId, personId, record.sourceSheetId, record.sourceLocator, record.sourceKey, record.sourceLocalDate, record.sourceChecksum, detail?.type ?? null, detail?.type === "metric" ? detail.metric : null, detail?.type === "metric" ? detail.value : null, detail?.type === "metric" ? detail.unit : null, detail?.type === "sleep" ? detail.totalSleepMinutes : null, detail?.type === "sleep" ? detail.deepSleepMinutes : null, detail?.type === "sleep" ? detail.remSleepMinutes : null, detail?.type === "sleep" ? detail.lightSleepMinutes : null, record.outcome, record.findingCode, record.targetObservationId]
    );
  }
}
function digest(value: unknown): string { return createHash("sha256").update(JSON.stringify(value)).digest("hex"); }
