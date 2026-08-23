import {
  PostgreSqlContainer,
  type StartedPostgreSqlContainer
} from "@testcontainers/postgresql";
import { Pool } from "pg";
import { afterAll, beforeAll, describe, expect, it } from "vitest";

import { runMigrations } from "../src/database/migrate.js";
import { FITNESS_TRACKER_SPREADSHEET_ID } from "../src/import/fitness-tracker-sheets-reader.js";
import { PostgresWeightTargetReader } from "../src/import/postgres-weight-target-reader.js";
import { PostgresImportLifecycle } from "../src/import/postgres-import-lifecycle.js";
import { WeightImportApplyService } from "../src/import/weight-import-apply.js";
import type { FitnessTrackerWeightSnapshot } from "../src/import/fitness-tracker-sheets-reader.js";

let container: StartedPostgreSqlContainer;
let pool: Pool;
const personId = "00000000-0000-4000-8000-000000000001";
const sheetId = 901;
const externalSystem = `google_sheets:${FITNESS_TRACKER_SPREADSHEET_ID}:${sheetId}`;

beforeAll(async () => {
  process.env.PERSON_CONTEXT_MODE = "synthetic";
  process.env.SYNTHETIC_PERSON_ID = personId;
  container = await new PostgreSqlContainer("postgres:17-alpine")
    .withDatabase("shape_of_you_weight_import")
    .withUsername("shape_of_you")
    .withPassword("shape_of_you")
    .start();
  await runMigrations(container.getConnectionUri());
  pool = new Pool({ connectionString: container.getConnectionUri() });
  const source = await pool.query<{ id: string }>(
    `insert into source_references (
       person_id, channel, external_system, external_record_id, checksum
     ) values ($1, 'google_sheets', $2, '2026-08-21', 'fixture-checksum')
     returning id`,
    [personId, externalSystem]
  );
  await pool.query(
    `insert into weight_measurements (
       person_id, measured_at, local_date, timezone, weight_kg, source,
       source_reference_id, dedupe_key
     ) values (
       $1, '2026-08-21T06:00:00Z', '2026-08-21', 'Europe/Moscow', 82.125,
       'google_sheets', $2, 'fitness-tracker-weight:2026-08-21'
     )`,
    [personId, source.rows[0]!.id]
  );
});

afterAll(async () => {
  await pool?.end();
  await container?.stop();
});

describe("Weight import PostgreSQL target reader", () => {
  it("reads current provenance in a read-only transaction without mutations", async () => {
    const before = await relationCounts();
    const reader = new PostgresWeightTargetReader(
      pool,
      FITNESS_TRACKER_SPREADSHEET_ID,
      sheetId
    );

    const rows = await reader.readTarget(personId);
    const after = await relationCounts();

    expect(rows).toEqual([
      expect.objectContaining({
        sourceIdentity: {
          spreadsheetId: FITNESS_TRACKER_SPREADSHEET_ID,
          sheetId,
          sourceKey: "2026-08-21"
        },
        checksum: "fixture-checksum",
        localDate: "2026-08-21",
        temporalPrecision: "instant",
        weightKg: 82.125
      })
    ]);
    expect(after).toEqual(before);
  });

  it("rolls back a failed comparison and leaves the pool reusable", async () => {
    const reader = new PostgresWeightTargetReader(
      pool,
      FITNESS_TRACKER_SPREADSHEET_ID,
      sheetId
    );
    await expect(reader.readTarget("not-a-uuid")).rejects.toThrow();
    await expect(reader.readTarget(personId)).resolves.toHaveLength(1);
    expect(await relationCounts()).toEqual({ sourceReferences: 1, weights: 1 });
  });
});

describe("unified Fitness Tracker Weight apply", () => {
  it("atomically creates date-only facts and is idempotent on repeat", async () => {
    const applyPersonId = "00000000-0000-4000-8000-000000000011";
    await pool.query("insert into persons (id, kind) values ($1, 'synthetic')", [applyPersonId]);
    const source = snapshot("apply-manifest", [
      { locator: "Weight!2", values: ["2026-08-22", 81.5] }
    ], [
      { locator: "Daily_Log!2", values: ["2026-08-22", 81.5] }
    ]);
    const service = new WeightImportApplyService(
      pool,
      FITNESS_TRACKER_SPREADSHEET_ID,
      sheetId
    );

    const first = await service.apply(applyPersonId, source);
    const second = await service.apply(applyPersonId, source);
    const facts = await pool.query<{
      measured_at: Date | null;
      temporal_precision: string;
      import_batch_id: string;
    }>(
      `select wm.measured_at, wm.temporal_precision, sr.import_batch_id
         from weight_measurements wm
         join source_references sr on sr.id = wm.source_reference_id
        where wm.person_id = $1`,
      [applyPersonId]
    );
    const batches = await pool.query<{ status: string }>(
      "select status from import_batches where person_id = $1 order by created_at",
      [applyPersonId]
    );

    expect(first).toEqual(expect.objectContaining({
      mode: "apply",
      status: "completed",
      counts: { created: 1, unchanged: 0, conflict: 0, invalid: 0 }
    }));
    expect(second).toEqual(expect.objectContaining({
      status: "completed",
      counts: { created: 0, unchanged: 1, conflict: 0, invalid: 0 }
    }));
    expect(facts.rows).toEqual([expect.objectContaining({
      measured_at: null,
      temporal_precision: "local_date",
      import_batch_id: first.batchId
    })]);
    expect(batches.rows).toHaveLength(2);
  });

  it("persists a blocked audit and creates no facts when any row is invalid", async () => {
    const blockedPersonId = "00000000-0000-4000-8000-000000000012";
    await pool.query("insert into persons (id, kind) values ($1, 'synthetic')", [blockedPersonId]);
    const source = snapshot("blocked-manifest", [
      { locator: "Weight!2", values: ["2026-08-22", 81.5] },
      { locator: "Weight!3", values: ["not-a-date", 80] }
    ], [
      { locator: "Daily_Log!2", values: ["2026-08-22", 81.5] }
    ]);
    const service = new WeightImportApplyService(
      pool,
      FITNESS_TRACKER_SPREADSHEET_ID,
      sheetId
    );
    const report = await service.apply(blockedPersonId, source);
    const retry = await service.apply(blockedPersonId, source);
    const counts = await pool.query<{
      facts: string;
      records: string;
    }>(
      `select
         (select count(*) from weight_measurements where person_id = $1)::text as facts,
         (select count(*) from weight_import_records where person_id = $1)::text as records`,
      [blockedPersonId]
    );

    expect(report.status).toBe("blocked");
    expect(retry.batchId).toBe(report.batchId);
    expect(report.counts).toEqual({ created: 1, unchanged: 0, conflict: 0, invalid: 1 });
    expect(counts.rows[0]).toEqual({ facts: "0", records: "2" });
    await expect(
      pool.query("select count(*)::text as count from import_batches where person_id = $1", [blockedPersonId])
    ).resolves.toMatchObject({ rows: [{ count: "1" }] });
  });

  it("serializes concurrent apply attempts without duplicate facts", async () => {
    const concurrentPersonId = "00000000-0000-4000-8000-000000000013";
    await pool.query("insert into persons (id, kind) values ($1, 'synthetic')", [concurrentPersonId]);
    const source = snapshot("concurrent-manifest", [
      { locator: "Weight!2", values: ["2026-08-23", 81] }
    ], [
      { locator: "Daily_Log!2", values: ["2026-08-23", 81] }
    ]);
    const service = new WeightImportApplyService(
      pool,
      FITNESS_TRACKER_SPREADSHEET_ID,
      sheetId
    );
    const reports = await Promise.all([
      service.apply(concurrentPersonId, source),
      service.apply(concurrentPersonId, source)
    ]);
    const facts = await pool.query<{ count: string }>(
      "select count(*)::text as count from weight_measurements where person_id = $1",
      [concurrentPersonId]
    );

    expect(reports.map((item) => item.counts.created).sort()).toEqual([0, 1]);
    expect(facts.rows[0]?.count).toBe("1");
  });

  it("rolls back batch and domain writes when audit persistence fails", async () => {
    const rollbackPersonId = "00000000-0000-4000-8000-000000000014";
    await pool.query("insert into persons (id, kind) values ($1, 'synthetic')", [rollbackPersonId]);
    const lifecycle = new PostgresImportLifecycle(pool);

    await expect(lifecycle.apply({
      personId: rollbackPersonId,
      snapshot: { manifest: "rollback" },
      sourceSystem: "google_sheets",
      sourceContainerId: FITNESS_TRACKER_SPREADSHEET_ID,
      sourceManifestChecksum: "0".repeat(64),
      adapter: {
        domain: "weight",
        readTarget: async () => [],
        classify: () => ({
          safeReport: {
            version: 1,
            mode: "dry_run",
            domain: "weight",
            sourceManifestChecksum: "0".repeat(64),
            counts: { created: 1, unchanged: 0, conflict: 0, invalid: 0 },
            findings: [{
              outcome: "created",
              code: "target_absent",
              locator: "Weight!2",
              sourceKeyHash: "0000000000000000"
            }]
          },
          privateDetail: { created: true }
        }),
        targetStateChecksum: () => "1".repeat(64),
        createFacts: async (client, batchId, ownerId, _source, detail) => {
          await client.query(
            `insert into source_references (
               person_id, channel, external_system, external_record_id, import_batch_id
             ) values ($1, 'import', 'rollback-fixture', 'record-1', $2)`,
            [ownerId, batchId]
          );
          return detail;
        },
        persistAudit: async () => {
          throw new Error("injected audit failure");
        }
      }
    })).rejects.toThrow("injected audit failure");

    const state = await pool.query<{ batches: string; sources: string }>(
      `select
         (select count(*) from import_batches where person_id = $1)::text as batches,
         (select count(*) from source_references
           where person_id = $1 and external_system = 'rollback-fixture')::text as sources`,
      [rollbackPersonId]
    );
    expect(state.rows[0]).toEqual({ batches: "0", sources: "0" });
  });
});

function snapshot(
  manifestChecksum: string,
  weightRows: FitnessTrackerWeightSnapshot["weight"]["rows"],
  mirrorRows: FitnessTrackerWeightSnapshot["dailyLog"]["rows"]
): FitnessTrackerWeightSnapshot {
  return {
    spreadsheetId: FITNESS_TRACKER_SPREADSHEET_ID,
    locale: "ru_RU",
    timeZone: "Europe/Moscow",
    manifestChecksum,
    weight: {
      sheetId,
      title: "Weight",
      headers: ["Date", "Weight_kg"],
      rows: weightRows
    },
    dailyLog: {
      sheetId: 902,
      title: "Daily_Log",
      headers: ["Date", "Weight"],
      rows: mirrorRows
    }
  };
}

async function relationCounts(): Promise<{
  readonly sourceReferences: number;
  readonly weights: number;
}> {
  const result = await pool.query<{
    source_references: string;
    weights: string;
  }>(
    `select
       (select count(*) from source_references)::text as source_references,
       (select count(*) from weight_measurements)::text as weights`
  );
  return {
    sourceReferences: Number(result.rows[0]!.source_references),
    weights: Number(result.rows[0]!.weights)
  };
}
