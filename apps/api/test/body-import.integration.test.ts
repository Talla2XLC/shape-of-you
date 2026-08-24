import {
  PostgreSqlContainer,
  type StartedPostgreSqlContainer
} from "@testcontainers/postgresql";
import { Pool } from "pg";
import { afterAll, beforeAll, describe, expect, it } from "vitest";

import { runMigrations } from "../src/database/migrate.js";
import { BodyImportApplyService } from "../src/import/body-import-apply.js";
import {
  FITNESS_TRACKER_SPREADSHEET_ID,
  type FitnessTrackerBodySnapshot
} from "../src/import/fitness-tracker-sheets-reader.js";
import { PostgresBodyTargetReader } from "../src/import/postgres-body-target-reader.js";

let container: StartedPostgreSqlContainer;
let pool: Pool;
const sheetId = 303;

beforeAll(async () => {
  process.env.PERSON_CONTEXT_MODE = "synthetic";
  process.env.SYNTHETIC_PERSON_ID = "00000000-0000-4000-8000-000000000001";
  container = await new PostgreSqlContainer("postgres:17-alpine")
    .withDatabase("shape_of_you_body_import")
    .withUsername("shape_of_you")
    .withPassword("shape_of_you")
    .start();
  await runMigrations(container.getConnectionUri());
  pool = new Pool({ connectionString: container.getConnectionUri() });
}, 120_000);

afterAll(async () => {
  await pool?.end();
  await container?.stop();
});

describe("unified Fitness Tracker Body apply", () => {
  it("creates a date-only aggregate and becomes unchanged on repeat", async () => {
    const personId = "00000000-0000-4000-8000-000000000041";
    await pool.query("insert into persons (id, kind) values ($1, 'synthetic')", [personId]);
    const source = snapshot("a".repeat(64), [
      { locator: "Body!2", values: ["2026-08-24", 80.25, 101.5, "", "", "", "", "private note", "body-1", "chatgpt"] }
    ]);
    const service = new BodyImportApplyService(
      pool,
      FITNESS_TRACKER_SPREADSHEET_ID,
      sheetId
    );

    const first = await service.apply(personId, source);
    const second = await service.apply(personId, source);
    const state = await pool.query<{
      batches: string;
      facts: string;
      values: string;
      audits: string;
      audit_values: string;
      measured_at: Date | null;
      temporal_precision: string;
      contains_sensitive_data: boolean;
    }>(
      `select
         (select count(*) from import_batches where person_id = $1)::text as batches,
         (select count(*) from body_measurement_sessions where person_id = $1)::text as facts,
         (select count(*) from body_measurement_values bmv join body_measurement_sessions bms on bms.id = bmv.session_id where bms.person_id = $1)::text as values,
         (select count(*) from body_import_records where person_id = $1)::text as audits,
         (select count(*) from body_import_record_values biv join body_import_records bir on bir.id = biv.record_id where bir.person_id = $1)::text as audit_values,
         bms.measured_at, bms.temporal_precision, sr.contains_sensitive_data
       from body_measurement_sessions bms
       join source_references sr on sr.id = bms.source_reference_id
       where bms.person_id = $1`,
      [personId]
    );
    const target = await new PostgresBodyTargetReader(
      pool,
      FITNESS_TRACKER_SPREADSHEET_ID,
      sheetId
    ).readTarget(personId);

    expect(first).toEqual(expect.objectContaining({
      status: "completed",
      counts: { created: 1, unchanged: 0, conflict: 0, invalid: 0 }
    }));
    expect(second).toEqual(expect.objectContaining({
      status: "completed",
      counts: { created: 0, unchanged: 1, conflict: 0, invalid: 0 }
    }));
    expect(state.rows[0]).toEqual(expect.objectContaining({
      batches: "2",
      facts: "1",
      values: "2",
      audits: "2",
      audit_values: "4",
      measured_at: null,
      temporal_precision: "local_date",
      contains_sensitive_data: true
    }));
    expect(target).toEqual([expect.objectContaining({
      sourceIdentity: {
        spreadsheetId: FITNESS_TRACKER_SPREADSHEET_ID,
        sheetId,
        sourceKey: "body-1"
      },
      localDate: "2026-08-24",
      temporalPrecision: "local_date",
      note: "private note",
      values: [
        { metric: "waist", value: 80.25, unit: "cm" },
        { metric: "chest", value: 101.5, unit: "cm" }
      ]
    })]);
  });

  it("persists blocked typed audit and creates no facts for photo or invalid rows", async () => {
    const personId = "00000000-0000-4000-8000-000000000042";
    await pool.query("insert into persons (id, kind) values ($1, 'synthetic')", [personId]);
    const source = snapshot("b".repeat(64), [
      { locator: "Body!2", values: ["2026-08-24", 80, "", "", "", "", "private-photo", "", "photo", "manual"] },
      { locator: "Body!3", values: ["invalid", 79, "", "", "", "", "", "", "invalid", "manual"] }
    ]);

    const report = await new BodyImportApplyService(
      pool,
      FITNESS_TRACKER_SPREADSHEET_ID,
      sheetId
    ).apply(personId, source);
    const state = await pool.query<{ facts: string; records: string; values: string }>(
      `select
         (select count(*) from body_measurement_sessions where person_id = $1)::text as facts,
         (select count(*) from body_import_records where person_id = $1)::text as records,
         (select count(*) from body_import_record_values biv join body_import_records bir on bir.id = biv.record_id where bir.person_id = $1)::text as values`,
      [personId]
    );

    expect(report.status).toBe("blocked");
    expect(report.counts).toEqual({ created: 0, unchanged: 0, conflict: 1, invalid: 1 });
    expect(state.rows[0]).toEqual({ facts: "0", records: "2", values: "1" });
  });

  it("isolates source identity by Person", async () => {
    const firstPerson = "00000000-0000-4000-8000-000000000043";
    const secondPerson = "00000000-0000-4000-8000-000000000044";
    await pool.query("insert into persons (id, kind) values ($1, 'synthetic'), ($2, 'synthetic')", [firstPerson, secondPerson]);
    const source = snapshot("c".repeat(64), [
      { locator: "Body!2", values: ["2026-08-24", 80, "", "", "", "", "", "", "shared-id", "manual"] }
    ]);
    const service = new BodyImportApplyService(pool, FITNESS_TRACKER_SPREADSHEET_ID, sheetId);

    const reports = await Promise.all([
      service.apply(firstPerson, source),
      service.apply(secondPerson, source)
    ]);

    expect(reports.map(({ counts }) => counts.created)).toEqual([1, 1]);
    await expect(pool.query(
      "select count(*)::text as count from body_measurement_sessions where person_id in ($1, $2)",
      [firstPerson, secondPerson]
    )).resolves.toMatchObject({ rows: [{ count: "2" }] });
  });
});

function snapshot(
  manifestChecksum: string,
  rows: FitnessTrackerBodySnapshot["body"]["rows"]
): FitnessTrackerBodySnapshot {
  return {
    spreadsheetId: FITNESS_TRACKER_SPREADSHEET_ID,
    locale: "ru_RU",
    timeZone: "Europe/Moscow",
    manifestChecksum,
    body: {
      sheetId,
      title: "Body",
      headers: [
        "Date",
        "Waist_cm",
        "Chest_cm",
        "Hips_cm",
        "Thigh_cm",
        "Biceps_cm",
        "Photo",
        "Notes",
        "Measurement_ID",
        "Source"
      ],
      rows
    }
  };
}
